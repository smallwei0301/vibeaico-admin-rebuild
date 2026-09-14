/**
 * tests/unit/traveler-risk-policy-route.44.test.ts
 * -----------------------------------------------------------------------------
 * 守 `src/app/api/customers/[id]/risk-policy/route.ts` 這一層自己加的兩件事
 * （持久化層本身的 RLS 已由 `tests/integration/db/traveler-risk-policy.44.test.ts`
 * 直接對 Postgres 驗證，這裡守的是 route 有沒有把角色與租戶正確傳下去）：
 *
 *   1. POST 必須要求 MANAGER 以上（`requireTenant('MANAGER')`）——route 層的
 *      第二道防線，不是 RLS 的替代品，但拿掉它一樣是漏洞：任何用了
 *      service-role client 的呼叫路徑（例如未來 #41 自動化）都不會再經過 RLS。
 *   2. POST 在寫入前查「這位顧客是否真的屬於本租戶」時，必須用
 *      `t.tenantId` 過濾，不能只靠 `customer_id`——拿掉這個過濾器，A 店 MANAGER
 *      填入 B 店顧客的真實 id 會被誤判成「存在」，繼續往下才會被複合 FK 擋下
 *      （23503→500），使用者看到的是系統錯誤而不是清楚的 404。
 *   3. `actorUserId` 永遠用 `t.user.id`（session 使用者本人），不管 body 想帶
 *      什麼 —— 對齊 RLS `actor_user_id = auth.uid()`，但這裡守的是 route 沒有
 *      不小心把 body 的欄位原封不動 spread 進去。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

type Role = 'STAFF' | 'MANAGER' | 'OWNER';

let currentRole: Role = 'MANAGER';
const TENANT_ID = 'tenant-a';
const USER_ID = 'user-a';

/** `customers` 表的假資料：cust-a 屬本租戶，cust-b 屬別的租戶。 */
const CUSTOMER_ROWS = [
  { id: '11111111-1111-4111-8111-111111111111', tenant_id: TENANT_ID },
  { id: '22222222-2222-4222-8222-222222222222', tenant_id: 'tenant-b' },
];

function makeCustomersQuery() {
  const filters: Record<string, unknown> = {};
  const builder = {
    eq(field: string, value: unknown) {
      filters[field] = value;
      return builder;
    },
    async maybeSingle() {
      const row = CUSTOMER_ROWS.find((r) =>
        Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v));
      return { data: row ?? null, error: null };
    },
  };
  return builder;
}

const fakeSupabase = {
  from(table: string) {
    if (table !== 'customers') throw new Error(`unexpected table in test: ${table}`);
    return { select: () => makeCustomersQuery() };
  },
};

const requireTenantMock = vi.fn(async (minRole: Role = 'STAFF') => {
  const rank: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if (rank[currentRole] < rank[minRole]) {
    throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  }
  return { supabase: fakeSupabase, tenantId: TENANT_ID, user: { id: USER_ID }, role: currentRole };
});

vi.mock('@/server/tenant', () => ({
  requireTenant: (...a: [Role?]) => requireTenantMock(...a),
}));

// `handle()` 對寫入型請求會先經過 `withImpersonationAudit()`，那裡用
// `next/headers` 的 `cookies()` 找代登入 cookie——route handler 測試不在真正
// 的 request scope 裡執行，必須自己供應一個「沒有代登入 cookie」的假實作，
// 讓它在①就直接放行到 handler，同 `impersonation-write-audit.test.ts` 的作法。
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

const assignTravelerRiskPolicyMock = vi.fn();
const getCurrentTravelerRiskPolicyMock = vi.fn();
const listTravelerRiskPolicyHistoryMock = vi.fn();

vi.mock('@/server/traveler-risk-policy', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/server/traveler-risk-policy')>();
  return {
    ...actual,
    assignTravelerRiskPolicy: (...a: unknown[]) => assignTravelerRiskPolicyMock(...a),
    getCurrentTravelerRiskPolicy: (...a: unknown[]) => getCurrentTravelerRiskPolicyMock(...a),
    listTravelerRiskPolicyHistory: (...a: unknown[]) => listTravelerRiskPolicyHistoryMock(...a),
  };
});

import { GET, POST } from '@/app/api/customers/[id]/risk-policy/route';

function postReq(customerId: string, body: unknown) {
  return POST(
    new Request(`https://app.test/api/customers/${customerId}/risk-policy`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: customerId }) },
  );
}

function getReq(customerId: string) {
  return GET(
    new Request(`https://app.test/api/customers/${customerId}/risk-policy`),
    { params: Promise.resolve({ id: customerId }) },
  );
}

const VALID_BODY = {
  policy: 'REQUEST_ONLY',
  reason: '常臨時改時間',
  actorLabel: 'Wayne',
};

