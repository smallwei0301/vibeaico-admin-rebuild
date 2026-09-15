/**
 * tests/unit/owner-notify-routes.18.test.ts
 * -----------------------------------------------------------------------------
 * 守 Issue #18 四支端點本身的角色門檻與租戶邊界接線（商業邏輯已由
 * `tests/unit/owner-notify.18.test.ts` 覆蓋，這裡只驗證 route 層把 requireTenant
 * 的角色參數、`{ params }` 與 `t.tenantId` 正確傳下去——同 `line-disconnect-route.47.test.ts`
 * 的 mocking 風格）。老闆通知名單比顧客端 LINE 設定更敏感，寫入一律要求 OWNER；
 * 讀取（總覽、候選清單）維持一般成員（STAFF）可讀。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ApiHttpError, ERR } from '@/server/http';

type Role = 'STAFF' | 'MANAGER' | 'OWNER';

const TENANT_ID = 'tenant-a';
let currentRole: Role = 'OWNER';

const requireTenantMock = vi.fn(async (minRole: Role = 'STAFF') => {
  const rank: Record<Role, number> = { STAFF: 0, MANAGER: 1, OWNER: 2 };
  if (rank[currentRole] < rank[minRole]) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  return {
    supabase: {} as any, tenantId: TENANT_ID, tenantName: '測試店',
    user: { id: 'user-a' }, role: currentRole,
  };
});
vi.mock('@/server/tenant', () => ({ requireTenant: (...a: [Role?]) => requireTenantMock(...a) }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

const getOverviewMock = vi.fn(async (..._args: any[]) => ({ recipients: [], maxRecipients: 3, providerHealthy: false, providerHealthReason: '' }));
const listCandidatesMock = vi.fn(async (..._args: any[]) => []);
const initiateBindMock = vi.fn(async (..._args: any[]) => ({ requestId: 'req1', expiresAt: '2026-01-01T00:00:00.000Z' }));
const confirmBindMock = vi.fn(async (..._args: any[]) => ({ ok: true }) as { ok: boolean; reason?: string });
const removeAllMock = vi.fn(async (..._args: any[]) => undefined);
const removeOneMock = vi.fn(async (..._args: any[]) => undefined);
const updateOneMock = vi.fn(async (..._args: any[]) => undefined);

vi.mock('@/server/owner-notify', () => ({
  getOwnerNotifyOverview: (...a: any[]) => getOverviewMock(...a),
  listOwnerNotifyLineUserCandidates: (...a: any[]) => listCandidatesMock(...a),
  initiateOwnerNotifyBind: (...a: any[]) => initiateBindMock(...a),
  confirmOwnerNotifyBind: (...a: any[]) => confirmBindMock(...a),
  removeAllOwnerNotifyRecipients: (...a: any[]) => removeAllMock(...a),
  removeOwnerNotifyRecipient: (...a: any[]) => removeOneMock(...a),
  updateOwnerNotifyRecipient: (...a: any[]) => updateOneMock(...a),
}));
vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => ({}) }));

import { GET as overviewGET } from '@/app/api/settings/line/owner-notify/route';
import { GET as lineUsersGET } from '@/app/api/settings/line/owner-notify/line-users/route';
import { POST as bindPOST } from '@/app/api/settings/line/owner-notify/bind/route';
import { POST as recipientsPOST, DELETE as recipientsDELETEAll } from '@/app/api/settings/line/owner-notify/recipients/route';
import { PATCH as recipientPATCH, DELETE as recipientDELETE } from '@/app/api/settings/line/owner-notify/recipients/[id]/route';

function req(url: string, init?: RequestInit) {
  return new Request(url, init);
}
const noParams = { params: Promise.resolve({}) };
const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const ORIGINAL_TEST_CONFIRM_FLAG = process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED;

beforeEach(() => {
  currentRole = 'OWNER';
  // `POST recipients`（Demo 模擬確認）比照 `LINE_WEBHOOK_DRAIN_ENABLED` 收進非
  // production flag（Final Risk 覆核 PR #519 的阻斷項修正）；預設在測試環境開啟，
  // 讓既有的角色/邊界案例維持原本行為，另有專門案例驗證關閉時被拒。
  process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED = 'true';
  [getOverviewMock, listCandidatesMock, initiateBindMock, confirmBindMock, removeAllMock, removeOneMock, updateOneMock]
    .forEach((m) => m.mockClear());
});

afterEach(() => {
  if (ORIGINAL_TEST_CONFIRM_FLAG === undefined) delete process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED;
  else process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED = ORIGINAL_TEST_CONFIRM_FLAG;
});

describe('GET /api/settings/line/owner-notify — 一般成員可讀', () => {
  it('STAFF 可以讀總覽', async () => {
    currentRole = 'STAFF';
    const res = await overviewGET(req('http://localhost/api/settings/line/owner-notify'), noParams);
    expect(res.status).toBe(200);
    expect(getOverviewMock).toHaveBeenCalledWith({}, TENANT_ID);
  });
});

describe('GET /api/settings/line/owner-notify/line-users — 一般成員可讀', () => {
  it('STAFF 可以列候選好友', async () => {
    currentRole = 'STAFF';
    const res = await lineUsersGET(req('http://localhost/api/settings/line/owner-notify/line-users'), noParams);
    expect(res.status).toBe(200);
    expect(listCandidatesMock).toHaveBeenCalledWith({}, TENANT_ID);
  });
});

describe('POST /api/settings/line/owner-notify/bind — 要求 OWNER', () => {
  function call() {
    return bindPOST(req('http://localhost/api/settings/line/owner-notify/bind', {
      method: 'POST', body: JSON.stringify({ lineUserId: 'lu_1' }),
    }), noParams);
  }

  it('MANAGER 呼叫回 403，不發起邀請', async () => {
    currentRole = 'MANAGER';
    const res = await call();
    expect(res.status).toBe(403);
    expect(initiateBindMock).not.toHaveBeenCalled();
  });

  it('OWNER 呼叫 → 帶入 tenantId／tenantName／lineUserId', async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(initiateBindMock).toHaveBeenCalledWith({}, TENANT_ID, '測試店', 'lu_1');
  });
});

describe('POST /api/settings/line/owner-notify/recipients — 落地確認，要求 OWNER', () => {
  it('STAFF 呼叫回 403', async () => {
    currentRole = 'STAFF';
    const res = await recipientsPOST(req('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ requestId: '11111111-1111-1111-1111-111111111111', lineUserId: 'lu_1' }),
    }), noParams);
    expect(res.status).toBe(403);
    expect(confirmBindMock).not.toHaveBeenCalled();
  });

  it('confirmBind 回 ok:false → 轉成 409 並帶對應錯誤碼', async () => {
    confirmBindMock.mockResolvedValueOnce({ ok: false, reason: 'LIMIT_REACHED' });
    const res = await recipientsPOST(req('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ requestId: '11111111-1111-1111-1111-111111111111', lineUserId: 'lu_1' }),
    }), noParams);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('LINE_003');
  });

  it('OWNER_NOTIFY_TEST_CONFIRM_ENABLED 未開啟時，即使是 OWNER 也回 404，不呼叫 confirmBind（Final Risk PR #519 阻斷項修正）', async () => {
    delete process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED;
    const res = await recipientsPOST(req('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ requestId: '11111111-1111-1111-1111-111111111111', lineUserId: 'lu_1' }),
    }), noParams);
    expect(res.status).toBe(404);
    expect(confirmBindMock).not.toHaveBeenCalled();
  });

  it('OWNER_NOTIFY_TEST_CONFIRM_ENABLED="false"（非字面 "true"）同樣視為關閉', async () => {
    process.env.OWNER_NOTIFY_TEST_CONFIRM_ENABLED = 'false';
    const res = await recipientsPOST(req('http://localhost/x', {
      method: 'POST',
      body: JSON.stringify({ requestId: '11111111-1111-1111-1111-111111111111', lineUserId: 'lu_1' }),
    }), noParams);
    expect(res.status).toBe(404);
    expect(confirmBindMock).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/settings/line/owner-notify/recipients — remove-all，要求 OWNER', () => {
  it('MANAGER 呼叫回 403，不清空名單', async () => {
    currentRole = 'MANAGER';
    const res = await recipientsDELETEAll(req('http://localhost/x', { method: 'DELETE' }), noParams);
    expect(res.status).toBe(403);
    expect(removeAllMock).not.toHaveBeenCalled();
  });

  it('OWNER 呼叫 → 清空該租戶名單', async () => {
    const res = await recipientsDELETEAll(req('http://localhost/x', { method: 'DELETE' }), noParams);
    expect(res.status).toBe(200);
    expect(removeAllMock).toHaveBeenCalledWith({}, TENANT_ID);
  });
});

describe('PATCH/DELETE /api/settings/line/owner-notify/recipients/:id — 要求 OWNER，租戶邊界交給 supabase 邊界', () => {
  it('PATCH：MANAGER 回 403', async () => {
    currentRole = 'MANAGER';
    const res = await recipientPATCH(req('http://localhost/x', {
      method: 'PATCH', body: JSON.stringify({ notifyNewBooking: false }),
    }), idParams('r1'));
    expect(res.status).toBe(403);
    expect(updateOneMock).not.toHaveBeenCalled();
  });

  it('PATCH：OWNER → 帶入 tenantId／id／patch', async () => {
    const res = await recipientPATCH(req('http://localhost/x', {
      method: 'PATCH', body: JSON.stringify({ isPrimary: true }),
    }), idParams('r1'));
    expect(res.status).toBe(200);
    expect(updateOneMock).toHaveBeenCalledWith({}, TENANT_ID, 'r1', { isPrimary: true });
  });

  it('DELETE：STAFF 回 403', async () => {
    currentRole = 'STAFF';
    const res = await recipientDELETE(req('http://localhost/x', { method: 'DELETE' }), idParams('r1'));
    expect(res.status).toBe(403);
    expect(removeOneMock).not.toHaveBeenCalled();
  });

  it('DELETE：OWNER → 帶入 tenantId／id', async () => {
    const res = await recipientDELETE(req('http://localhost/x', { method: 'DELETE' }), idParams('r1'));
    expect(res.status).toBe(200);
    expect(removeOneMock).toHaveBeenCalledWith({}, TENANT_ID, 'r1');
  });
});
