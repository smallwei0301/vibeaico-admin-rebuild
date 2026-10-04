/**
 * #754 — OTP 錯誤矩陣與登出後 session 失效（補 auth.03.test.ts 未覆蓋的案例）。
 * auth.03 已涵蓋：register→login→me、錯碼 AUTH_004、forgot→reset→舊密碼失敗新密碼成功、MAIL_001。
 * 本檔補：過期碼、已使用碼、purpose 不符（REGISTER 碼用於 RESET、反向）、logout 後 me 401。
 * 需 shared TEST 環境，只在授權的 integration lane 執行。
 *
 * 清理責任（afterAll，只動本檔自己造的 fixture）：
 * - 範圍：uniqueEmail / uniqueShopCode 產生當下即登記進 createdEmails / createdShopCodes（早於 HTTP 呼叫，
 *   註冊中途失敗也不漏）；只以「精確相等」刪除這些值，不使用 LIKE、不做整表或 @test.local 批次刪除。
 * - 順序：auth_verification_codes(email) → tenants(shop_code，tenant_users / tenant_settings 由 FK cascade)
 *   → auth.users(email 精確比對，listUsers 分頁 + deleteUser)。
 * - 失敗路徑：每一步獨立 try/catch，任何一步失敗都不阻斷後續步驟；刪完後逐表讀回，殘留也記為失敗；
 *   最後彙總成單一 Error 拋出（不吞錯）。resendMock.stop() 以 finally 保證執行；
 *   admin 未建立（beforeAll 失敗）時略過 DB 清理但仍停止 mock。
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
// 本檔產生的 fixture 識別值：在產生當下登記，供 afterAll 精確清理。
const createdEmails: string[] = [];
const createdShopCodes: string[] = [];
const uniqueEmail = (p: string) => {
  const email = `${p}-${suffix()}@test.local`;
  createdEmails.push(email);
  return email;
};
const uniqueShopCode = (p: string) => {
  const code = `${p}-${suffix()}`;
  createdShopCodes.push(code);
  return code;
};
const postJson = (path: string, body: unknown) =>
  fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

let admin: SupabaseClient | undefined;
const resendMock = new ResendMockServer();

async function insertCode(
  email: string,
  code: string,
  purpose: 'REGISTER' | 'RESET_PASSWORD',
  opts: { expiresInMs?: number; consumed?: boolean } = {},
): Promise<void> {
  const { error } = await admin!.from('auth_verification_codes').insert({
    email,
    code,
    purpose,
    expires_at: new Date(Date.now() + (opts.expiresInMs ?? 10 * 60_000)).toISOString(),
    consumed_at: opts.consumed ? new Date().toISOString() : null,
  });
  expect(error).toBeNull();
}

async function latestCode(email: string, purpose: 'REGISTER' | 'RESET_PASSWORD'): Promise<string> {
  const { data, error } = await admin!
    .from('auth_verification_codes').select('code').eq('email', email).eq('purpose', purpose)
    .order('created_at', { ascending: false }).limit(1).maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return (data as { code: string }).code;
}

async function registerAccount(
  email: string,
  password: string,
  businessType?: 'LOCAL_SHOP' | 'GUIDE' | 'CLINIC',
): Promise<string> {
  expect((await postJson('/api/auth/send-verification-code', { email, purpose: 'REGISTER' })).status).toBe(200);
  const code = await latestCode(email, 'REGISTER');
  const shopCode = uniqueShopCode('otp');
  const res = await postJson('/api/auth/tenant/register', {
    email, code, password, tenantName: 'OTP 矩陣測試店', shopCode,
    ...(businessType ? { businessType } : {}),
  });
  expect(res.status).toBe(200);
  return shopCode;
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

/** auth.users 以精確 email 比對（小寫），分頁掃描；回傳符合本檔登記 email 的使用者 id。 */
async function findTrackedAuthUsers(client: SupabaseClient): Promise<{ id: string; email: string }[]> {
  const wanted = new Set(createdEmails.map((e) => e.toLowerCase()));
  const found: { id: string; email: string }[] = [];
  const perPage = 200;
  for (let page = 1; ; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    for (const u of data.users) {
      if (u.email && wanted.has(u.email.toLowerCase())) found.push({ id: u.id, email: u.email });
    }
    if (data.users.length < perPage) break;
  }
  return found;
}

async function cleanupOwnFixtures(client: SupabaseClient): Promise<void> {
  const failures: string[] = [];
  const step = async (label: string, action: () => PromiseLike<{ error: unknown } | void>) => {
    try {
      const res = await action();
      if (res && res.error) failures.push(`${label} 失敗：${JSON.stringify(res.error)}`);
    } catch (error) {
      failures.push(`${label} 拋錯：${String(error)}`);
    }
  };
  const emails = [...createdEmails];
  const shopCodes = [...createdShopCodes];

  if (emails.length > 0) {
    await step('auth_verification_codes delete', () =>
      client.from('auth_verification_codes').delete().in('email', emails));
  }
  if (shopCodes.length > 0) {
    // tenant_users / tenant_settings 對 tenants 為 on delete cascade（0003_tenants_and_accounts.sql）
    await step('tenants delete', () => client.from('tenants').delete().in('shop_code', shopCodes));
  }
  if (emails.length > 0) {
    await step('auth.users delete', async () => {
      for (const u of await findTrackedAuthUsers(client)) {
        const { error } = await client.auth.admin.deleteUser(u.id);
        if (error) failures.push(`auth.users deleteUser(${u.email}) 失敗：${JSON.stringify(error)}`);
      }
    });
  }

  // 讀回：確認本檔登記的 fixture 已全數消失。
  if (emails.length > 0) {
    await step('auth_verification_codes 讀回', async () => {
      const r = await client.from('auth_verification_codes').select('id').in('email', emails);
      if (r.error) return { error: r.error };
      if ((r.data ?? []).length > 0) failures.push(`auth_verification_codes 殘留 ${(r.data ?? []).length} 筆`);
    });
    await step('auth.users 讀回', async () => {
      const left = await findTrackedAuthUsers(client);
      if (left.length > 0) failures.push(`auth.users 殘留 ${left.length} 筆`);
    });
  }
  if (shopCodes.length > 0) {
    await step('tenants 讀回', async () => {
      const r = await client.from('tenants').select('id').in('shop_code', shopCodes);
      if (r.error) return { error: r.error };
      if ((r.data ?? []).length > 0) failures.push(`tenants 殘留 ${(r.data ?? []).length} 筆`);
    });
  }

  if (failures.length > 0) {
    throw new Error(`auth-otp-matrix.754 fixture 清理未完成：\n- ${failures.join('\n- ')}`);
  }
}

afterAll(async () => {
  try {
    if (admin) await cleanupOwnFixtures(admin);
  } finally {
    await resendMock.stop();
  }
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
    const shopCode = await registerAccount(email, password, 'GUIDE');
    const { data: tenantRow, error: tenantErr } = await admin!
      .from('tenants').select('business_type').eq('shop_code', shopCode).single();
    expect(tenantErr).toBeNull();
    expect(tenantRow!.business_type).toBe('GUIDE');

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
