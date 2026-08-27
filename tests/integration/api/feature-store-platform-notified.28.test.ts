/**
 * `platformNotified` 說的是實話嗎？——兩條路各測一次
 * -----------------------------------------------------------------------------
 * 09 分冊 §6 ＋ 14 分冊 §8.10。接續 commit `9829f12`（issue #28 第 ⑭ 筆）。
 *
 * 事情的來由：還原副作用失敗時的文案結尾原本寫「（已通知平台處理）」，而端點
 * 當時**零通知**。`9829f12` 補上了真正的 `bug_reports` 寫入（reporter='system'），
 * 但那筆寫入自己也可能失敗，所以文案仍不敢宣稱。本輪加了 `platformNotified` 旗標
 * 讓畫面據實分岔——**於是旗標本身變成了新的「可能說謊的地方」**。
 *
 * 所以這一檔的重點不是「有回旗標」，而是**旗標與資料庫的真實狀態一致**，而且
 * **兩條路都真的被走過**：
 *
 *   路 A：副作用失敗、bug_reports 寫成功 → platformNotified=true，且資料表真的多一列
 *   路 B：副作用失敗、bug_reports 也寫失敗 → platformNotified=false，且資料表沒多列
 *
 * 只測路 A 是不夠的：實作若寫成無條件 `return true`，路 A 一樣綠。路 B 是唯一
 * 能把「照實回報」與「一律報成功」區分開的案例。
 *
 * ── 怎麼誘發這兩種失敗 ──────────────────────────────────────────────────
 * 兩者都無法用純資料誘發（`coupons` / `bug_reports` 上沒有任何 check constraint
 * 可以違反），所以沿用 feature-store-restore.28.test.ts 分支 3 的手法：用
 * Management API 在 **TEST 專案**臨時裝只對哨兵條件 raise 的 trigger，`finally` 拆掉。
 *
 * - 這是**測試治具**不是 migration，刻意只裝在 TEST、不裝正式（裝了才是讓兩個
 *   專案 schema 分岔）。存活時間是單一案例內的數百毫秒。
 * - raise 條件綁死哨兵：coupons 綁名稱 `__PLATFORM_NOTIFIED_PROBE__`；
 *   bug_reports 綁 `category = 'SYSTEM_RESTORE_SIDE_EFFECT'`（只有系統自動產生的
 *   那一種，使用者從 modal 回報的類別來自下拉選單，不會是這個值）。
 * - 每個案例開頭都先 `drop … if exists`，萬一行程被砍導致殘留，下次跑會先清乾淨。
 * - 需要 SUPABASE_ACCESS_TOKEN（Management API 才做得到 DDL）。CI 的 .env.test
 *   沒有這個 token，所以那裡會 **skip 而不是假綠**——這一格的證據是沙箱實跑，
 *   要 CI 也涵蓋需要把 token 加進 repo secrets（⚙ 只有擁有者能做，14 分冊 §6.4
 *   技術債第 3 條已記錄同一件事）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

interface RestoreResult {
  restoredCoupons?: number;
  restoredProducts?: number;
  restoreSideEffectFailed?: boolean;
  platformNotified?: boolean;
}

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

const PROBE_NAME = '__PLATFORM_NOTIFIED_PROBE__';
const SYSTEM_CATEGORY = 'SYSTEM_RESTORE_SIDE_EFFECT';

let admin: SupabaseClient;
let ownerA: AuthedApi;

function managementToken(): string | undefined {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
  const envLocal = resolve(__dirname, '..', '..', '..', '.env.local');
  if (!existsSync(envLocal)) return undefined;
  const line = readFileSync(envLocal, 'utf-8')
    .split('\n')
    .find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
  return line?.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^['"]|['"]$/g, '') || undefined;
}

/** 從 TEST_SUPABASE_URL（https://<ref>.supabase.co）取專案 ref —— 永遠不會是正式專案 */
function testProjectRef(): string {
  return new URL(process.env.TEST_SUPABASE_URL!).hostname.split('.')[0];
}

