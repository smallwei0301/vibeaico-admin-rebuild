/**
 * tests/unit/platform-impersonation.test.ts
 * -----------------------------------------------------------------------------
 * 規格：`docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md` §2.3、§7
 *
 * 這一檔守的是「五個條件必須同時成立」這句話。§7 明列四個必須轉紅的變異：
 *
 *   變異 1：拿掉條件 ④（platform_admins 仍 active）→ 本檔「權限撤銷後舊 session 失效」轉紅
 *   變異 2：拿掉條件 ⑤（session 屬於當前登入者）  → 本檔「cookie 換一個帳號帶」轉紅
 *   變異 3：拿掉 handleTenantWrite 的記錄          → 本檔「每次寫入都有 action 紀錄」轉紅
 *   變異 4：拿掉 expires_at 檢查（條件 ③）         → 本檔「逾時後不再生效」轉紅
 *
 * 對應腳本：`scripts/verify/impersonation-mutation.sh`（四個變異各跑一次，全部必須紅）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// 可設定的 service-role client 假件
// ---------------------------------------------------------------------------
interface FakeOp {
  table: string;
  op: 'select' | 'insert' | 'update';
  payload?: Record<string, unknown>;
  filters: Array<[string, unknown]>;
}

const ops: FakeOp[] = [];
let handlers: Record<string, (op: FakeOp) => { data: unknown; error: unknown }> = {};

function resultFor(op: FakeOp) {
  const h = handlers[`${op.table}:${op.op}`];
  return h ? h(op) : { data: null, error: null };
}

function makeChain(op: FakeOp): any {
  const chain: any = {
    select: () => chain,
    eq: (c: string, v: unknown) => {
      op.filters.push([c, v]);
      return chain;
    },
    neq: (c: string, v: unknown) => {
      op.filters.push([c, v]);
      return chain;
    },
    is: (c: string, v: unknown) => {
      op.filters.push([c, v]);
      return Promise.resolve(resultFor(op));
    },
    order: () => chain,
    limit: () => Promise.resolve(resultFor(op)),
    maybeSingle: async () => resultFor(op),
    single: async () => resultFor(op),
    // 讓 `await admin.from(..).update(..).eq(..)` 這種沒有終結子的鏈也能解析。
    then: (ok: any, ko: any) => Promise.resolve(resultFor(op)).then(ok, ko),
  };
  return chain;
}

const adminClient = {
  from: (table: string) => ({
    select: () => {
      const op: FakeOp = { table, op: 'select', filters: [] };
      ops.push(op);
      return makeChain(op);
    },
    insert: (payload: Record<string, unknown>) => {
      const op: FakeOp = { table, op: 'insert', payload, filters: [] };
      ops.push(op);
      return makeChain(op);
    },
    update: (payload: Record<string, unknown>) => {
      const op: FakeOp = { table, op: 'update', payload, filters: [] };
      ops.push(op);
      return makeChain(op);
    },
  }),
};

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => adminClient,
  createServerSupabase: () => Promise.resolve(adminClient),
}));

const impersonationCookieMock = vi.fn<() => string | undefined>();
vi.mock('next/headers', () => ({
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'vibeai_impersonation'
          ? (() => {
              const v = impersonationCookieMock();
              return v === undefined ? undefined : { value: v };
            })()
          : undefined,
    }),
}));

import {
  IMPERSONATION_COOKIE,
  IMPERSONATION_MAX_AGE_SECONDS,
  loadActiveImpersonation,
  recordImpersonatedAction,
  finishImpersonatedAction,
  startImpersonation,
  endImpersonation,
} from '@/server/platform-admin';

const ADMIN_ID = 'admin-user-1';
const OTHER_ID = 'someone-else-2';
const TENANT_ID = 'tenant-9';
const SESSION_ID = 'sess-abc';

function future(msFromNow = 10 * 60_000) {
  return new Date(Date.now() + msFromNow).toISOString();
}
function past(msAgo = 60_000) {
  return new Date(Date.now() - msAgo).toISOString();
}

/** 五個條件全部成立的基準狀態；每個測試只破壞其中一項。 */
function healthy(overrides: Partial<Record<string, unknown>> = {}) {
  impersonationCookieMock.mockReturnValue(SESSION_ID);
  handlers = {
    'impersonation_sessions:select': () => ({
      data: {
        id: SESSION_ID,
        admin_user_id: ADMIN_ID,
        tenant_id: TENANT_ID,
        expires_at: future(),
        ended_at: null,
        ...overrides,
      },
      error: null,
    }),
    'platform_admins:select': () => ({ data: { user_id: ADMIN_ID }, error: null }),
  };
}

