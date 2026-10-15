/**
 * #1030 — 驗證碼暴力猜測防護（不需 schema 的部分）：
 * 1) 寄新碼成功後作廢同 email／purpose 的舊碼；寄送失敗不作廢。
 * 2) 重設密碼驗證失敗節流（email+purpose、IP；單 process 記憶體、盡力而為）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Row = { id: string; email: string; purpose: string; code: string; consumed_at: string | null; created_at: string };
const st = vi.hoisted(() => ({
  rows: [] as any[], exists: false, validCodes: new Set<string>(), uidFound: true,
}));
const mail = vi.hoisted(() => ({ fn: vi.fn() }));
const updateUserById = vi.hoisted(() => vi.fn());

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({
    rpc: async (name: string) => (name === 'email_exists'
      ? { data: st.exists } : { data: st.uidFound ? 'user-1' : null, error: null }),
    auth: { admin: { updateUserById } },
    from: () => ({
      select: () => {
        // 驗證碼查詢：email+code 以 eq 收集；dispatch 的冷卻查詢（select created_at）回 null
        const f: Record<string, string> = {};
        const q: any = {};
        q.eq = (k: string, v: string) => { f[k] = v; return q; };
        q.is = () => q; q.gt = () => q; q.order = () => q; q.limit = () => q;
        q.maybeSingle = async () => {
          if ('code' in f) return { data: st.validCodes.has(`${f.email}|${f.code}`) ? { id: 'code-1' } : null };
          return { data: null };
        };
        return q;
      },
      insert: async (r: any) => {
        st.rows.push({ id: `r${st.rows.length}`, consumed_at: null, created_at: new Date().toISOString(), ...r });
        return { error: null };
      },
      delete: () => {
        const q: any = { eq: () => q, then: (res: any) => Promise.resolve({ error: null }).then(res) };
        return q;
      },
      update: (payload: any) => {
        const f: Record<string, string> = {}; const neq: Record<string, string> = {}; let onlyUnconsumed = false;
        const q: any = {
          eq: (k: string, v: string) => { f[k] = v; return q; },
          neq: (k: string, v: string) => { neq[k] = v; return q; },
          is: () => { onlyUnconsumed = true; return q; },
          select: async () => ({ data: [{ id: 'code-1' }], error: null }),
          then: (res: any) => {
            for (const r of st.rows as Row[]) {
              const match = Object.entries(f).every(([k, v]) => (r as any)[k] === v)
                && Object.entries(neq).every(([k, v]) => (r as any)[k] !== v)
                && (!onlyUnconsumed || r.consumed_at === null);
              if (match) Object.assign(r, payload);
            }
            return Promise.resolve({ error: null }).then(res);
          },
        };
        return q;
      },
    }),
  }),
}));
vi.mock('@/server/email/send', () => ({ sendVerificationCodeEmail: mail.fn }));
vi.mock('next/headers', () => ({ cookies: () => Promise.resolve({ get: () => undefined }) }));

import { POST } from '@/app/api/auth/reset-password/route';
import { dispatchVerificationCode, __resetMailConfigFailureFlag } from '@/server/send-code';

// rate-limit 無重置 API：每個測試用不重複的 email／IP，避免互相污染。
let seq = 0;
let ip = '';
let email = '';
beforeEach(() => {
  seq += 1;
  ip = `10.0.${Math.floor(seq / 250)}.${seq % 250}`;
  email = `user${seq}@example.com`;
  st.rows = []; st.exists = false; st.validCodes = new Set(); st.uidFound = true;
  mail.fn.mockReset(); __resetMailConfigFailureFlag();
  updateUserById.mockReset(); updateUserById.mockResolvedValue({ data: {}, error: null });
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

const reset = (code: string, opts: { email?: string; ip?: string } = {}) =>
  POST(new Request('http://localhost/api/auth/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': opts.ip ?? ip },
    body: JSON.stringify({ email: opts.email ?? email, code, newPassword: 'new-password-1' }),
  }), {});

describe('寄新碼作廢舊碼 (#1030)', () => {
  const old = (code: string) => ({
    id: `old-${code}`, email, purpose: 'RESET_PASSWORD', code, consumed_at: null,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  });

  it('SENT 後：舊的未消耗碼被標記 consumed，新碼保持有效', async () => {
    st.exists = true;
    st.rows = [old('111111'), { ...old('222222'), email: 'other@example.com' }];
    mail.fn.mockResolvedValue({ result: 'SENT', failureKind: null });
    await dispatchVerificationCode(email, 'RESET_PASSWORD');
    const mine = st.rows.filter((r: Row) => r.email === email);
    const fresh = mine.find((r: Row) => r.code !== '111111')!;
    expect(mine.find((r: Row) => r.code === '111111')!.consumed_at).not.toBeNull();
    expect(fresh.consumed_at).toBeNull();
    // 別的 email 不受影響
    expect(st.rows.find((r: Row) => r.email === 'other@example.com')!.consumed_at).toBeNull();
  });

  it('寄送失敗：舊碼不作廢', async () => {
    st.exists = true;
    st.rows = [old('111111')];
    mail.fn.mockResolvedValue({ result: 'FAILED', failureKind: 'recipient' });
    await dispatchVerificationCode(email, 'RESET_PASSWORD');
    expect(st.rows.find((r: Row) => r.code === '111111')!.consumed_at).toBeNull();
  });

  it('作廢步驟拋例外：只記 log，不影響回應', async () => {
    st.exists = true;
    mail.fn.mockResolvedValue({ result: 'SENT', failureKind: null });
    st.rows = [old('111111')];
    Object.defineProperty(st.rows[0], 'consumed_at', { get() { throw new Error('boom'); }, set() {}, configurable: true });
    await expect(dispatchVerificationCode(email, 'RESET_PASSWORD')).resolves.toBeUndefined();
  });
});

describe('reset-password 驗證失敗節流 (#1030)', () => {
  const MSG = '驗證碼嘗試次數過多，請稍後再試或重新申請驗證碼';

  it('連續 5 次錯碼後第 6 次回 429 REQ_004，即使碼正確也先被擋', async () => {
    st.validCodes.add(`${email}|654321`);
    for (let i = 0; i < 5; i += 1) {
      const r = await reset('000000');
      expect(r.status).toBe(400);
      expect((await r.json()).code).toBe('AUTH_004');
    }
    const blocked = await reset('654321');
    expect(blocked.status).toBe(429);
    const body = await blocked.json();
    expect(body.code).toBe('REQ_004');
    expect(body.message).toBe(MSG);
    expect(updateUserById).not.toHaveBeenCalled();
  });

  it('額度內正確碼仍成功', async () => {
    st.validCodes.add(`${email}|654321`);
    for (let i = 0; i < 4; i += 1) await reset('000000');
    const ok = await reset('654321');
    expect(ok.status).toBe(200);
    expect(updateUserById).toHaveBeenCalledTimes(1);
  });

  it('不同 email 不互相影響（換 IP 避免 IP 額度干擾）', async () => {
    for (let i = 0; i < 5; i += 1) await reset('000000');
    expect((await reset('000000')).status).toBe(429);
    const other = `other${seq}@example.com`;
    st.validCodes.add(`${other}|654321`);
    const r = await reset('654321', { email: other, ip: `${ip}-b` });
    expect(r.status).toBe(200);
  });

  it('email 大小寫變體共用同一額度', async () => {
    for (let i = 0; i < 5; i += 1) await reset('000000');
    const r = await reset('000000', { email: email.toUpperCase(), ip: `${ip}-c` });
    expect(r.status).toBe(429);
  });

  it('IP 額度：同一 IP 對 30 個不同 email 各失敗一次後，第 31 次被擋', async () => {
    for (let i = 0; i < 30; i += 1) {
      const r = await reset('000000', { email: `ipt${seq}-${i}@example.com` });
      expect(r.status).toBe(400);
    }
    const r = await reset('000000', { email: `ipt${seq}-fresh@example.com` });
    expect(r.status).toBe(429);
    // 換 IP 則不受影響
    const r2 = await reset('000000', { email: `ipt${seq}-fresh@example.com`, ip: `${ip}-d` });
    expect(r2.status).toBe(400);
  });

  it('存在與不存在的 email：失敗回應與節流行為完全一致', async () => {
    const real = `real${seq}@example.com`; const ghost = `ghost${seq}@example.com`;
    st.validCodes.add(`${real}|654321`); // real 有碼，ghost 無；皆用錯碼
    const run = async (em: string, ipAddr: string) => {
      const out: Array<[number, string, string]> = [];
      for (let i = 0; i < 6; i += 1) {
        const r = await reset('000000', { email: em, ip: ipAddr });
        const b = await r.json();
        out.push([r.status, b.code, b.message]);
      }
      return out;
    };
    expect(await run(real, `${ip}-r`)).toEqual(await run(ghost, `${ip}-g`));
  });

  it('系統錯誤（非 CODE_INVALID）不計入失敗額度', async () => {
    st.validCodes.add(`${email}|654321`);
    updateUserById.mockResolvedValue({ data: null, error: { code: 'unexpected', status: 500 } });
    for (let i = 0; i < 8; i += 1) expect((await reset('654321')).status).toBe(500);
  });
});
