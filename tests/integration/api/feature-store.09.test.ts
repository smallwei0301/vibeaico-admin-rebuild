/**
 * 功能商店訂閱 API 整合測試 — 12 分冊 §4「Phase 5/5.5」矩陣 feature-store.09 列：
 *   「餘額足訂閱：CONSUME 交易、到期日 +N 月；不足 409 POINTS_001 且餘額未被扣；
 *    續訂從原到期日累加；取消後到期前 isFeatureActive 仍 true；restore 不扣點；
 *    LITE 只扣一次 399×N 且 5 碼全開；LITE→PRO 升級」
 * 契約出處：docs/integration/09-FEATURE-STORE.md §2（subscribe_feature /
 * subscribe_bundle rpc 語意、featureActive 判定）與 §3（端點表）。
 * 價格一律 import 自 src/config/features.ts 的 FEATURE_CATALOG / FEATURE_BUNDLES
 * （目錄唯一事實來源，後端不得發明價格）。
 *
 * 基線處理（整檔 beforeAll/afterAll）：
 *   seed 已為 SHOP_A upsert 全部 18 個付費碼的 GRANTED 列（active、expires_at
 *   null、source='GRANTED'）。本檔要測「從無到有訂閱」，beforeAll 先以 service
 *   role 刪掉 SHOP_A 的全部 18 列；afterAll 一律 upsert 回 GRANTED 基線
 *   （onConflict 'tenant_id,code'）並刪掉本檔產生的全部 SHOP_A 點數交易
 *   （seed 的錢包無任何交易 = 餘額 0，全刪即回基線；coupons-points.b4 依賴
 *   這個零交易基線）。vitest.integration.config.mts 由 npm script 帶
 *   --no-file-parallelism 執行 —— 測試檔之間串行，無並行互踩問題；本檔案例
 *   之間有刻意的先後順序（餘額/到期日逐步演進），依 vitest 檔內由上而下執行。
 *
 * 到期日斷言方式：postgres make_interval(months => N) 是「日曆月」，JS 的
 * setMonth 月底進位規則與其不同，逐字重算會在月底日期產生假紅。改斷言
 * 「距今天數落在該月數的合理視窗」（+1 月 = 27~32 天），續訂則斷言
 * 「新到期日 − 原到期日」落在 27~32 天 —— 值仍是寫死的具體區間，不是
 * 「有回東西」式的鬆斷言。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { FEATURE_CATALOG, FEATURE_BUNDLES, PAID_FEATURE_CODES } from '@/config/features';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function price(code: string): number {
  const item = FEATURE_CATALOG.find((f) => f.key === code && f.paid);
  if (!item) throw new Error(`FEATURE_CATALOG 沒有付費碼 ${code}`);
  return item.price;
}

/** iso 距現在幾天（浮點） */
function daysFromNow(iso: string): number {
  return (new Date(iso).getTime() - Date.now()) / 86_400_000;
}

/** 兩個 iso 相差幾天（浮點） */
function daysBetween(fromIso: string, toIso: string): number {
  return (new Date(toIso).getTime() - new Date(fromIso).getTime()) / 86_400_000;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

interface SubRow {
  code: string;
  active: boolean;
  expires_at: string | null;
  cancelled_at: string | null;
  source: string;
}

async function getSub(code: string): Promise<SubRow | null> {
  const { data, error } = await admin
    .from('feature_subscriptions')
    .select('code, active, expires_at, cancelled_at, source')
    .eq('tenant_id', SHOP_A.id)
    .eq('code', code)
    .maybeSingle();
  expect(error).toBeNull();
  return data as SubRow | null;
}

async function txCount(): Promise<number> {
  const { count, error } = await admin
    .from('tenant_point_transactions')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
  return count ?? 0;
}

/** 目前餘額 = 最新 balance_after（09 分冊 §2 rpc 同一條規則；無紀錄 = 0） */
async function currentBalance(): Promise<number> {
  const { data, error } = await admin
    .from('tenant_point_transactions')
    .select('balance_after')
    .eq('tenant_id', SHOP_A.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { balance_after: number } | null)?.balance_after ?? 0;
}

/** 以 service role 入點（TOPUP）：先查最新 balance_after 再插一筆 */
async function topup(amount: number): Promise<void> {
  const balance = await currentBalance();
  const { error } = await admin.from('tenant_point_transactions').insert({
    tenant_id: SHOP_A.id,
    type: 'TOPUP',
    amount,
    balance_after: balance + amount,
    description: '測試入點',
  });
  expect(error).toBeNull();
}

/** 依描述字串找唯一一筆 CONSUME 交易（rpc 的描述格式見 migration 0011） */
async function consumeTxByDescription(description: string) {
  const { data, error } = await admin
    .from('tenant_point_transactions')
    .select('type, amount, balance_after, description')
    .eq('tenant_id', SHOP_A.id)
    .eq('description', description);
  expect(error).toBeNull();
  return data as { type: string; amount: number; balance_after: number; description: string }[];
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  // 基線出發點：刪掉 seed 的 18 個 GRANTED 列（本檔要測「未訂閱 → 訂閱」全流程）
  const { error } = await admin
    .from('feature_subscriptions')
    .delete()
    .eq('tenant_id', SHOP_A.id)
    .in('code', PAID_FEATURE_CODES);
  expect(error).toBeNull();
});

