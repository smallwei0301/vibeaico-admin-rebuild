/**
 * #763 Codex P1 #4 — MAIL_FROM 格式錯誤時 Resend 回 422 validation_error（"Invalid `from` field"）。
 * 經真實 send.ts 分類 + dispatchVerificationCode：必須回 503 MAIL_001 並開 10 分鐘視窗，
 * 不得被當成 recipient 而回 200（會把全站寄不出信藏起來）。只 mock resend SDK 與 DB。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const resendSend = vi.hoisted(() => vi.fn());
vi.mock('resend', () => ({ Resend: class { emails = { send: resendSend }; } }));

const state = vi.hoisted(() => ({ rows: [] as any[], exists: false }));
const fakeAdmin = {
  from: () => ({
    select: () => {
      const q: any = { eq: () => q, order: () => q, limit: () => q, maybeSingle: async () => ({ data: state.rows.at(-1) ?? null }) };
      return q;
    },
    insert: async (r: any) => { state.rows.push({ ...r, created_at: new Date().toISOString() }); return { error: null }; },
    delete: () => {
      const q: any = { eq: () => q, then: (res: any) => { state.rows = []; return Promise.resolve({ error: null }).then(res); } };
      return q;
    },
  }),
  rpc: async () => ({ data: state.exists }),
};
vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => fakeAdmin }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { dispatchVerificationCode, __resetMailConfigFailureFlag } from '@/server/send-code';

const OLD = process.env.RESEND_API_KEY;
beforeEach(() => {
  vi.useFakeTimers();
  resendSend.mockReset();
  process.env.RESEND_API_KEY = 're_x';
  state.rows = []; state.exists = false; __resetMailConfigFailureFlag();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  vi.useRealTimers(); vi.restoreAllMocks();
  if (OLD === undefined) delete process.env.RESEND_API_KEY; else process.env.RESEND_API_KEY = OLD;
});

const FROM_422 = 'Invalid `from` field. The email address needs to follow the `email@example.com` or `Name <email@example.com>` format.';

describe('MAIL_FROM 422 → MAIL_001 + 視窗 (#763 P1 #4)', () => {
  it('from 欄位 422：dispatch 拋 503 MAIL_001，視窗 10 分鐘內短路、不再呼叫 provider', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: FROM_422, statusCode: 422 } });
    await expect(dispatchVerificationCode('new@example.com', 'REGISTER')).rejects.toMatchObject({ status: 503, code: 'MAIL_001' });
    expect(resendSend).toHaveBeenCalledTimes(1);
    expect(state.rows).toHaveLength(0);
    state.exists = true;
    vi.advanceTimersByTime(9 * 60_000);
    await expect(dispatchVerificationCode('old@example.com', 'REGISTER')).rejects.toMatchObject({ status: 503, code: 'MAIL_001' });
    expect(resendSend).toHaveBeenCalledTimes(1);
  });
  it('to 欄位 422：正常返回（recipient，不開窗）', async () => {
    resendSend.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field.', statusCode: 422 } });
    await expect(dispatchVerificationCode('bad@example.com', 'REGISTER')).resolves.toBeUndefined();
    await expect(dispatchVerificationCode('bad2@example.com', 'REGISTER')).resolves.toBeUndefined();
    expect(resendSend).toHaveBeenCalledTimes(2);
  });
});
