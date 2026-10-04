/**
 * #754 — OTP 錯誤矩陣與登出後 session 失效（補 auth.03.test.ts 未覆蓋的案例）。
 * auth.03 已涵蓋：register→login→me、錯碼 AUTH_004、forgot→reset→舊密碼失敗新密碼成功、MAIL_001。
 * 本檔補：過期碼、已使用碼、purpose 不符（REGISTER 碼用於 RESET、反向）、logout 後 me 401。
 * 需 shared TEST 環境，只在授權的 integration lane 執行。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { loginAs } from '../../helpers/auth';
import { ResendMockServer } from '../../helpers/resend-mock';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const CODE_INVALID = 'AUTH_004';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> => (await res.json()) as Envelope<T>;
const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
const uniqueEmail = (p: string) => `${p}-${suffix()}@test.local`;
const uniqueShopCode = (p: string) => `${p}-${suffix()}`;
const postJson = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let admin: SupabaseClient;
const resendMock = new ResendMockServer();

async function insertCode(
  email: string,
  code: string,
  purpose: 'REGISTER' | 'RESET_PASSWORD',
  opts: { expiresInMs?: number; consumed?: boolean } = {},
): Promise<void> {
  const { error } = await admin.from('auth_verification_codes').insert({
    email,
    code,
    purpose,
    expires_at: new Date(Date.now() + (opts.expiresInMs ?? 10 * 60_000)).toISOString(),
    consumed_at: opts.consumed ? new Date().toISOString() : null,
  });
  expect(error).toBeNull();
}

async function latestCode(email: string, purpose: 'REGISTER' | 'RESET_PASSWORD'): Promise<string> {
  const { data, error } = await admin
    .from('auth_verification_codes').select('code').eq('email', email).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return (data as { code: string }).code;
}

async function registerAccount(email: string, password: string): Promise<void> {
  expect((await postJson('/api/auth/send-verification-code', { email, purpose: 'REGISTER' })).status).toBe(200);
  const code = await latestCode(email, 'REGISTER');
  const res = await postJson('/api/auth/tenant/register', {
    email, code, password, tenantName: 'OTP 矩陣測試店', shopCode: uniqueShopCode('otp'),
  });
  expect(res.status).toBe(200);
}

async function expectCodeInvalid(res: Response): Promise<void> {
  expect(res.status).toBe(400);
  const body = await readJson(res);
  expect(body.success).toBe(false);
  expect(body.code).toBe(CODE_INVALID);
}

beforeAll(async () => {
  if (!process.env.RESEND_BASE_URL || !process.env.RESEND_API_KEY) {
    throw new Error('缺少 RESEND_BASE_URL / RESEND_API_KEY（見 auth.03.test.ts）。');
  }
  await resendMock.start();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

afterAll(async () => {
  await resendMock.stop();
});

describe('OTP 錯誤矩陣（#754）', () => {
  it('過期碼：register 與 reset 都回 400 AUTH_004', async () => {
    const regEmail = uniqueEmail('expired-reg');
    await insertCode(regEmail, '123456', 'REGISTER', { expiresInMs: -60_000 });
    await expectCodeInvalid(await postJson('/api/auth/tenant/register', {
      email: regEmail, code: '123456', password: 'Passw0rd!exp1', tenantName: '過期店', shopCode: uniqueShopCode('exp'),
    }));

    // reset 用「已註冊帳號」，使 400 只可能來自過期檢查（而非帳號不存在）
    const resetEmail = uniqueEmail('expired-reset');
    await registerAccount(resetEmail, 'Passw0rd!exp0');
    await insertCode(resetEmail, '654321', 'RESET_PASSWORD', { expiresInMs: -60_000 });
    await expectCodeInvalid(await postJson('/api/auth/reset-password', {
      email: resetEmail, code: '654321', newPassword: 'Passw0rd!exp2',
    }));
  });

  it('已使用碼：register 碼不可重複使用；reset 碼用過一次後第二次 400 AUTH_004', async () => {
    const regEmail = uniqueEmail('used-reg');
    await insertCode(regEmail, '111222', 'REGISTER', { consumed: true });
    await expectCodeInvalid(await postJson('/api/auth/tenant/register', {
      email: regEmail, code: '111222', password: 'Passw0rd!used1', tenantName: '已用店', shopCode: uniqueShopCode('used'),
    }));

    const email = uniqueEmail('used-reset');
    await registerAccount(email, 'Passw0rd!used2');
    expect((await postJson('/api/auth/forgot-password', { email })).status).toBe(200);
    const code = await latestCode(email, 'RESET_PASSWORD');
    expect((await postJson('/api/auth/reset-password', { email, code, newPassword: 'Passw0rd!used3' })).status).toBe(200);
    await expectCodeInvalid(await postJson('/api/auth/reset-password', { email, code, newPassword: 'Passw0rd!used4' }));
  });

  it('purpose 不符：REGISTER 碼不能用於 reset；RESET_PASSWORD 碼不能用於 register', async () => {
    const email = uniqueEmail('purpose');
    await registerAccount(email, 'Passw0rd!purp1');
    // 此刻最新的 REGISTER 碼已被消耗；另插一筆「有效」REGISTER 碼拿去打 reset
    await insertCode(email, '246810', 'REGISTER');
    await expectCodeInvalid(await postJson('/api/auth/reset-password', {
      email, code: '246810', newPassword: 'Passw0rd!purp2',
    }));
    // 密碼未被改動
    expect((await postJson('/api/auth/login', { email, password: 'Passw0rd!purp1' })).status).toBe(200);

    const freshEmail = uniqueEmail('purpose-rev');
    await insertCode(freshEmail, '135790', 'RESET_PASSWORD');
    await expectCodeInvalid(await postJson('/api/auth/tenant/register', {
      email: freshEmail, code: '135790', password: 'Passw0rd!purp3', tenantName: '反向店', shopCode: uniqueShopCode('rev'),
    }));
  });
});

describe('登出後 session 失效（#754）', () => {
  it('register → login → me 200；POST /api/auth/logout 後 me 401', async () => {
    const email = uniqueEmail('logout');
    const password = 'Passw0rd!logout1';
    await registerAccount(email, password);

    const api = await loginAs(email, password);
    const before = await api.get('/api/auth/me');
    expect(before.status).toBe(200);
    expect((await readJson<{ email: string }>(before)).data!.email).toBe(email);

    const cookieBeforeLogout = api.cookieHeader();
    expect(cookieBeforeLogout).not.toBe('');
    const out = await api.post('/api/auth/logout');
    expect(out.status).toBe(200);
    expect((await readJson<{ loggedOut: boolean }>(out)).data!.loggedOut).toBe(true);

    const after = await api.get('/api/auth/me');
    expect(after.status).toBe(401);

    // 原樣重放登出前保存的 cookie：401 才證明 server 端 session 已失效，而非只是沒帶 cookie
    const replay = await fetch(`${BASE}/api/auth/me`, { headers: { Cookie: cookieBeforeLogout } });
    expect(replay.status).toBe(401);
  });
});