afterAll(async () => {
  // 還原 GRANTED 基線（覆蓋本檔造出的 INDIVIDUAL/BUNDLE_* 列；cancelled_at 明確歸 null）
  await admin.from('feature_subscriptions').upsert(
    PAID_FEATURE_CODES.map((code) => ({
      tenant_id: SHOP_A.id,
      code,
      active: true,
      expires_at: null,
      source: 'GRANTED',
      cancelled_at: null,
    })),
    { onConflict: 'tenant_id,code' },
  );
  // 清掉本檔產生的全部點數交易（seed 基線 = 零交易；b4 檔依賴這個基線）
  await admin.from('tenant_point_transactions').delete().eq('tenant_id', SHOP_A.id);
});

/** 案例間共享的到期日（續訂案例要跟首次訂閱比較） */
let unlimitedStaffFirstExpiry = '';

describe('POST /api/feature-store/:code/apply（09 §2/§3）', () => {
  it('餘額不足（入點前餘額 0）訂 AI_ASSISTANT → 409 POINTS_001，餘額未被扣、未開通', async () => {
    const before = await txCount();
    expect(before).toBe(0); // seed 錢包無交易

    const res = await ownerA.post('/api/feature-store/AI_ASSISTANT/apply', { months: 1 });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('POINTS_001');
    expect(body.message).toBe('點數不足');

    // rpc raise → 整筆 rollback：交易筆數不變、沒有訂閱列
    expect(await txCount()).toBe(before);
    expect(await getSub('AI_ASSISTANT')).toBeNull();
  });

  it('餘額足（入 500 點）訂 UNLIMITED_STAFF 1 月 → CONSUME -49、balance_after 451；列 active/INDIVIDUAL/到期 ≈ +1 月', async () => {
    await topup(500);
    const cost = price('UNLIMITED_STAFF'); // 49（目錄價）
    expect(cost).toBe(49);

    const res = await ownerA.post('/api/feature-store/UNLIMITED_STAFF/apply', { months: 1 });
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    // CONSUME 交易恰一筆：-49、balance_after = 500 - 49 = 451
    const consumes = await consumeTxByDescription('訂閱功能：UNLIMITED_STAFF × 1 個月');
    expect(consumes).toHaveLength(1);
    expect(consumes[0].type).toBe('CONSUME');
    expect(consumes[0].amount).toBe(-cost);
    expect(consumes[0].balance_after).toBe(500 - cost);
    expect(await currentBalance()).toBe(451);

    const sub = await getSub('UNLIMITED_STAFF');
    expect(sub).not.toBeNull();
    expect(sub!.active).toBe(true);
    expect(sub!.source).toBe('INDIVIDUAL');
    expect(sub!.cancelled_at).toBeNull();
    expect(sub!.expires_at).not.toBeNull();
    // +1 日曆月 → 距今 27~32 天（見檔頭「到期日斷言方式」）
    const days = daysFromNow(sub!.expires_at!);
    expect(days).toBeGreaterThanOrEqual(27);
    expect(days).toBeLessThanOrEqual(32);
    unlimitedStaffFirstExpiry = sub!.expires_at!;
  });

  it('續訂同碼 1 月 → expires_at 從原到期日累加（新到期 − 原到期 ≈ 1 月）', async () => {
    const res = await ownerA.post('/api/feature-store/UNLIMITED_STAFF/apply', { months: 1 });
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    // 又扣一筆 49：451 - 49 = 402（同描述的 CONSUME 變 2 筆）
    expect(await consumeTxByDescription('訂閱功能：UNLIMITED_STAFF × 1 個月')).toHaveLength(2);
    expect(await currentBalance()).toBe(402);

    const sub = await getSub('UNLIMITED_STAFF');
    expect(sub!.active).toBe(true);
    // 累加語意（09 §2：greatest(原到期日, now()) + 1 月）：差值 = 一個日曆月
    const delta = daysBetween(unlimitedStaffFirstExpiry, sub!.expires_at!);
    expect(delta).toBeGreaterThanOrEqual(27);
    expect(delta).toBeLessThanOrEqual(32);
    // 距今 ≈ 2 個月（首次 +1 月、續訂再 +1 月）
    const days = daysFromNow(sub!.expires_at!);
    expect(days).toBeGreaterThanOrEqual(55);
    expect(days).toBeLessThanOrEqual(63);
  });
});

