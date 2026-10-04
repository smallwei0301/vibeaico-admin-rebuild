import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createUser: vi.fn(), deleteUser: vi.fn(), consumeCode: vi.fn(), tenantInsert: vi.fn(),
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } },
    from: (table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          insert: (row: unknown) => {
            mocks.tenantInsert(row);
            return { select: () => ({ single: async () => ({ data: { id: 'tenant-1' }, error: null }) }) };
          },
        };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));
vi.mock('@/server/verify-code', () => ({ consumeCode: mocks.consumeCode }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/tenant/register/route';

const base = {
  email: 'owner@example.com', code: '123456', password: 'password-123',
  tenantName: 'Example Shop', shopCode: 'example-shop',
};

const req = (body: Record<string, unknown>) =>
  new Request('http://localhost/api/auth/tenant/register', {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  });

describe('#754 register 業態寫入 tenants.business_type', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeCode.mockResolvedValue(undefined);
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('body 帶 GUIDE → tenants insert 收到 business_type GUIDE', async () => {
    const res = await POST(req({ ...base, businessType: 'GUIDE' }), {});
    expect(res.status).toBe(200);
    expect(mocks.tenantInsert).toHaveBeenCalledWith(expect.objectContaining({ business_type: 'GUIDE' }));
  });

  it('省略 businessType → 預設 LOCAL_SHOP', async () => {
    const res = await POST(req(base), {});
    expect(res.status).toBe(200);
    expect(mocks.tenantInsert).toHaveBeenCalledWith(expect.objectContaining({ business_type: 'LOCAL_SHOP' }));
  });

  it('非法值 FOO → 400，且不建帳號、不寫入、不消耗驗證碼', async () => {
    const res = await POST(req({ ...base, businessType: 'FOO' }), {});
    expect(res.status).toBe(400);
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.tenantInsert).not.toHaveBeenCalled();
    expect(mocks.consumeCode).not.toHaveBeenCalled();
  });

  it('前端：register 頁把 businessType 傳給 registerTenant，service payload 型別含 businessType', () => {
    const page = readFileSync('src/app/tenant/register/page.tsx', 'utf8');
    const call = page.slice(page.indexOf('registerTenant({'));
    expect(call.slice(0, call.indexOf('});'))).toMatch(/\bbusinessType\b/);
    const svc = readFileSync('src/services/auth.ts', 'utf8');
    const decl = svc.slice(svc.indexOf('export const registerTenant'));
    expect(decl.slice(0, decl.indexOf('=>'))).toMatch(/businessType\?: BusinessType/);
    expect(decl).toMatch(/body: JSON\.stringify\(payload\)/);
  });
});
