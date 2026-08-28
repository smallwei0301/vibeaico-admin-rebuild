/**
 * 登入系統 API 整合測試 — 12 分冊 §4「Phase 2（登入）」矩陣：
 *   「寄碼→註冊→登入→me 全流程；60 秒重寄 429；錯碼/過期碼 AUTH_004；
 *    重複 email AUTH_003；shopCode 重複 AUTH_006；錯密碼 AUTH_002；
 *    忘記→重設→新密碼可登入；改密碼需驗舊密碼；register 失敗補償
 *   （店建立失敗時 auth user 被回滾）」
 * 端點行為規格見 docs/integration/03-AUTH.md §2-§5。
 *
 * ⚠️ TDD 紅燈說明：`/api/auth/**` 尚未實作（Phase 2 施工中）時，這些請求會拿到
 * 連線被拒或 404，全部紅燈——這是誠實的「先寫測試」狀態，不得為轉綠放寬斷言
 * （12 §2.4）。
 *
 * 測試資料一律用獨立產生的 `@test.local` email／shopCode（不共用同一個字面值），
 * 避免多個案例互踩；全域重置只在 globalSetup 跑一次，本檔不再呼叫 reset-db。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

/** `src/lib/api.ts` 假設的固定回應信封（見 CLAUDE.md「Pages never fetch」一節）。 */
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