describe('cancel / restore（09 §2/§3：取消不縮短到期日、restore 不扣點）', () => {
  it('SHIFT_MANAGEMENT 訂閱→取消：cancelled_at 非空、active 仍 true、expires_at 未變；被閘端點 /api/shifts 仍 200', async () => {
    // GRANTED 列已在 beforeAll 刪除 —— 先確認未訂閱時真的被閘（403 FEAT_001），
    // 讓後面的 200 有對照意義
    const blocked = await ownerA.get('/api/shifts?from=2026-01-01&to=2026-12-31');
    expect(blocked.status).toBe(403);
    expect((await readJson(blocked)).code).toBe('FEAT_001');

    // 訂閱（餘額 402 → 353）
    const apply = await ownerA.post('/api/feature-store/SHIFT_MANAGEMENT/apply', { months: 1 });
    expect(apply.status).toBe(200);
    const before = await getSub('SHIFT_MANAGEMENT');
    expect(before!.active).toBe(true);
    expect(before!.cancelled_at).toBeNull();

    // 取消
    const cancel = await ownerA.post('/api/feature-store/SHIFT_MANAGEMENT/cancel');
    expect(cancel.status).toBe(200);
    expect((await readJson(cancel)).success).toBe(true);

    const after = await getSub('SHIFT_MANAGEMENT');
    expect(after!.cancelled_at).not.toBeNull();
    expect(after!.active).toBe(true); // 取消不改 active
    expect(after!.expires_at).toBe(before!.expires_at); // 不縮短到期日

    // 09 §2：cancelled_at 不影響到期前可用 → 被 SHIFT_MANAGEMENT 閘的端點仍通
    const ok = await ownerA.get('/api/shifts?from=2026-01-01&to=2026-12-31');
    expect(ok.status).toBe(200);
    expect((await readJson(ok)).success).toBe(true);
  });

  it('restore 已取消的 SHIFT_MANAGEMENT → cancelled_at 歸 null，交易筆數不變（不扣點）', async () => {
    const before = await txCount();

    const res = await ownerA.post('/api/feature-store/SHIFT_MANAGEMENT/restore');
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    const sub = await getSub('SHIFT_MANAGEMENT');
    expect(sub!.cancelled_at).toBeNull();
    expect(sub!.active).toBe(true);
    expect(await txCount()).toBe(before); // 不扣點
  });
});

