import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createUser: vi.fn(), settingsInsert: vi.fn() }));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    auth: { admin: { createUser: mocks.createUser, deleteUser: vi.fn() } },
    from: (table: string) => {
      if (table === 'tenants') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }),
          delete: () => ({ eq: async () => ({ error: null }) }),
          insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'tenant-1' }, error: null }) }) }),
        };
      }
      if (table === 'tenant_settings') {
        return { insert: async (row: unknown) => { mocks.settingsInsert(row); return { error: null }; } };
      }
      return { insert: async () => ({ error: null }) };
    },
  }),
}));
vi.mock('@/server/verify-code', () => ({ consumeCode: vi.fn().mockResolvedValue(undefined) }));
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

describe('register 店家電話寫入 basic.tenantPhone', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  });

  it('帶 phone → tenant_settings.basic.tenantPhone 持久化', async () => {
    const res = await POST(req({ ...base, phone: ' 0912-345 678 ' }), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('0912-345 678');
  });

  it('省略 phone → tenantPhone 為預設空字串', async () => {
    const res = await POST(req(base), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('');
  });

  it('非法 phone → 400 且不建帳號', async () => {
    for (const phone of ['abc123', '1'.repeat(21)]) {
      const res = await POST(req({ ...base, phone }), {});
      expect(res.status).toBe(400);
    }
    expect(mocks.createUser).not.toHaveBeenCalled();
  });
});

describe('register 頁面原始碼', () => {
  const src = readFileSync('src/app/tenant/register/page.tsx', 'utf8');
  it('payload 帶 phone', () => {
    expect(src).toMatch(/registerTenant\(\{[\s\S]*phone: form\.phone\.trim\(\)[\s\S]*\}\)/);
  });
  it('推薦碼 input 停用且不再持有值', () => {
    expect(src).toMatch(/id="referralCode"[\s\S]*?disabled/);
    expect(src).not.toContain("set('referralCode')");
  });
});
