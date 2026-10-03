/**
 * #758 — 寄信失敗 parity 視窗：暫時性失敗也要讓「不寄信路徑」回同一個 503；SENT 清除視窗。
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

const reg = (email: string) =>
  POST(new Request('http://localhost/api/auth/send-verification-code', {
    method: 'POST', body: JSON.stringify({ email, purpose: 'REGISTER' }),
  }), {});
const forgot = (email: string) =>
  FORGOT(new Request('http://localhost/api/auth/forgot-password', {
    method: 'POST', body: JSON.stringify({ email }),
  }), {});

const TRANSIENT = { result: 'FAILED', configFailure: false };
const CONFIG = { result: 'FAILED', configFailure: true };
const SENT = { result: 'SENT', configFailure: false };

beforeEach(() => {
  vi.useFakeTimers();
  state.rows = []; state.exists = false; mail.fn.mockReset(); __resetMailConfigFailureFlag();
  vi.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('寄信失敗 parity 視窗 (#758)', () => {
  it('暫時性失敗後 60 秒內，已存在 email 的 REGISTER 也回 503；視窗後回 200', async () => {
    mail.fn.mockResolvedValue(TRANSIENT);
    expect((await reg('new@example.com')).status).toBe(503);
    mail.fn.mockClear();
    state.exists = true;
    vi.advanceTimersByTime(59_000);
    const res = await reg('old@example.com');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe('MAIL_001');
    expect(JSON.stringify(body)).not.toMatch(/resend|5\d\d|429|network|API key/i);
    expect(mail.fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(2_000);
    expect((await reg('old@example.com')).status).toBe(200);
  });

  it('暫時性失敗不縮短仍有效的 10 分鐘設定類視窗', async () => {
    mail.fn.mockResolvedValue(CONFIG);
    await reg('new@example.com');
    vi.advanceTimersByTime(5 * 60_000);
    mail.fn.mockResolvedValue(TRANSIENT);
    expect((await reg('new2@example.com')).status).toBe(503); // 以暫時性失敗再延伸嘗試縮短
    state.exists = true;
    vi.advanceTimersByTime(2 * 60_000); // 距設定類失敗 7 分鐘；暫時性 60s 視窗早已過
    expect((await reg('old@example.com')).status).toBe(503);
    vi.advanceTimersByTime(3 * 60_000 + 1_000); // 超過 10 分鐘
    expect((await reg('old@example.com')).status).toBe(200);
  });

  it('SENT 清除視窗（M6）：恢復後已存在 email 立刻回 200', async () => {
    mail.fn.mockResolvedValue(CONFIG);
    await reg('new@example.com');
    state.exists = true;
    expect((await reg('old@example.com')).status).toBe(503);
    state.exists = false;
    mail.fn.mockResolvedValue(SENT);
    expect((await reg('new2@example.com')).status).toBe(200);
    state.exists = true;
    state.rows = []; // 清掉 SENT 留下的碼，避免 60 秒重寄節流（429）干擾
    expect((await reg('old@example.com')).status).toBe(200);
  });

  it('forgot-password 鏡像：暫時性失敗後，不存在的 email 在視窗內也回 503，視窗後回 200', async () => {
    state.exists = true;
    mail.fn.mockResolvedValue(TRANSIENT);
    expect((await forgot('real@example.com')).status).toBe(503);
    mail.fn.mockClear();
    state.exists = false; // 不存在 → 原本不寄信
    const res = await forgot('ghost@example.com');
    const body = await res.json();
    expect(res.status).toBe(503);
    expect(body.code).toBe('MAIL_001');
    expect(mail.fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(61_000);
    expect((await forgot('ghost@example.com')).status).toBe(200);
  });
});
