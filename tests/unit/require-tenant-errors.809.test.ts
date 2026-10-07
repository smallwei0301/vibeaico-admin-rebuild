/**
 * tests/unit/require-tenant-errors.809.test.ts
 * Issue 809：`requireTenant()` 不得把 tenant_users 查詢失敗誤報成 403「此帳號未加入任何店家」。
 * 查詢失敗＝服務端錯誤（503，fail closed）；查詢成功但零筆＝才是 403。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const loadActiveImpersonationMock = vi.fn();
const membershipsResult = vi.fn<() => { data: unknown; error: unknown }>();

vi.mock('@/server/platform-admin', () => ({
  isPlatformAdmin: vi.fn(),
  loadActiveImpersonation: (...a: unknown[]) => loadActiveImpersonationMock(...a),
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: vi.fn(),
  createServerSupabase: () =>
    Promise.resolve({
      auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } }, error: null }) },
      from: () => ({
        select: () => ({ eq: () => Promise.resolve(membershipsResult()) }),
      }),
    }),
}));

vi.mock('next/headers', () => ({
  cookies: () => Promise.resolve({ get: () => undefined }),
}));

import { requireTenant } from '@/server/tenant';
import { ApiHttpError, ERR } from '@/server/http';

async function capture(p: Promise<unknown>) {
  try {
    return { value: await p, err: undefined as unknown };
  } catch (err) {
    return { value: undefined, err };
  }
}

const member = (role: string) => ({
  tenant_id: 't-1',
  role,
  tenants: { shop_code: 'shop', name: '店', business_type: 'LOCAL_SHOP' },
});

describe('requireTenant 成員資格查詢（Issue 809）', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    loadActiveImpersonationMock.mockResolvedValue(null);
  });

  it('tenant_users 查詢失敗 → 服務端錯誤（非 403），且不回傳 context', async () => {
    membershipsResult.mockReturnValue({ data: null, error: { message: 'pgrst down' } });
    const { value, err } = await capture(requireTenant());
    expect(value).toBeUndefined();
    expect(err).toBeInstanceOf(ApiHttpError);
    const e = err as ApiHttpError;
    expect(e.status).toBeGreaterThanOrEqual(500);
    expect(e.status).not.toBe(403);
    expect(e.code).toBe(ERR.INTERNAL);
  });

  it('查詢成功但零筆 → 403 FORBIDDEN「此帳號未加入任何店家」', async () => {
    membershipsResult.mockReturnValue({ data: [], error: null });
    const { err } = await capture(requireTenant());
    const e = err as ApiHttpError;
    expect(e.status).toBe(403);
    expect(e.code).toBe(ERR.FORBIDDEN);
    expect(e.message).toBe('此帳號未加入任何店家');
  });

  it('正常成員 → 回傳 context', async () => {
    membershipsResult.mockReturnValue({ data: [member('OWNER')], error: null });
    const t = await requireTenant('MANAGER');
    expect(t.tenantId).toBe('t-1');
    expect(t.role).toBe('OWNER');
  });

  it('角色等級不足 → 403 權限不足', async () => {
    membershipsResult.mockReturnValue({ data: [member('STAFF')], error: null });
    const { err } = await capture(requireTenant('MANAGER'));
    const e = err as ApiHttpError;
    expect(e.status).toBe(403);
    expect(e.message).toBe('權限不足');
  });
});
