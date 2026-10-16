import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(), releaseResult: vi.fn(), updateUserById: vi.fn(), maybeSingle: vi.fn(), updateSelect: vi.fn(),
  updatePayloads: [] as unknown[], isCalls: [] as unknown[][], gtCalls: [] as unknown[][], eqCalls: [] as unknown[][], order: [] as string[],
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    rpc: mocks.rpc,
    auth: { admin: { updateUserById: mocks.updateUserById } },
    from: () => ({
      select: () => {
        const q: any = {};
        q.eq = () => q; q.is = () => q; q.gt = () => q; q.order = () => q; q.limit = () => q;
        q.maybeSingle = mocks.maybeSingle;
        return q;
      },
      update: (payload: unknown) => {
        mocks.updatePayloads.push(payload);
        const q: any = {};
        q.eq = (...a: unknown[]) => { mocks.eqCalls.push(a); return q; };
        q.is = (...a: unknown[]) => { mocks.isCalls.push(a); return q; };
        q.gt = (...a: unknown[]) => { mocks.gtCalls.push(a); return q; };
        q.select = mocks.updateSelect;
        // release 路徑沒有 .select()，直接 await 條件更新
        q.then = (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve(mocks.releaseResult()).then(res, rej);
        return q;
      },
    }),
  }),
}));

vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/reset-password/route';
import { consumeCode } from '@/server/verify-code';
import { ERR } from '@/server/http';

function request() {
  return new Request('http://localhost/api/auth/reset-password', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'owner@example.com', code: '123456', newPassword: 'new-password-1' }),
  });
}

describe('POST /api/auth/reset-password (#1028)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatePayloads.length = 0; mocks.isCalls.length = 0; mocks.gtCalls.length = 0; mocks.eqCalls.length = 0;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'code-1' } });
    mocks.rpc.mockResolvedValue({ data: 'user-1', error: null });
    mocks.updateUserById.mockResolvedValue({ data: {}, error: null });
    mocks.updateSelect.mockResolvedValue({ data: [{ id: 'code-1' }], error: null });
    mocks.releaseResult.mockReturnValue({ error: null });
  });

  const claimPayload = () => mocks.updatePayloads[0] as { consumed_at: string };
  const releaseCall = () => mocks.updatePayloads[1] as { consumed_at: null } | undefined;

  it('claim 條件帶 expires_at > claimTs，與 consumed_at 為同一時間值', async () => {
    await consumeCode('owner@example.com', '123456', 'RESET_PASSWORD');
    expect(mocks.gtCalls).toEqual([['expires_at', claimPayload().consumed_at]]);
  });

  it('成功：先占用再更新密碼，且之後不再消耗', async () => {
    const res = await POST(request(), {});
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { reset: true } });
    expect(mocks.updateUserById).toHaveBeenCalledWith('user-1', { password: 'new-password-1' });
    expect(mocks.updatePayloads).toHaveLength(1);
    expect(typeof claimPayload().consumed_at).toBe('string');
    expect(mocks.isCalls).toEqual([['consumed_at', null]]);
    expect(mocks.updateSelect.mock.invocationCallOrder[0]).toBeLessThan(mocks.updateUserById.mock.invocationCallOrder[0]);
  });

  it('並發敗方（占用 0 列）：400 CODE_INVALID 且不呼叫 updateUserById', async () => {
    mocks.updateSelect.mockResolvedValue({ data: [], error: null });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AUTH_004');
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.updatePayloads).toHaveLength(1); // 只有占用嘗試，沒有 release
  });

  it('占用遇 DB error：500，不更新密碼', async () => {
    mocks.updateSelect.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(500);
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('weak_password：400 中文訊息，釋放占用（帶正確 claimTs）', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'weak_password', status: 422, message: 'weak' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.message).toBe('新密碼不符合安全規則，請換一組更長或更複雜的密碼');
    expect(body.code).toBe('REQ_001');
    expect(body.code).toBe(ERR.VALIDATION);
    expect(mocks.updatePayloads).toHaveLength(2);
    expect(releaseCall()).toEqual({ consumed_at: null });
    expect(mocks.eqCalls).toContainEqual(['consumed_at', claimPayload().consumed_at]);
  });

  it('same_password：400 ERR.VALIDATION，不釋放並提示重新申請', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'same_password', status: 422, message: 'same' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe(ERR.VALIDATION);
    expect(body.message).toBe('新密碼不可與目前密碼相同，請重新申請驗證碼後換一組新的密碼');
    expect(body.message).toContain('重新申請驗證碼');
    expect(mocks.updatePayloads).toHaveLength(1); // 只有占用
  });

  it('user_not_found：400 CODE_INVALID，釋放占用', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'user_not_found', status: 404, message: 'nf' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AUTH_004');
    expect(releaseCall()).toEqual({ consumed_at: null });
    expect(mocks.eqCalls).toContainEqual(['consumed_at', claimPayload().consumed_at]);
  });

  it('5xx／未知更新錯誤：500 中文訊息、釋放占用且不外洩 provider 訊息', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { status: 503, message: 'upstream down' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).toContain('密碼重設失敗，請稍後再試');
    expect(text).not.toContain('upstream down');
    expect(releaseCall()).toEqual({ consumed_at: null });
  });

  it('釋放失敗（DB error）：只記 log，回應不變', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'weak_password', status: 422, message: 'weak' } });
    mocks.releaseResult.mockReturnValue({ error: { code: 'X', message: 'db down' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).message).toBe('新密碼不符合安全規則，請換一組更長或更複雜的密碼');
    expect(console.error).toHaveBeenCalled();
  });

  it('釋放丟例外：吞掉，回應不變', async () => {
    mocks.updateUserById.mockResolvedValue({ data: null, error: { code: 'user_not_found', status: 404, message: 'nf' } });
    mocks.releaseResult.mockImplementation(() => { throw new Error('boom'); });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AUTH_004');
  });

  it('rpc error：500 而非 CODE_INVALID，尚未占用、不更新密碼', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'db down' } });
    const res = await POST(request(), {});
    expect(res.status).toBe(500);
    expect((await res.json()).code).not.toBe('AUTH_004');
    expect(mocks.updateUserById).not.toHaveBeenCalled();
    expect(mocks.updatePayloads).toHaveLength(0);
  });

  it('rpc 查無使用者：400 CODE_INVALID', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AUTH_004');
    expect(mocks.updateUserById).not.toHaveBeenCalled();
  });

  it('驗證碼無效：400 CODE_INVALID，不碰 rpc', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null });
    const res = await POST(request(), {});
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('AUTH_004');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});

describe('consumeCode 行為不變', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.updatePayloads.length = 0; mocks.isCalls.length = 0; mocks.gtCalls.length = 0; mocks.eqCalls.length = 0;
    mocks.maybeSingle.mockResolvedValue({ data: { id: 'code-1' } });
    mocks.updateSelect.mockResolvedValue({ data: [{ id: 'code-1' }], error: null });
  });
  it('有效碼：驗證後條件式消耗', async () => {
    await expect(consumeCode('a@b.co', '123456', 'REGISTER')).resolves.toBeUndefined();
    expect(mocks.isCalls).toEqual([['consumed_at', null]]);
  });
  it('無效碼：丟 400 CODE_INVALID', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null });
    await expect(consumeCode('a@b.co', '123456', 'REGISTER')).rejects.toMatchObject({ status: 400, code: 'AUTH_004' });
  });
});