async function runSql(token: string, query: string): Promise<void> {
  const res = await fetch(`https://api.supabase.com/v1/projects/${testProjectRef()}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  });
  if (!res.ok) throw new Error(`Management API ${res.status}: ${await res.text()}`);
}

/** 讓 coupons 的還原 update 丟例外（＝進 route.ts 的 catch 分支） */
const INSTALL_COUPON_PROBE = `
  drop trigger if exists t_platform_notified_coupon_probe on coupons;
  create or replace function __platform_notified_coupon_probe() returns trigger
  language plpgsql as $$
  begin
    if new.name = '${PROBE_NAME}' then raise exception 'PLATFORM_NOTIFIED_COUPON_PROBE'; end if;
    return new;
  end $$;
  create trigger t_platform_notified_coupon_probe before update on coupons
    for each row execute function __platform_notified_coupon_probe();
`;

/** 讓 bug_reports 的平台待處理紀錄寫不進去（＝ recordPlatformIssue 回 false） */
const INSTALL_BUG_REPORT_PROBE = `
  drop trigger if exists t_platform_notified_report_probe on bug_reports;
  create or replace function __platform_notified_report_probe() returns trigger
  language plpgsql as $$
  begin
    if new.category = '${SYSTEM_CATEGORY}' then raise exception 'PLATFORM_NOTIFIED_REPORT_PROBE'; end if;
    return new;
  end $$;
  create trigger t_platform_notified_report_probe before insert on bug_reports
    for each row execute function __platform_notified_report_probe();
`;

const DROP_ALL_PROBES = `
  drop trigger if exists t_platform_notified_coupon_probe on coupons;
  drop function if exists __platform_notified_coupon_probe();
  drop trigger if exists t_platform_notified_report_probe on bug_reports;
  drop function if exists __platform_notified_report_probe();
`;

async function markCancelled(code: string): Promise<void> {
  const { error } = await admin
    .from('feature_subscriptions')
    .upsert(
      {
        tenant_id: SHOP_A.id,
        code,
        active: true,
        expires_at: null,
        source: 'GRANTED',
        cancelled_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id,code' },
    );
  expect(error).toBeNull();
}

async function clearCancelled(code: string): Promise<void> {
  await admin
    .from('feature_subscriptions')
    .update({ cancelled_at: null })
    .eq('tenant_id', SHOP_A.id)
    .eq('code', code);
}

/** 這一輪產生的系統自動回報（用 created_at 分界，避免撿到別的案例留下的） */
async function systemReportsSince(since: string) {
  const { data, error } = await admin
    .from('bug_reports')
    .select('id, tenant_id, reporter, category, subject, content, page_url, created_at')
    .eq('tenant_id', SHOP_A.id)
    .eq('category', SYSTEM_CATEGORY)
    .gte('created_at', since);
  expect(error).toBeNull();
  return data ?? [];
}

const token = managementToken();

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  if (!token) {
    console.warn(
      '[feature-store-platform-notified] 跳過：找不到 SUPABASE_ACCESS_TOKEN，' +
        '無法用 Management API 裝臨時 trigger 誘發失敗。這是 skip 不是綠燈。',
    );
  }
});

afterAll(async () => {
  await clearCancelled('COUPON_SYSTEM');
  if (token) await runSql(token, DROP_ALL_PROBES).catch(() => undefined);
});

describe('路 A：bug_reports 寫得進去 → platformNotified=true（且資料表真的多一列）', () => {
  it.skipIf(!token)(
    '還原副作用失敗 → platformNotified=true，且 bug_reports 多一列 reporter=system 的紀錄',
    async () => {
      const probeId = randomUUID();
      const since = new Date(Date.now() - 5_000).toISOString();
      await markCancelled('COUPON_SYSTEM');
      try {
        await admin.from('coupons').insert({
          id: probeId, tenant_id: SHOP_A.id, name: PROBE_NAME,
          discount_type: 'AMOUNT', discount_value: 50,
          status: 'PAUSED', auto_paused_by_feature: true,
        });
        // 只裝 coupons 的 probe：bug_reports 這條路是通的
        await runSql(token!, `${DROP_ALL_PROBES}\n${INSTALL_COUPON_PROBE}`);

        const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
        expect(res.status).toBe(200);
        const body = await readJson<RestoreResult>(res);
        expect(body.success).toBe(true);
        expect(body.data?.restoreSideEffectFailed).toBe(true);
        // ← 本輪重點：旗標為 true
        expect(body.data?.platformNotified).toBe(true);

        // …而且它說的是真的：資料表確實多了那一列（不是憑空宣稱）
        const reports = await systemReportsSince(since);
        expect(reports).toHaveLength(1);
        const row = reports[0];
        expect(row.reporter).toBe('system');          // 一眼看得出不是使用者回報
        expect(row.category).toBe(SYSTEM_CATEGORY);
        expect(row.subject).toContain('COUPON_SYSTEM');
        expect(row.page_url).toBe('/tenant/feature-store');
        // 內容要帶得走的原因，平台端才修得了（PostgrestError 不可變成 [object Object]）
        expect(row.content).toContain('COUPON_SYSTEM');
        expect(row.content).not.toContain('[object Object]');
        expect(row.content).toContain('PLATFORM_NOTIFIED_COUPON_PROBE');
      } finally {
        await runSql(token!, DROP_ALL_PROBES).catch(() => undefined);
        await admin.from('coupons').delete().eq('id', probeId);
        await admin
          .from('bug_reports').delete()
          .eq('tenant_id', SHOP_A.id).eq('category', SYSTEM_CATEGORY);
        await clearCancelled('COUPON_SYSTEM');
      }
    },
  );
});

describe('路 B：bug_reports 也寫不進去 → platformNotified=false（不准報 true）', () => {
  it.skipIf(!token)(
    '還原副作用失敗＋紀錄寫入失敗 → 200、restoreSideEffectFailed=true、platformNotified=false，且資料表沒有多列',
    async () => {
      const probeId = randomUUID();
      const since = new Date(Date.now() - 5_000).toISOString();
      await markCancelled('COUPON_SYSTEM');
      try {
        await admin.from('coupons').insert({
          id: probeId, tenant_id: SHOP_A.id, name: PROBE_NAME,
          discount_type: 'AMOUNT', discount_value: 50,
          status: 'PAUSED', auto_paused_by_feature: true,
        });
        // 兩個 probe 都裝：副作用失敗，且平台待處理紀錄也寫不進去
        await runSql(token!, `${DROP_ALL_PROBES}\n${INSTALL_COUPON_PROBE}\n${INSTALL_BUG_REPORT_PROBE}`);

        const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
        // 紀錄寫不進去不可讓恢復失敗（09 §6）——訂閱本身仍然恢復成功
        expect(res.status).toBe(200);
        const body = await readJson<RestoreResult>(res);
        expect(body.success).toBe(true);
        expect(body.data?.restoreSideEffectFailed).toBe(true);
        /*
         * ⚠️ 這一行是整組測試存在的理由：實作若寫成無條件 `platformNotified: true`，
         * 只有這一行會紅。路 A 在那種實作下照樣綠。
         */
        expect(body.data?.platformNotified).toBe(false);

        // 旗標說沒記錄成功 —— 資料表也確實沒有那一列
        expect(await systemReportsSince(since)).toHaveLength(0);

        const { data: sub } = await admin
          .from('feature_subscriptions')
          .select('cancelled_at')
          .eq('tenant_id', SHOP_A.id).eq('code', 'COUPON_SYSTEM').single();
        expect(sub!.cancelled_at).toBeNull();
      } finally {
        await runSql(token!, DROP_ALL_PROBES).catch(() => undefined);
        await admin.from('coupons').delete().eq('id', probeId);
        await admin
          .from('bug_reports').delete()
          .eq('tenant_id', SHOP_A.id).eq('category', SYSTEM_CATEGORY);
        await clearCancelled('COUPON_SYSTEM');
      }
    },
  );
});

describe('對照組：副作用沒失敗時不該有旗標，也不該留下平台待處理紀錄', () => {
  it('沒有 auto_paused 票券 → restoredCoupons=0、platformNotified 不存在、bug_reports 沒多列', async () => {
    const since = new Date(Date.now() - 5_000).toISOString();
    await markCancelled('COUPON_SYSTEM');
    try {
      const res = await ownerA.post('/api/feature-store/COUPON_SYSTEM/restore');
      expect(res.status).toBe(200);
      const body = await readJson<RestoreResult>(res);
      expect(body.data?.restoredCoupons).toBe(0);
      expect(body.data?.restoreSideEffectFailed).toBeUndefined();
      /*
       * 成功路徑不帶這個欄位＝頁面拿到 undefined＝「不知道」，而頁面的比對是
       * `=== true`，所以那句「已自動記錄」不會在沒失敗時冒出來。
       */
      expect(body.data?.platformNotified).toBeUndefined();
      expect(await systemReportsSince(since)).toHaveLength(0);
    } finally {
      await clearCancelled('COUPON_SYSTEM');
    }
  });
});
