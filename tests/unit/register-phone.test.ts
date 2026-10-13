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

import { normalizeTenantPhone } from '@/lib/tenant-phone';
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
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('0912345678');
  });

  it('省略 phone → tenantPhone 為預設空字串', async () => {
    const res = await POST(req(base), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('');
  });

  it('非法 phone（符號/空白/位數不符）→ 400 且不建帳號', async () => {
    for (const phone of ['abc123', '-', '+', '   ', '0912', '091234567890', '1'.repeat(41)]) {
      const res = await POST(req({ ...base, phone }), {});
      expect(res.status).toBe(400);
    }
    expect(mocks.createUser).not.toHaveBeenCalled();
    expect(mocks.settingsInsert).not.toHaveBeenCalled();
  });

  it('直接 POST "(02)2345-6789" → 存正規化 0223456789', async () => {
    const res = await POST(req({ ...base, phone: '(02)2345-6789' }), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('0223456789');
  });

  it('phone "" → 視為未提供，存 \'\'', async () => {
    const res = await POST(req({ ...base, phone: '' }), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('');
  });
});

describe('normalizeTenantPhone', () => {
  it('去除非數字字元', () => {
    expect(normalizeTenantPhone('(02)2345-6789')).toBe('0223456789');
    expect(normalizeTenantPhone('0912.345.678')).toBe('0912345678');
    expect(normalizeTenantPhone('0912/345/678')).toBe('0912345678');
    expect(normalizeTenantPhone(' 0912 345 678 ')).toBe('0912345678');
  });
  it('正規化後的值可通過後端並持久化', async () => {
    vi.clearAllMocks();
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    const res = await POST(req({ ...base, phone: normalizeTenantPhone('(02)2345-6789') }), {});
    expect(res.status).toBe(200);
    expect(mocks.settingsInsert.mock.calls[0][0].basic.tenantPhone).toBe('0223456789');
  });
});

describe('register 頁面原始碼', () => {
  const src = readFileSync('src/app/tenant/register/page.tsx', 'utf8');
  it('payload 帶 phone', () => {
    expect(src).toMatch(/registerTenant\(\{[\s\S]*phone: normalizeTenantPhone\(form\.phone\)[\s\S]*\}\)/);
  });
  it('不再送出未正規化的 form.phone.trim()', () => {
    expect(src).not.toContain('form.phone.trim()');
  });
  it('推薦碼 input 以 aria-describedby 連結說明文字', () => {
    expect(src).toContain('aria-describedby="referralCode-note"');
    expect(src).toContain('<FormText id="referralCode-note">');
  });
  it('推薦碼 input 停用且不再持有值', () => {
    expect(src).toMatch(/id="referralCode"[\s\S]*?disabled/);
    expect(src).not.toContain("set('referralCode')");
  });
});