beforeEach(() => {
  vi.clearAllMocks();
  currentRole = 'MANAGER';
  assignTravelerRiskPolicyMock.mockResolvedValue({
    id: 'trp-1', policy: 'REQUEST_ONLY', deposit: null,
    reason: VALID_BODY.reason, actorLabel: VALID_BODY.actorLabel, createdAt: '2026-09-13T00:00:00.000Z',
  });
  getCurrentTravelerRiskPolicyMock.mockResolvedValue(null);
  listTravelerRiskPolicyHistoryMock.mockResolvedValue([]);
});

describe('GET /api/customers/:id/risk-policy', () => {
  it('任何已登入店員（預設 STAFF）都能讀，不需要 MANAGER', async () => {
    currentRole = 'STAFF';
    const res = await getReq('11111111-1111-4111-8111-111111111111');
    expect(res.status).toBe(200);
    expect(requireTenantMock).toHaveBeenCalledWith();
    expect(getCurrentTravelerRiskPolicyMock).toHaveBeenCalledWith(fakeSupabase, TENANT_ID, '11111111-1111-4111-8111-111111111111');
    expect(listTravelerRiskPolicyHistoryMock).toHaveBeenCalledWith(fakeSupabase, TENANT_ID, '11111111-1111-4111-8111-111111111111');
  });
});

describe('POST /api/customers/:id/risk-policy — 角色門檻', () => {
  it('MANAGER 可以指派政策', async () => {
    currentRole = 'MANAGER';
    const res = await postReq('11111111-1111-4111-8111-111111111111', VALID_BODY);
    expect(res.status).toBe(200);
    expect(requireTenantMock).toHaveBeenCalledWith('MANAGER');
    expect(assignTravelerRiskPolicyMock).toHaveBeenCalledTimes(1);
  });

  it('OWNER 可以指派政策', async () => {
    currentRole = 'OWNER';
    const res = await postReq('11111111-1111-4111-8111-111111111111', VALID_BODY);
    expect(res.status).toBe(200);
  });

  it('STAFF 被拒絕（403），且完全不會呼叫寫入層——這是拿掉 MANAGER 門檻就會轉紅的測試', async () => {
    currentRole = 'STAFF';
    const res = await postReq('11111111-1111-4111-8111-111111111111', VALID_BODY);
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.code).toBe(ERR.FORBIDDEN);
    expect(assignTravelerRiskPolicyMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/customers/:id/risk-policy — 租戶過濾', () => {
  it('customer_id 屬於別的租戶 → 404，不會走到寫入層（拿掉 tenant_id 過濾就會轉紅）', async () => {
    currentRole = 'MANAGER';
    const res = await postReq('22222222-2222-4222-8222-222222222222', VALID_BODY);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe(ERR.NOT_FOUND);
    expect(assignTravelerRiskPolicyMock).not.toHaveBeenCalled();
  });

  it('customer_id 不存在 → 404', async () => {
    currentRole = 'MANAGER';
    const res = await postReq('33333333-3333-4333-8333-333333333333', VALID_BODY);
    expect(res.status).toBe(404);
    expect(assignTravelerRiskPolicyMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/customers/:id/risk-policy — actor 不可由 body 冒名', () => {
  it('body 帶假的 actorUserId／customerId 也會被 route 蓋掉，寫入層只收到 session 使用者與 URL 的 customerId', async () => {
    currentRole = 'MANAGER';
    await postReq('11111111-1111-4111-8111-111111111111', { ...VALID_BODY, actorUserId: 'someone-else', customerId: '22222222-2222-4222-8222-222222222222' });

    expect(assignTravelerRiskPolicyMock).toHaveBeenCalledTimes(1);
    const [supabaseArg, tenantIdArg, actorUserIdArg, inputArg] = assignTravelerRiskPolicyMock.mock.calls[0];
    expect(supabaseArg).toBe(fakeSupabase);
    expect(tenantIdArg).toBe(TENANT_ID);
    expect(actorUserIdArg).toBe(USER_ID);
    expect(inputArg.customerId).toBe('11111111-1111-4111-8111-111111111111');
  });
});

describe('POST /api/customers/:id/risk-policy — 輸入驗證仍然生效', () => {
  it('reason 少於 4 字 → 400，不會呼叫寫入層', async () => {
    currentRole = 'MANAGER';
    const res = await postReq('11111111-1111-4111-8111-111111111111', { ...VALID_BODY, reason: '嗯' });
    expect(res.status).toBe(400);
    expect(assignTravelerRiskPolicyMock).not.toHaveBeenCalled();
  });

  it('FORCE_DEPOSIT 沒帶 deposit → 400', async () => {
    currentRole = 'MANAGER';
    const res = await postReq('11111111-1111-4111-8111-111111111111', { ...VALID_BODY, policy: 'FORCE_DEPOSIT' });
    expect(res.status).toBe(400);
    expect(assignTravelerRiskPolicyMock).not.toHaveBeenCalled();
  });
});
