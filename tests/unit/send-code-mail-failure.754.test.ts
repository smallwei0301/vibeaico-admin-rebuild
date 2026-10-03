/**
 * #754 — 驗證信寄送失敗時，API 不得回 sent:true。
 * 以真實的 route + dispatchVerificationCode，mock 掉 DB 與寄信底層。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

type Row = { email: string; purpose: string; code: string; created_at: string };
const state = { rows: [] as Row[], exists: false };
const mail = vi.hoisted(() => ({ fn: vi.fn() }));

const fakeAdmin = {
  from: () => ({
    select: () => {
      const q: any = {
        eq: () => q, order: () => q, limit: () => q,
        maybeSingle: async () => ({ data: state.rows.at(-1) ?? null }),
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
import { POST as FORGOT } from '@/app/api/auth/forgot-password/route';
import { __resetMailConfigFailureFlag } from '@/server/send-code';

const call = (email: string, purpose = 'REGISTER') =>
  POST(new Request('http://localhost/api/auth/send-verification-code', {
    method: 'POST', body: JSON.stringify({ email, purpose }),
  }), {});

beforeEach(() => {
  state.rows = []; state.exists = false; mail.fn.mockReset(); __resetMailConfigFailureFlag();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe('send-verification-code 寄信失敗誠實回報 (#754)', () => {
  it('SENT → 200 sent:true，驗證碼保留', async () => {
    mail.fn.mockResolvedValue({ result: 'SENT', configFailure: false });
    const res = await call('a@example.com');
    expect(res.status).toBe(200);
    expect((await res.json()).data.sent).toBe(true);
    expect(state.rows).toHaveLength(1);
  });

  it('provider 401（設定類）→ 503 MAIL_001，驗證碼被刪除，不外洩 provider 細節', async () => {
    mail.fn.mockResolvedValue({ result: 'FAILED', configFailure: true });
    const res = await call('a@example.com');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.code).toBe('MAIL_001');
    expect(body.message).toBe('驗證信暫時無法寄出，請稍後再試或聯絡我們');
    expect(JSON.stringify(body)).not.toMatch(/API key|401|resend/i);
    expect(state.rows).toHaveLength(0);
  });

  it('暫時性失敗 → 503，驗證碼被刪除，且不影響之後的已存在 email', async () => {
    mail.fn.mockResolvedValue({ result: 'FAILED', configFailure: false });
    expect((await call('a@example.com')).status).toBe(503);
    expect(state.rows).toHaveLength(0);
    state.exists = true;
    const res = await call('b@example.com');
    expect(res.status).toBe(200);
    expect(mail.fn).toHaveBeenCalledTimes(1);
  });

  it('無 key（SKIPPED_NO_KEY）→ 503，驗證碼被刪除', async () => {
    mail.fn.mockResolvedValue({ result: 'SKIPPED_NO_KEY', configFailure: true });
    const res = await call('a@example.com');
    expect(res.status).toBe(503);
    expect(state.rows).toHaveLength(0);
  });

  it('設定類失敗後，已存在 email（原本不寄信）也回同一個 503', async () => {
    mail.fn.mockResolvedValue({ result: 'FAILED', configFailure: true });
    await call('a@example.com');
    mail.fn.mockClear();
    state.exists = true;
    const res = await call('registered@example.com');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe('MAIL_001');
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it('設定類旗標 10 分鐘後過期', async () => {
    vi.useFakeTimers();
    try {
      mail.fn.mockResolvedValue({ result: 'FAILED', configFailure: true });
      await call('a@example.com');
      state.exists = true;
      expect((await call('r@example.com')).status).toBe(503);
      vi.advanceTimersByTime(10 * 60_000 + 1000);
      expect((await call('r@example.com')).status).toBe(200);
    } finally { vi.useRealTimers(); }
  });

  it('正常狀態下，已存在 email → 200 sent:true 且不寄信', async () => {
    state.exists = true;
    const res = await call('registered@example.com');
    expect(res.status).toBe(200);
    expect((await res.json()).data.sent).toBe(true);
    expect(mail.fn).not.toHaveBeenCalled();
  });

  it('forgot-password：寄信失敗同樣回 503（不吞）；正常仍回 sent:true', async () => {
    state.exists = true; // RESET_PASSWORD 在 email 存在時才寄
    mail.fn.mockResolvedValue({ result: 'FAILED', configFailure: false });
    const f = () => FORGOT(new Request('http://localhost/api/auth/forgot-password', {
      method: 'POST', body: JSON.stringify({ email: 'a@example.com' }),
    }), {});
    expect((await f()).status).toBe(503);
    mail.fn.mockResolvedValue({ result: 'SENT', configFailure: false });
    expect((await f()).status).toBe(200);
  });
});