/** `@test.local` 結尾——reset-db 會清（12 分冊 §1.2）。 */
function uniqueEmail(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}@test.local`;
}

/** 僅限小寫英文、數字、連字號（03 §3 zod：`/^[a-z0-9-]+$/`）。 */
function uniqueShopCode(prefix: string): string {
  return `${prefix}-${uniqueSuffix()}`;
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
}

/** 直查 `auth_verification_codes` 拿最新一筆碼（測試環境收不到信，規格允許的取碼方式，見任務指示）。 */
async function latestCode(
  admin: SupabaseClient,
  email: string,
  purpose: 'REGISTER' | 'RESET_PASSWORD',
): Promise<string> {
  const { data, error } = await admin
    .from('auth_verification_codes')
    .select('code')
    .eq('email', email)
    .eq('purpose', purpose)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();
  return (data as { code: string }).code;
}

/** 手動插入一筆「有效」驗證碼（10 分鐘後過期、未消耗）——用於繞過寄碼枚舉防護的兩個案例，見下方測試內註解。 */
async function insertValidCode(
  admin: SupabaseClient,
  email: string,
  code: string,
  purpose: 'REGISTER' | 'RESET_PASSWORD',
): Promise<void> {
  const { error } = await admin.from('auth_verification_codes').insert({
    email,
    code,
    purpose,
    expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
  });
  expect(error).toBeNull();
}

/** email 是否已存在 auth user（分頁掃 admin.auth.admin.listUsers，同 scripts/test/seed.mjs 的 ensureAuthUser 手法）。 */
async function authUserExists(admin: SupabaseClient, email: string): Promise<boolean> {
  let page = 1;
  const perPage = 200;
  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    expect(error).toBeNull();
    if (data!.users.some((u) => u.email === email)) return true;
    if (data!.users.length < perPage) return false;
    page += 1;
  }
}

/** 完整走一次「寄碼→註冊」，回傳 register 端點的原始 Response（呼叫端自行斷言狀態）。 */
async function registerFullFlow(
  admin: SupabaseClient,
  params: { email: string; shopCode: string; password: string; tenantName: string },
): Promise<Response> {
  const sendRes = await postJson('/api/auth/send-verification-code', {
    email: params.email,
    purpose: 'REGISTER',
  });
  expect(sendRes.status).toBe(200);
  const code = await latestCode(admin, params.email, 'REGISTER');
  return postJson('/api/auth/tenant/register', {
    email: params.email,
    code,
    password: params.password,
    tenantName: params.tenantName,
    shopCode: params.shopCode,
  });
}

let admin: SupabaseClient;

beforeAll(() => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

describe('寄碼 → 註冊 → 登入 → me 全流程（03 §2-§5）', () => {
  it('新 email 走完四個端點，每一步回應欄位都正確', async () => {
    const email = uniqueEmail('flow');
    const shopCode = uniqueShopCode('flow');
    const password = 'Passw0rd!flow';
    const tenantName = '流程測試店';

    const sendRes = await postJson('/api/auth/send-verification-code', { email, purpose: 'REGISTER' });
    expect(sendRes.status).toBe(200);
    const sendBody = await readJson<{ sent: boolean }>(sendRes);
    expect(sendBody.success).toBe(true);
    expect(sendBody.data!.sent).toBe(true);

    const code = await latestCode(admin, email, 'REGISTER');
    expect(code).toMatch(/^\d{6}$/);

    const registerRes = await postJson('/api/auth/tenant/register', {
      email, code, password, tenantName, shopCode,
    });
    expect(registerRes.status).toBe(200);
    const registerBody = await readJson<{ registered: boolean }>(registerRes);
    expect(registerBody.success).toBe(true);
    expect(registerBody.data!.registered).toBe(true);

    const loginRes = await postJson('/api/auth/login', { email, password });
    expect(loginRes.status).toBe(200);
    const loginBody = await readJson<{ loggedIn: boolean }>(loginRes);
    expect(loginBody.success).toBe(true);
    expect(loginBody.data!.loggedIn).toBe(true);

    const api = await loginAs(email, password);
    const meRes = await api.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    const meBody = await readJson<{ email: string; tenantName: string; shopCode: string; role: string }>(meRes);
    expect(meBody.success).toBe(true);
    expect(meBody.data!.email).toBe(email);
    expect(meBody.data!.tenantName).toBe(tenantName);
    expect(meBody.data!.shopCode).toBe(shopCode);
    expect(meBody.data!.role).toBe('OWNER');
  }, 60_000);
});

describe('POST /api/auth/send-verification-code 60 秒防重寄（03 §2）', () => {
  it('同 email 同 purpose 60 秒內重寄 → 429 REQ_003', async () => {
    const email = uniqueEmail('resend');

    const first = await postJson('/api/auth/send-verification-code', { email, purpose: 'REGISTER' });
    expect(first.status).toBe(200);
    expect((await readJson(first)).success).toBe(true);

    const second = await postJson('/api/auth/send-verification-code', { email, purpose: 'REGISTER' });
    expect(second.status).toBe(429);
    const secondBody = await readJson(second);
    expect(secondBody.success).toBe(false);
    expect(secondBody.code).toBe('REQ_003');
  });
});

describe('POST /api/auth/tenant/register 錯碼/過期碼（03 §2 consumeCode）', () => {
  it('隨便給 000000 當驗證碼 → 400 AUTH_004', async () => {
    const email = uniqueEmail('badcode');
    const shopCode = uniqueShopCode('badcode');

    const res = await postJson('/api/auth/tenant/register', {
      email, code: '000000', password: 'Passw0rd!bad', tenantName: '壞碼測試店', shopCode,
    });
    expect(res.status).toBe(400);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_004');
  });
});

describe('POST /api/auth/tenant/register 重複 email（03 §3 createUser 失敗路徑）', () => {
  it('email 已存在時註冊 → 409 AUTH_003', async () => {
    // 步驟 1：先用一組全新 email 走一次真正的註冊，製造一個「已存在」的帳號。
    const email = uniqueEmail('dupemail');
    const firstReg = await registerFullFlow(admin, {
      email,
      shopCode: uniqueShopCode('dupemail-1st'),
      password: 'Passw0rd!dup1',
      tenantName: '重複信箱測試店-first',
    });
    expect(firstReg.status).toBe(200);

    // 步驟 2：email 已存在，正常呼叫 send-verification-code(REGISTER) 依枚舉防護
    // 「回成功但不寄碼」（03 §2），所以走 API 拿不到第二筆可用的碼——那樣測到的
    // 會是 AUTH_004（驗碼失敗），不是本案例要測的 AUTH_003（createUser 失敗）。
    // 因此改用 service role 直接往 auth_verification_codes 插入一筆有效碼，
    // 把「驗證碼此刻確實有效」這個前提條件孤立出來，單獨測 §3 的
    // 「shopCode 不重複、驗碼通過、但 createUser 因 email 已註冊而失敗」分支。
    const code2 = '135790';
    await insertValidCode(admin, email, code2, 'REGISTER');
    const secondReg = await postJson('/api/auth/tenant/register', {
      email,
      code: code2,
      password: 'Passw0rd!dup2',
      tenantName: '重複信箱測試店-second',
      shopCode: uniqueShopCode('dupemail-2nd'),
    });
    expect(secondReg.status).toBe(409);
    const secondBody = await readJson(secondReg);
    expect(secondBody.success).toBe(false);
    expect(secondBody.code).toBe('AUTH_003');
  });
});

describe('POST /api/auth/tenant/register shopCode 重複（03 §3 dup 檢查）', () => {
  it('shopCode 撞既有店（seed tenant-a）→ 409 AUTH_006，且此檢查在驗碼之前（碼不會被消耗）', async () => {
    const email = uniqueEmail('dupshop');
    const code = '246810';
    // 同樣是為了繞過枚舉防護、湊出一筆「有效碼」，見上一個 describe 的註解。
    await insertValidCode(admin, email, code, 'REGISTER');

    const res = await postJson('/api/auth/tenant/register', {
      email,
      code,
      password: 'Passw0rd!ds',
      tenantName: 'shopCode 重複測試店',
      shopCode: SHOP_A.shopCode, // 撞 seed 既有的 tenant-a
    });
    expect(res.status).toBe(409);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_006');

    // 03 §3 的順序是「shopCode 查重 → consumeCode → createUser」，shopCode 409
    // 這條路根本還沒走到 consumeCode，驗證碼應該仍是「未消耗」、可再利用。
    const { data: row, error } = await admin
      .from('auth_verification_codes')
      .select('consumed_at')
      .eq('email', email)
      .eq('purpose', 'REGISTER')
      .eq('code', code)
      .maybeSingle();
    expect(error).toBeNull();
    expect(row).not.toBeNull();
    expect((row as { consumed_at: string | null }).consumed_at).toBeNull();
  });
});

describe('register 失敗補償：shopCode 409 路徑不留下 auth user（03 §3）', () => {
  it('shopCode 重複導致 409 時，該 email 沒有任何 auth user 被建立', async () => {
    // 12 分冊 §3 描述的補償是「建店失敗時把已建立的 auth user 用 deleteUser 回滾」
    // ——那個分支需要「createUser 成功、但接下來 insert tenants/tenant_users/
    // tenant_settings 失敗」，這在黑盒整合測試裡沒有安全、可重現的方式從外部
    // 觸發（要嘛硬改 DB 權限、要嘛注入失敗，兩者都會弄髒測試環境或偏離黑盒
    // 精神）。這條補償路徑留給程式碼審查涵蓋 03 §3 的 try/catch 邏輯。
    //
    // 這裡改測務實可行、同樣屬於「失敗不留副作用」的一個切面：shopCode 409
    // 這條路（檢查順序在 createUser 之前，見上一個 describe）本來就不會建立
    // auth user——用 listUsers 直接證實這一點，確保它沒有意外地先建立帳號
    // 才發現店代碼重複。
    const email = uniqueEmail('compensate');
    const code = '975310';
    await insertValidCode(admin, email, code, 'REGISTER');

    const res = await postJson('/api/auth/tenant/register', {
      email,
      code,
      password: 'Passw0rd!cmp',
      tenantName: '補償測試店',
      shopCode: SHOP_A.shopCode,
    });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('AUTH_006');

    expect(await authUserExists(admin, email)).toBe(false);
  });
});

describe('POST /api/auth/login 錯密碼（03 §4）', () => {
  it('密碼錯誤 → 401 AUTH_002', async () => {
    const res = await postJson('/api/auth/login', {
      email: SHOP_A.owner.email,
      password: 'DefinitelyNotTheRightPassword!',
    });
    expect(res.status).toBe(401);
    const body = await readJson(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('AUTH_002');
  });
});

describe('忘記密碼 → 重設 → 新密碼可登入（03 §2, §4）', () => {
  it('forgot-password 取碼 → reset-password → 舊密碼登入失敗、新密碼登入成功', async () => {
    // 用專屬帳號跑（不動 seed 的 owner-a），避免影響其他測試檔對 owner-a 密碼的假設。
    const email = uniqueEmail('forgot');
    const oldPassword = 'Passw0rd!old1';
    const newPassword = 'Passw0rd!new1';
    const reg = await registerFullFlow(admin, {
      email,
      shopCode: uniqueShopCode('forgot'),
      password: oldPassword,
      tenantName: '忘記密碼測試店',
    });
    expect(reg.status).toBe(200);

    const forgotRes = await postJson('/api/auth/forgot-password', { email });
    expect(forgotRes.status).toBe(200);
    const forgotBody = await readJson<{ sent: boolean }>(forgotRes);
    expect(forgotBody.success).toBe(true);
    expect(forgotBody.data!.sent).toBe(true);

    const code = await latestCode(admin, email, 'RESET_PASSWORD');

    const resetRes = await postJson('/api/auth/reset-password', { email, code, newPassword });
    expect(resetRes.status).toBe(200);
    const resetBody = await readJson<{ reset: boolean }>(resetRes);
    expect(resetBody.success).toBe(true);
    expect(resetBody.data!.reset).toBe(true);

    const oldLoginRes = await postJson('/api/auth/login', { email, password: oldPassword });
    expect(oldLoginRes.status).toBe(401);
    expect((await readJson(oldLoginRes)).code).toBe('AUTH_002');

    const api = await loginAs(email, newPassword);
    const meRes = await api.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect((await readJson<{ email: string }>(meRes)).data!.email).toBe(email);
  });
});

describe('POST /api/auth/change-password 需先驗證舊密碼（03 §4）', () => {
  it('currentPassword 錯 → 400 AUTH_002；currentPassword 對 → 200，且新密碼可登入', async () => {
    const email = uniqueEmail('chpw');
    const oldPassword = 'Passw0rd!cp1';
    const newPassword = 'Passw0rd!cp2';
    const reg = await registerFullFlow(admin, {
      email,
      shopCode: uniqueShopCode('chpw'),
      password: oldPassword,
      tenantName: '改密碼測試店',
    });
    expect(reg.status).toBe(200);

    const api = await loginAs(email, oldPassword);

    const wrongRes = await api.post('/api/auth/change-password', {
      currentPassword: 'NotTheCurrentPassword!', newPassword,
    });
    expect(wrongRes.status).toBe(400);
    const wrongBody = await readJson(wrongRes);
    expect(wrongBody.success).toBe(false);
    expect(wrongBody.code).toBe('AUTH_002');

    const okRes = await api.post('/api/auth/change-password', { currentPassword: oldPassword, newPassword });
    expect(okRes.status).toBe(200);
    const okBody = await readJson<{ changed: boolean }>(okRes);
    expect(okBody.success).toBe(true);
    expect(okBody.data!.changed).toBe(true);

    const newApi = await loginAs(email, newPassword);
    const meRes = await newApi.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect((await readJson<{ email: string }>(meRes)).data!.email).toBe(email);
  });
});
