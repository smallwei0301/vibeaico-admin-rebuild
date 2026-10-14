/** #754: real modules, in-memory SDK boundary; no HTTP server, DB or email. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  lookup: vi.fn(), consume: vi.fn(), rpc: vi.fn(), password: vi.fn(),
  filters: [] as unknown[][],
  from: vi.fn(),
}));
vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    from: sdk.from,
    rpc: sdk.rpc,
    auth: { admin: { updateUserById: sdk.password } },
  }),
}));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/reset-password/route';
import { consumeCode } from '@/server/verify-code';

const now = '2026-10-06T00:00:00.000Z';
const input = { email: 'fixture@example.com', code: '123456', newPassword: 'NewPassword123!' };
const providerError = { message: 'private provider detail', code: 'private-code', details: 'private storage detail' };
const genericFailure = { success: false, message: '系統發生錯誤，請稍後再試', code: 'SYS_001' };
const invalidCode = { success: false, message: '驗證碼錯誤或已過期', code: 'AUTH_004' };
const call = (body = input) => POST(new Request('http://localhost/api/auth/reset-password', {
  method: 'POST', body: JSON.stringify(body),
}), {});

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network is forbidden in this unit test'); }));
  sdk.filters = [];
  sdk.lookup.mockResolvedValue({ data: { id: 'code-fixture' }, error: null });
  sdk.consume.mockResolvedValue({ data: null, error: null });
  sdk.rpc.mockResolvedValue({ data: 'user-fixture', error: null });
  sdk.password.mockResolvedValue({ data: { user: { id: 'user-fixture' } }, error: null });
  sdk.from.mockImplementation(() => ({
    select: (columns: string) => {
      sdk.filters.push(['select', columns]);
      const query = {
        eq: (key: string, value: unknown) => { sdk.filters.push(['eq', key, value]); return query; },
        is: (key: string, value: unknown) => { sdk.filters.push(['is', key, value]); return query; },
        gt: (key: string, value: unknown) => { sdk.filters.push(['gt', key, value]); return query; },
        order: (key: string, value: unknown) => { sdk.filters.push(['order', key, value]); return query; },
        limit: (value: number) => { sdk.filters.push(['limit', value]); return query; },
        maybeSingle: sdk.lookup,
      };
      return query;
    },
    update: (value: unknown) => ({ eq: (key: string, id: string) => sdk.consume(value, key, id) }),
  }));
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('reset password returned-error propagation (#754)', () => {
  it('preserves success envelope, lookup constraints and exact mutation arguments', async () => {
    const response = await call();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { reset: true } });
    expect(sdk.from.mock.calls).toEqual([['auth_verification_codes'], ['auth_verification_codes']]);
    expect(sdk.filters).toEqual([
      ['select', '*'], ['eq', 'email', input.email], ['eq', 'purpose', 'RESET_PASSWORD'],
      ['eq', 'code', input.code], ['is', 'consumed_at', null], ['gt', 'expires_at', now],
      ['order', 'created_at', { ascending: false }], ['limit', 1],
    ]);
    expect(sdk.consume).toHaveBeenCalledExactlyOnceWith({ consumed_at: now }, 'id', 'code-fixture');
    expect(sdk.rpc).toHaveBeenCalledExactlyOnceWith('user_id_by_email', { p_email: input.email });
    expect(sdk.password).toHaveBeenCalledExactlyOnceWith('user-fixture', { password: input.newPassword });
    expect(sdk.consume.mock.invocationCallOrder[0]).toBeLessThan(sdk.rpc.mock.invocationCallOrder[0]);
    expect(sdk.rpc.mock.invocationCallOrder[0]).toBeLessThan(sdk.password.mock.invocationCallOrder[0]);
  });

  it.each(['returned', 'thrown'] as const)('password %s error returns generic 500, never reset:true', async (mode) => {
    if (mode === 'returned') sdk.password.mockResolvedValue({ data: null, error: providerError });
    else sdk.password.mockRejectedValue(providerError);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(genericFailure);
    expect(sdk.consume).toHaveBeenCalledTimes(1);
    expect(sdk.password).toHaveBeenCalledTimes(1);
  });

  it.each(['returned', 'thrown'] as const)('consume %s error prevents lookup and password mutation', async (mode) => {
    if (mode === 'returned') sdk.consume.mockResolvedValue({ data: null, error: providerError });
    else sdk.consume.mockRejectedValue(providerError);
    const response = await call();
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual(genericFailure);
    expect(sdk.rpc).not.toHaveBeenCalled();
    expect(sdk.password).not.toHaveBeenCalled();
  });

  it('invalid code preserves AUTH_004 and performs no downstream mutations', async () => {
    sdk.lookup.mockResolvedValue({ data: null, error: null });
    const response = await call();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(invalidCode);
    expect(sdk.consume).not.toHaveBeenCalled();
    expect(sdk.rpc).not.toHaveBeenCalled();
    expect(sdk.password).not.toHaveBeenCalled();
  });

  it('missing user preserves AUTH_004 after consumption and never changes a password', async () => {
    sdk.rpc.mockResolvedValue({ data: null, error: null });
    const response = await call();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual(invalidCode);
    expect(sdk.consume).toHaveBeenCalledTimes(1);
    expect(sdk.password).not.toHaveBeenCalled();
  });

  it('real Zod validation rejects malformed input before SDK access', async () => {
    const response = await call({ ...input, newPassword: 'short' });
    expect(response.status).toBe(400);
    expect((await response.json()).code).toBe('REQ_001');
    expect(sdk.from).not.toHaveBeenCalled();
    expect(sdk.rpc).not.toHaveBeenCalled();
    expect(sdk.password).not.toHaveBeenCalled();
  });
});

describe('shared consumeCode returned errors (#754)', () => {
  it.each(['REGISTER', 'RESET_PASSWORD'] as const)('%s propagates returned write failure', async (purpose) => {
    sdk.consume.mockResolvedValue({ data: null, error: providerError });
    await expect(consumeCode(input.email, input.code, purpose)).rejects.toEqual(providerError);
    expect(sdk.filters).toContainEqual(['eq', 'purpose', purpose]);
    expect(sdk.consume).toHaveBeenCalledExactlyOnceWith({ consumed_at: now }, 'id', 'code-fixture');
  });

  it.each(['REGISTER', 'RESET_PASSWORD'] as const)('%s permits a successful write', async (purpose) => {
    await expect(consumeCode(input.email, input.code, purpose)).resolves.toBeUndefined();
    expect(sdk.filters).toContainEqual(['eq', 'purpose', purpose]);
  });
});
