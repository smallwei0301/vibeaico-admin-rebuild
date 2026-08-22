import { describe, it, expect, vi, beforeEach } from 'vitest';

const getUserMock = vi.fn();
const eqMock = vi.fn();
const selectMock = vi.fn(() => ({ eq: eqMock }));
const fromMock = vi.fn(() => ({ select: selectMock }));

const supabaseClient = {
  auth: { getUser: getUserMock },
  from: fromMock,
};

const createServerSupabaseMock = vi.fn(() => Promise.resolve(supabaseClient));

vi.mock('@/server/supabase', () => ({
  createServerSupabase: () => createServerSupabaseMock(),
}));

const cookieGetMock = vi.fn();
vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: cookieGetMock }),
}));

import { ACTIVE_TENANT_COOKIE, requireUser, requireTenant } from '@/server/tenant';
import { ApiHttpError } from '@/server/http';

const USER = { id: 'user-1', email: 'owner@test.local' };

function membership(tenantId: string, role: string, shopCode: string, name: string) {
  return {
    tenant_id: tenantId,
    role,
    tenants: { shop_code: shopCode, name },
  };
}

describe('tenant — requireUser (01 §5.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('有 user → 回傳 { supabase, user }', async () => {
    getUserMock.mockResolvedValue({ data: { user: USER } });
    const result = await requireUser();
    expect(result.user).toEqual(USER);
    expect(result.supabase).toBe(supabaseClient);
  });

  it('沒有 user（data.user 為 null）→ 丟 ApiHttpError 401 AUTH_001', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });
    try {
      await requireUser();
      expect.unreachable('應該要丟錯');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiHttpError);
      expect((e as ApiHttpError).status).toBe(401);
      expect((e as ApiHttpError).code).toBe('AUTH_001');
    }
  });
});

describe('tenant — requireTenant (01 §5.3)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: USER } });
    cookieGetMock.mockReturnValue(undefined);
  });

  it('沒有任何 membership（空陣列）→ 403 AUTH_005', async () => {
    eqMock.mockResolvedValue({ data: [], error: null });
    try {
      await requireTenant();
      expect.unreachable('應該要丟錯');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiHttpError);
      expect((e as ApiHttpError).status).toBe(403);
      expect((e as ApiHttpError).code).toBe('AUTH_005');
    }
  });

  it('查詢回 error → 403 AUTH_005', async () => {
    eqMock.mockResolvedValue({ data: null, error: { message: 'db error' } });
    try {
      await requireTenant();
      expect.unreachable('應該要丟錯');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiHttpError);
      expect((e as ApiHttpError).status).toBe(403);
      expect((e as ApiHttpError).code).toBe('AUTH_005');
    }
  });

  it('cookie 指定的 tenant 存在於 membership 清單 → 選中那一個（不是第一個）', async () => {
    const memberships = [
      membership('tenant-a', 'OWNER', 'shop-a', 'A 店'),
      membership('tenant-b', 'OWNER', 'shop-b', 'B 店'),
    ];
    eqMock.mockResolvedValue({ data: memberships, error: null });
    cookieGetMock.mockReturnValue({ value: 'tenant-b' });

    const result = await requireTenant();
    expect(result.tenantId).toBe('tenant-b');
    expect(result.shopCode).toBe('shop-b');
    expect(result.tenantName).toBe('B 店');
  });

  it('cookie 沒設 → 落回 memberships[0]', async () => {
    const memberships = [
      membership('tenant-a', 'OWNER', 'shop-a', 'A 店'),
      membership('tenant-b', 'OWNER', 'shop-b', 'B 店'),
    ];
    eqMock.mockResolvedValue({ data: memberships, error: null });
    cookieGetMock.mockReturnValue(undefined);

    const result = await requireTenant();
    expect(result.tenantId).toBe('tenant-a');
    expect(result.shopCode).toBe('shop-a');
  });

  it('cookie 指到不存在的 tenant → 落回 memberships[0]', async () => {
    const memberships = [
      membership('tenant-a', 'OWNER', 'shop-a', 'A 店'),
      membership('tenant-b', 'OWNER', 'shop-b', 'B 店'),
    ];
    eqMock.mockResolvedValue({ data: memberships, error: null });
    cookieGetMock.mockReturnValue({ value: 'tenant-nonexistent' });

    const result = await requireTenant();
    expect(result.tenantId).toBe('tenant-a');
  });

  it('角色門檻：requireTenant("OWNER") 但使用者是 STAFF → 403 AUTH_005', async () => {
    const memberships = [membership('tenant-a', 'STAFF', 'shop-a', 'A 店')];
    eqMock.mockResolvedValue({ data: memberships, error: null });

    try {
      await requireTenant('OWNER');
      expect.unreachable('應該要丟錯');
    } catch (e) {
      expect(e).toBeInstanceOf(ApiHttpError);
      expect((e as ApiHttpError).status).toBe(403);
      expect((e as ApiHttpError).code).toBe('AUTH_005');
    }
  });

  it('角色門檻：使用者是 OWNER，要求 STAFF → 通過', async () => {
    const memberships = [membership('tenant-a', 'OWNER', 'shop-a', 'A 店')];
    eqMock.mockResolvedValue({ data: memberships, error: null });

    const result = await requireTenant('STAFF');
    expect(result.role).toBe('OWNER');
    expect(result.tenantId).toBe('tenant-a');
  });

  it('查詢用正確的 table 名稱與 cookie 名稱常數', async () => {
    expect(ACTIVE_TENANT_COOKIE).toBe('vibeai_active_tenant');
    const memberships = [membership('tenant-a', 'MANAGER', 'shop-a', 'A 店')];
    eqMock.mockResolvedValue({ data: memberships, error: null });

    await requireTenant('MANAGER');
    expect(fromMock).toHaveBeenCalledWith('tenant_users');
    expect(eqMock).toHaveBeenCalledWith('user_id', USER.id);
  });
});
