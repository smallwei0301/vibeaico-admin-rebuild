import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ createUser: vi.fn(), deleteUser: vi.fn(), consumeCode: vi.fn() }));
const from = vi.hoisted(() => vi.fn<(table: string) => any>((table: string) => {
  if (table !== 'tenants') throw new Error(`unexpected table before createUser: ${table}`);
  return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({ auth: { admin: { createUser: mocks.createUser, deleteUser: mocks.deleteUser } }, from }),
}));
vi.mock('@/server/verify-code', () => ({ consumeCode: mocks.consumeCode }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/tenant/register/route';

const payload = {
  email: 'owner@example.com', code: '123456', password: 'password-123',
  tenantName: 'Example Shop', shopCode: 'example-shop',
};

function request() {
  return new Request('http://localhost/api/auth/tenant/register', {
    method: 'POST', body: JSON.stringify(payload), headers: { 'content-type': 'application/json' },
  });
}

describe('POST /api/auth/tenant/register createUser errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.consumeCode.mockResolvedValue(undefined);
  });

  it('maps only the documented email_exists error to non-enumerating 409 AUTH_003', async () => {
    mocks.createUser.mockResolvedValue({ data: { user: null }, error: { code: 'email_exists', message: 'Email already registered' } });

    const res = await POST(request(), {});

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, message: 'Email 已註冊', code: 'AUTH_003' });
    expect(mocks.consumeCode).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith('tenant_users');
    expect(from).not.toHaveBeenCalledWith('tenant_settings');
    expect(mocks.deleteUser).not.toHaveBeenCalled();
  });

  for (const error of [
    { code: 'unexpected_failure', message: 'upstream returned 502' },
    { code: 'email_not_confirmed', message: 'unrelated 422 is not duplicate' },
    { message: 'missing provider code' },
  ]) {
    it(`keeps provider failure generic for ${JSON.stringify(error)}`, async () => {
      const log = vi.spyOn(console, 'error').mockImplementation(() => {});
      mocks.createUser.mockResolvedValue({ data: { user: null }, error });

      const res = await POST(request(), {});
      const responseText = await res.clone().text();

      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ success: false, message: '系統發生錯誤，請稍後再試', code: 'SYS_001' });
      expect(responseText).not.toContain(error.message);
      expect(mocks.consumeCode).toHaveBeenCalledOnce();
      expect(from).toHaveBeenCalledTimes(1);
      expect(from).not.toHaveBeenCalledWith('tenant_users');
      expect(from).not.toHaveBeenCalledWith('tenant_settings');
      expect(mocks.deleteUser).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
    });
  }

  it('treats a rejected createUser call as the same generic error and does not retry it', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createUser.mockRejectedValue(new Error('network unavailable'));

    const res = await POST(request(), {});

    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe('SYS_001');
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledTimes(1);
    expect(from).not.toHaveBeenCalledWith('tenant_users');
    expect(from).not.toHaveBeenCalledWith('tenant_settings');
    expect(mocks.deleteUser).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledOnce();
  });

  it('preserves the existing success flow after createUser succeeds', async () => {
    let tenantCalls = 0;
    from.mockImplementation((table: string) => {
      if (table === 'tenants' && tenantCalls++ === 0) {
        return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) };
      }
      if (table === 'tenants') {
        return { insert: () => ({ select: () => ({ single: async () => ({ data: { id: 'tenant-1' }, error: null }) }) }) };
      }
      if (table === 'tenant_users' || table === 'tenant_settings') return { insert: async () => ({ error: null }) };
      throw new Error(`unexpected table: ${table}`);
    });
    mocks.createUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });

    const res = await POST(request(), {});

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { registered: true } });
    expect(mocks.createUser).toHaveBeenCalledOnce();
    expect(from).toHaveBeenCalledWith('tenant_users');
    expect(from).toHaveBeenCalledWith('tenant_settings');
  });
});