describe('套裝方案 bundle/:key/apply（09 §3）', () => {
  it('LITE 1 月（入 500 點）→ 只扣一筆 399、5 碼全開（source=BUNDLE_LITE）', async () => {
    await topup(500); // 353 + 500 = 853
    const balanceBefore = await currentBalance();
    expect(balanceBefore).toBe(853);
    const txBefore = await txCount();
    const lite = FEATURE_BUNDLES.LITE;
    expect(lite.price).toBe(399);

    const res = await ownerA.post('/api/feature-store/bundle/LITE/apply', { months: 1 });
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    // 扣點只扣一次 bundle 價：恰好新增 1 筆交易、-399
    expect(await txCount()).toBe(txBefore + 1);
    const consumes = await consumeTxByDescription('訂閱套裝：LITE × 1 個月');
    expect(consumes).toHaveLength(1);
    expect(consumes[0].amount).toBe(-399);
    expect(consumes[0].balance_after).toBe(853 - 399); // 454
    expect(await currentBalance()).toBe(454);

    // 5 碼全開、各列 source='BUNDLE_LITE'（含原本 INDIVIDUAL 的 UNLIMITED_STAFF —
    // rpc on conflict 會改寫 source = excluded.source）
    const { data, error } = await admin
      .from('feature_subscriptions')
      .select('code, active, expires_at, cancelled_at, source')
      .eq('tenant_id', SHOP_A.id)
      .eq('source', 'BUNDLE_LITE');
    expect(error).toBeNull();
    const rows = data as SubRow[];
    expect(rows.map((r) => r.code).sort()).toEqual([...lite.codes].sort());
    for (const r of rows) {
      expect(r.active).toBe(true);
      expect(r.cancelled_at).toBeNull();
      expect(r.expires_at).not.toBeNull();
      expect(daysFromNow(r.expires_at!)).toBeGreaterThanOrEqual(27);
    }
  });

  it('LITE→PRO 升級（入 900 點）→ 扣 799 一筆、18 碼全為 BUNDLE_PRO、原 LITE 碼到期日累加不退點', async () => {
    await topup(900); // 454 + 900 = 1354
    const txBefore = await txCount();
    const pro = FEATURE_BUNDLES.PRO;
    expect(pro.price).toBe(799);
    expect(pro.codes).toHaveLength(18);

    // 升級前記下 LITE 碼之一（BASIC_REPORT，只在 LITE 訂過）的到期日，驗「剩餘天數不退點」
    const liteBefore = await getSub('BASIC_REPORT');
    expect(liteBefore!.source).toBe('BUNDLE_LITE');

    const res = await ownerA.post('/api/feature-store/bundle/PRO/apply', { months: 1 });
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    // 扣 799 一筆
    expect(await txCount()).toBe(txBefore + 1);
    const consumes = await consumeTxByDescription('訂閱套裝：PRO × 1 個月');
    expect(consumes).toHaveLength(1);
    expect(consumes[0].amount).toBe(-799);
    expect(consumes[0].balance_after).toBe(1354 - 799); // 555
    expect(await currentBalance()).toBe(555);

    // 18 個付費碼全數存在、source='BUNDLE_PRO'、active、cancelled_at null。
    // 判斷／說明：任務要求另斷言「BUNDLE_LITE 各列 cancelled_at 非空」——那只是
    // 升級流程的**中間狀態**（bundle/PRO/apply 先對 source='BUNDLE_LITE' 列
    // cancelled_at=now()，隨後 subscribe_bundle 對同一批列 on conflict 改寫
    // source='BUNDLE_PRO'、cancelled_at=null，見 migration 0011）。HTTP 之外
    // 無法原子觀測中間態，故斷言升級完成後的最終契約狀態：LITE 列不復存在、
    // 全部 18 碼歸 PRO。
    const { data, error } = await admin
      .from('feature_subscriptions')
      .select('code, active, expires_at, cancelled_at, source')
      .eq('tenant_id', SHOP_A.id)
      .in('code', pro.codes);
    expect(error).toBeNull();
    const rows = data as SubRow[];
    expect(rows).toHaveLength(18);
    for (const r of rows) {
      expect(r.source).toBe('BUNDLE_PRO');
      expect(r.active).toBe(true);
      expect(r.cancelled_at).toBeNull();
      expect(r.expires_at).not.toBeNull();
    }
    const { count: liteLeft } = await admin
      .from('feature_subscriptions')
      .select('code', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id)
      .eq('source', 'BUNDLE_LITE');
    expect(liteLeft ?? 0).toBe(0);

    // 剩餘天數不退點：原 LITE 碼（BASIC_REPORT）從原到期日再 +1 月
    const liteAfter = rows.find((r) => r.code === 'BASIC_REPORT')!;
    const delta = daysBetween(liteBefore!.expires_at!, liteAfter.expires_at!);
    expect(delta).toBeGreaterThanOrEqual(27);
    expect(delta).toBeLessThanOrEqual(32);
    // 只在 PRO 才首訂的碼（AI_ASSISTANT）到期 ≈ +1 月，比累加過的 LITE 碼早
    const proOnly = rows.find((r) => r.code === 'AI_ASSISTANT')!;
    const proOnlyDays = daysFromNow(proOnly.expires_at!);
    expect(proOnlyDays).toBeGreaterThanOrEqual(27);
    expect(proOnlyDays).toBeLessThanOrEqual(32);
    expect(new Date(liteAfter.expires_at!).getTime()).toBeGreaterThan(
      new Date(proOnly.expires_at!).getTime(),
    );
  });
});
