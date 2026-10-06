/**
 * #764 — 鎖住順序：parity 視窗檢查必須早於 60 秒重寄冷卻（429）。
 * 寄給 X 成功 → 寄給 Y 失敗開窗 → X 在視窗內須回 503（視窗），不得回 429（冷卻）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = { email: string; purpose: string; code: string; created_at: string };
const state = { rows: [] as Row[], exists: false };
const mail = vi.hoisted(() => ({ fn: vi.fn() }));

const fakeAdmin = {
  from: () => ({
    select: () => {
      const f: Record<string, string> = {};
      const q: any = {
        eq: (k: string, v: string) => { f[k] = v; return q; }, order: () => q, limit: () => q,
        // 依 email／purpose 過濾（與真實查詢一致），X 的冷卻不得套到 Y
        maybeSingle: async () => ({
          data: state.rows.filter((r) => r.email === f.email && r.purpose === f.purpose).at(-1) ?? null,
        }),
      };
      return q;
    },
    insert: async (r: any) => { state.rows.push({ ...r, created_at: new Date().toISOString() }); return { error: null }; },
    delete: () => {
      const f: Record<string, string> = {};
      const q: any = {
        eq: (k: string, v: string) => { f[k] = v; return q; },
        then: (res: any) => {
          state.rows = state.rows.filter((r) => !(r.email === f.email && r.purpose === f.purpose && r.code === f.code));
          return Promise.resolve({ error: null }).then(res);
        },
      };
      return q;
    },
  }),
  rpc: async () => ({ data: state.exists }),
};

vi.mock('@/server/supabase', () => ({ createAdminSupabase: () => fakeAdmin }));
vi.mock('@/server/email/send', () => ({ sendVerificationCodeEmail: mail.fn }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/send-verification-code/route';
import { __resetMailConfigFailureFlag } from '@/server/send-code';

const reg = (email: string) =>
  POST(new Request('http://localhost/api/auth/send-verification-code', {
    method: 'POST', body: JSON.stringify({ email, purpose: 'REGISTER' }),
  }), {});

const TRANSIENT = { result: 'FAILED', configFailure: false, failureKind: 'service' };
const SENT = { result: 'SENT', configFailure: false, failureKind: null };

beforeEach(() => {
  vi.useFakeTimers();
  state.rows = []; state.exists = false; mail.fn.mockReset(); __resetMailConfigFailureFlag();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('視窗檢查先於 60 秒冷卻 (#764)', () => {
  it('X 寄成功、Y 失敗開窗後，X 於視窗內回 503 MAIL_001 而非 429；視窗與冷卻到期後回 200', async () => {
    mail.fn.mockResolvedValueOnce(SENT);
    expect((await reg('x@example.com')).status).toBe(200); // X 有一筆 <60 秒的碼
    expect(state.rows).toHaveLength(1);

    mail.fn.mockResolvedValueOnce(TRANSIENT);
    expect((await reg('y@example.com')).status).toBe(503); // 開啟 60 秒視窗
    mail.fn.mockClear();

    vi.advanceTimersByTime(30_000); // 視窗與 X 的冷卻都仍有效
    const res = await reg('x@example.com');
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe('MAIL_001');
    expect(mail.fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(31_000); // 視窗（60s）與冷卻（60s）皆過
    mail.fn.mockResolvedValueOnce(SENT);
    expect((await reg('x@example.com')).status).toBe(200);
  });
});