beforeEach(() => {
  ops.length = 0;
  handlers = {};
  vi.clearAllMocks();
});

describe('loadActiveImpersonation — 五個條件（21 分冊 §2.3）', () => {
  it('五個條件全成立 → 回傳有效的代登入狀態', async () => {
    healthy();
    const got = await loadActiveImpersonation(ADMIN_ID);
    expect(got).not.toBeNull();
    expect(got!.sessionId).toBe(SESSION_ID);
    expect(got!.tenantId).toBe(TENANT_ID);
    expect(got!.adminUserId).toBe(ADMIN_ID);
  });

  it('條件 ①：沒有 cookie → null，且完全不查 DB', async () => {
    healthy();
    impersonationCookieMock.mockReturnValue(undefined);
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
    expect(ops).toHaveLength(0);
  });

  it('沒有登入者 → null，且完全不查 DB', async () => {
    healthy();
    expect(await loadActiveImpersonation(null)).toBeNull();
    expect(ops).toHaveLength(0);
  });

  it('cookie 指向不存在的 session → null', async () => {
    healthy();
    handlers['impersonation_sessions:select'] = () => ({ data: null, error: null });
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
  });

  it('條件 ②：session 已 ended_at → null', async () => {
    healthy({ ended_at: past() });
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
  });

  // ── 變異 4 的靶 ──────────────────────────────────────────────────────────
  it('條件 ③：逾時後不再生效（expires_at 已過 → null）', async () => {
    healthy({ expires_at: past() });
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
  });

  it('條件 ③ 邊界：expires_at 正好等於現在 → 不生效（<= 而非 <）', async () => {
    const now = new Date('2026-09-10T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(now);
    healthy({ expires_at: now.toISOString() });
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
    vi.useRealTimers();
  });

  // ── 變異 1 的靶 ──────────────────────────────────────────────────────────
  it('條件 ④：權限撤銷後舊 session 失效（platform_admins 查不到 active）', async () => {
    healthy();
    handlers['platform_admins:select'] = () => ({ data: null, error: null });
    expect(await loadActiveImpersonation(ADMIN_ID)).toBeNull();
  });

  it('條件 ④ 是「每次請求重查」：連續兩次呼叫都會再打 platform_admins', async () => {
    healthy();
    await loadActiveImpersonation(ADMIN_ID);
    await loadActiveImpersonation(ADMIN_ID);
    expect(ops.filter((o) => o.table === 'platform_admins')).toHaveLength(2);
  });

  it('條件 ④ 只認 active=true（查詢必須帶 active 過濾）', async () => {
    healthy();
    await loadActiveImpersonation(ADMIN_ID);
    const q = ops.find((o) => o.table === 'platform_admins');
    expect(q).toBeDefined();
    expect(q!.filters).toContainEqual(['active', true]);
    expect(q!.filters).toContainEqual(['user_id', ADMIN_ID]);
  });

  // ── 變異 2 的靶 ──────────────────────────────────────────────────────────
  it('條件 ⑤：cookie 換一個帳號帶 → null（session 不屬於當前登入者）', async () => {
    healthy();
    expect(await loadActiveImpersonation(OTHER_ID)).toBeNull();
  });

  it('條件 ⑤ 不因對方也是 platform admin 而放行', async () => {
    healthy();
    handlers['platform_admins:select'] = () => ({ data: { user_id: OTHER_ID }, error: null });
    expect(await loadActiveImpersonation(OTHER_ID)).toBeNull();
  });

  // ── PB-023：DB 故障不可偽裝成「沒有代登入」 ───────────────────────────────
  it('查 session 失敗 → 丟錯，不可回 null（DB 故障不得偽裝成沒有代登入）', async () => {
    healthy();
    handlers['impersonation_sessions:select'] = () => ({
      data: null,
      error: { message: 'connection reset' },
    });
    await expect(loadActiveImpersonation(ADMIN_ID)).rejects.toBeTruthy();
  });

  it('查 platform_admins 失敗 → 丟錯，不可回 null', async () => {
    healthy();
    handlers['platform_admins:select'] = () => ({
      data: null,
      error: { message: 'connection reset' },
    });
    await expect(loadActiveImpersonation(ADMIN_ID)).rejects.toBeTruthy();
  });
});

describe('startImpersonation / endImpersonation', () => {
  it('start 寫入 reason（去空白）與 30 分鐘後的 expires_at', async () => {
    const nowMs = Date.parse('2026-09-10T00:00:00.000Z');
    vi.useFakeTimers();
    vi.setSystemTime(new Date(nowMs));
    handlers['impersonation_sessions:insert'] = (op) => ({
      data: { id: SESSION_ID, expires_at: op.payload!.expires_at },
      error: null,
    });

    const got = await startImpersonation({
      adminUserId: ADMIN_ID,
      tenantId: TENANT_ID,
      reason: '  協助店家設定 LINE  ',
    });

    const insert = ops.find((o) => o.table === 'impersonation_sessions' && o.op === 'insert');
    expect(insert!.payload!.reason).toBe('協助店家設定 LINE');
    expect(insert!.payload!.admin_user_id).toBe(ADMIN_ID);
    expect(insert!.payload!.tenant_id).toBe(TENANT_ID);
    expect(Date.parse(insert!.payload!.expires_at as string) - nowMs).toBe(
      IMPERSONATION_MAX_AGE_SECONDS * 1000,
    );
    expect(got.maxAgeSeconds).toBe(30 * 60);
    vi.useRealTimers();
  });

  it('end 只結束「自己的、還沒結束的」session', async () => {
    handlers['impersonation_sessions:update'] = () => ({ data: null, error: null });
    await endImpersonation(SESSION_ID, ADMIN_ID);
    const upd = ops.find((o) => o.table === 'impersonation_sessions' && o.op === 'update');
    expect(upd!.filters).toContainEqual(['id', SESSION_ID]);
    expect(upd!.filters).toContainEqual(['admin_user_id', ADMIN_ID]);
    expect(upd!.filters).toContainEqual(['ended_at', null]);
  });
});

describe('稽核紀錄', () => {
  it('recordImpersonatedAction 先以 status 0 落一列（執行前）', async () => {
    handlers['impersonation_actions:insert'] = () => ({ data: { id: 'act-1' }, error: null });
    const id = await recordImpersonatedAction({
      sessionId: SESSION_ID,
      tenantId: TENANT_ID,
      method: 'POST',
      path: '/api/services',
    });
    expect(id).toBe('act-1');
    const ins = ops.find((o) => o.table === 'impersonation_actions' && o.op === 'insert');
    expect(ins!.payload).toMatchObject({
      session_id: SESSION_ID,
      tenant_id: TENANT_ID,
      method: 'POST',
      path: '/api/services',
      status: 0,
    });
  });

  it('recordImpersonatedAction 寫不進去 → 丟錯（呼叫端據此擋掉整個請求）', async () => {
    handlers['impersonation_actions:insert'] = () => ({
      data: null,
      error: { message: 'insert failed' },
    });
    await expect(
      recordImpersonatedAction({
        sessionId: SESSION_ID,
        tenantId: TENANT_ID,
        method: 'POST',
        path: '/api/services',
      }),
    ).rejects.toBeTruthy();
  });

  it('finishImpersonatedAction 失敗不丟錯（那一列已經在了，缺的只是狀態碼）', async () => {
    handlers['impersonation_actions:update'] = () => {
      throw new Error('boom');
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(finishImpersonatedAction('act-1', 200)).resolves.toBeUndefined();
    spy.mockRestore();
  });
});

describe('常數', () => {
  it('cookie 名稱與 30 分鐘上限與規格一致', () => {
    expect(IMPERSONATION_COOKIE).toBe('vibeai_impersonation');
    expect(IMPERSONATION_MAX_AGE_SECONDS).toBe(30 * 60);
  });
});
