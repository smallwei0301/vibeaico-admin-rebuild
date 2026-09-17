/**
 * owner-notify「3 位上限」併發修復 — migration 靜態證據（Issue #18 缺口 A，migration 0119）
 * -----------------------------------------------------------------------------
 * 舊版 `confirmOwnerNotifyBind()` 是 app 層先 count 再 insert（兩個查詢，不在
 * 同一交易）：兩個好友幾乎同時在 LINE 上按「是我，加入通知」時，兩個 webhook
 * postback 各自的 count 都可能讀到「還沒滿 3 位」，最終突破 Issue #18 明文裁決
 * 的上限，且無付費解鎖——這正是本 issue 描述的真缺口 A。
 *
 * 本 PR 是 #530 staged-release 政策下的 **migration-only PR**（同一 migration
 * 若與 `src/server/owner-notify.ts` 的 app 層改寫同 PR 出現，會觸發
 * `schema-staged-release-policy.mjs` 的 DEFAULT_OFF gate 要求，那是給「可能需要
 * 回滾切換」的功能開關設計，不適合本例的純資料庫端加固）。因此本檔只守
 * migration 本身：advisory lock 把同租戶的併發確認串行化、三段式 ACL 完整、
 * 每句過濾 tenant_id。app 層改成呼叫這支 rpc 的變更與對應測試在後續 wiring PR。
 *
 * 真的併發（多個 promise 同時打同一顆 RPC，驗證最終仍恰好 3 位）需要真實
 * Postgres 的交易語意，本 session 已嘗試 `supabase start`，卡在既有、與本
 * Issue 無關的 fresh-install-compatibility-baseline 漂移（0082 在
 * booking_addons 表建立前就引用它），因此併發 integration 證據本輪誠實記為
 * ENVIRONMENT_BLOCKER，不冒充已執行。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = process.cwd();
const stripSqlComments = (code: string): string => code.replace(/^\s*--.*$/gm, '');

const sql = readFileSync(
  resolve(ROOT, 'supabase/migrations/0119_issue_18_owner_notify_confirm_atomic.sql'),
  'utf8',
);
const acl = stripSqlComments(sql);

const rpcStart = acl.indexOf('function public.confirm_owner_notify_bind');
const rpcEnd = acl.indexOf('$$;', rpcStart) + 3;
const rpcBody = acl.slice(rpcStart, rpcEnd);

describe('migration 0119：advisory lock 把同租戶的併發確認串行化', () => {
  it('confirm_owner_notify_bind 在 count 之前先拿 per-tenant advisory lock', () => {
    const iLock = rpcBody.indexOf('pg_advisory_xact_lock');
    const iCount = rpcBody.indexOf('select count(*) into v_count');
    expect(iLock, '沒有拿 advisory lock，count 前仍可能有併發窗口').toBeGreaterThan(-1);
    expect(iCount).toBeGreaterThan(-1);
    expect(iLock, 'advisory lock 必須在 count 之前，否則鎖沒有意義').toBeLessThan(iCount);
  });

  it('lock key 帶租戶 id，不同租戶不互相阻塞', () => {
    expect(rpcBody).toMatch(/hashtext\(p_tenant_id::text \|\| ':owner_notify_recipients'\)/);
  });

  it('bind request 用 for update 鎖列，避免同一請求被兩邊同時消費', () => {
    expect(rpcBody).toMatch(/from public\.owner_notify_bind_requests[\s\S]{0,120}?for update/);
  });

  it('count 與上限比較仍是 >=（不是 >，避免差一錯誤放進第 4 位）', () => {
    expect(rpcBody).toMatch(/v_count >= public\.owner_notify_max_recipients\(\)/);
  });

  it('四種結果（成功／INVALID_OR_USED／USER_MISMATCH／EXPIRED／LIMIT_REACHED）都在同一支函式內處理', () => {
    for (const reason of ['INVALID_OR_USED', 'USER_MISMATCH', 'EXPIRED', 'LIMIT_REACHED']) {
      expect(rpcBody, `缺少 ${reason} 分支`).toContain(reason);
    }
  });

  it('第一位加入者仍自動成為 primary（沿用既有規則，不因改寫而變動語意）', () => {
    expect(rpcBody).toMatch(/values \(p_tenant_id, p_line_user_id, v_count = 0\)/);
  });
});

describe('RPC 執行權：撤到 PUBLIC，不只撤 anon/authenticated（同 0090/#271 的既有慣例）', () => {
  const SIGNATURE = 'public.confirm_owner_notify_bind(uuid, uuid, text)';
  const escaped = SIGNATURE.replace(/[()]/g, '\\$&');

  it('函式是 security definer', () => {
    expect(rpcBody).toContain('security definer');
  });

  it('撤掉 PUBLIC 的預設 EXECUTE', () => {
    expect(acl).toMatch(new RegExp(`revoke all on function ${escaped}\\s+from public`));
  });

  it('明確撤掉 anon 與 authenticated', () => {
    expect(acl).toMatch(new RegExp(`revoke all on function ${escaped}\\s+from anon, authenticated`));
  });

  it('只把 EXECUTE 給回 service_role', () => {
    expect(acl).toMatch(new RegExp(`grant execute on function ${escaped}\\s+to service_role`));
  });
});

describe('每一句都以 tenant_id = p_tenant_id 過濾（security definer 繞過 RLS）', () => {
  it('至少 3 處明確的 tenant_id 過濾（bind request 查詢／count／update 標記）', () => {
    const filters = rpcBody.match(/tenant_id = p_tenant_id/g) ?? [];
    expect(filters.length).toBeGreaterThanOrEqual(3);
  });
});
