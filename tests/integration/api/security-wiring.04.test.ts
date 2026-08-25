/**
 * 帳號安全三件接線的後端證據 — GitHub issue #4（修復-2）驗收 1 與 3。
 *
 * 14 分冊 §1（A-1）點出三個「安全語意」的操作在畫面顯示成功、後端從未被呼叫：
 * 變更密碼、登出、LINE 解除連接。頁面接線本身由靜態鏈路對照（12 §6 DoD 10）與
 * e2e（tests/e2e/auth.spec.ts）證明；本檔負責證明**被接上的那個端點真的產生了
 * 使用者以為發生的副作用**——也就是原本假成功時「沒有發生」的那些事：
 *
 *   ① 改完密碼後，舊密碼**真的**登不進去（401 AUTH_002），新密碼可以（200）。
 *      —— 舊實作是 480ms setTimeout，舊密碼永遠有效，這條必紅。
 *   ② 登出後，原本那份 session cookie **真的**失效（/api/auth/me 401）。
 *      —— 舊實作只是 <Link> 換頁，cookie 還在，這條必紅。
 *   ③ 解除連接後，兩個 `*_enc` 欄位為空、line jsonb 沒有 channelId，
 *      且 /api/settings/line/verify 五項全部回「尚未設定」。
 *      —— 舊實作送 channelSecret:''，依鐵則 6 語意是「維持原值」，token 沒被清掉，
 *         verify 仍會拿著舊 token 去打 LINE，這條必紅。
 *
 * 規格：03-AUTH.md §1/§4（logout、change-password）、06-LINE-INTEGRATION.md §6
 * （disconnect 清兩個 `*_enc` ＋ line jsonb 的 channelId）、§7（verify 五項）。
 *
 * 清理紀律（比照 settings.a1.test.ts）：③ 會把加密後的 token 寫進 SHOP_A 的
 * `*_enc` 欄位，afterAll 一律把 line jsonb 與兩個 `*_enc` 還原成種子的初始狀態，
 * 否則 reports.a5.test.ts 的 linePlatformStatus=NOT_CONFIGURED 前提會被污染。
 * ① 用當場註冊的 `@test.local` 帳號，不動任何種子帳號的密碼。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs } from '../../helpers/auth';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const JSON_HEADERS = { 'Content-Type': 'application/json' } as const;

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, { method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(body) });
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;

beforeAll(() => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
});

/** 走完「寄碼 → 取碼 → 註冊」拿一個全新的店家帳號（03 §2-§3）。 */
async function registerFreshOwner(params: {
  email: string; shopCode: string; password: string; tenantName: string;
}): Promise<void> {
  const sendRes = await postJson('/api/auth/send-verification-code', {
    email: params.email, purpose: 'REGISTER',
  });
  expect(sendRes.status).toBe(200);

  const { data, error } = await admin
    .from('auth_verification_codes')
    .select('code')
    .eq('email', params.email)
    .eq('purpose', 'REGISTER')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  expect(error).toBeNull();
  expect(data).not.toBeNull();

  const regRes = await postJson('/api/auth/tenant/register', {
    email: params.email,
    code: (data as { code: string }).code,
    password: params.password,
    tenantName: params.tenantName,
    shopCode: params.shopCode,
  });
  expect(regRes.status).toBe(200);
}

describe('① 變更密碼接線（issue #4 驗收 1；03 §4）', () => {
  it('改密碼成功後：舊密碼登入回 401 AUTH_002、新密碼登入回 200', async () => {
    const email = `chpw-wired-${uniqueSuffix()}@test.local`;
    const oldPassword = 'Passw0rd!old1';
    const newPassword = 'Passw0rd!new2';

    await registerFreshOwner({
      email,
      shopCode: `chpw-wired-${uniqueSuffix()}`,
      password: oldPassword,
      tenantName: '接線驗證店',
    });

    // 舊密碼此刻是有效的——先確立這個前提，否則後面的 401 可能只是帳號壞了
    const beforeLogin = await postJson('/api/auth/login', { email, password: oldPassword });
    expect(beforeLogin.status).toBe(200);

    const api = await loginAs(email, oldPassword);
    const changeRes = await api.post('/api/auth/change-password', {
      currentPassword: oldPassword, newPassword,
    });
    expect(changeRes.status).toBe(200);
    expect((await readJson<{ changed: boolean }>(changeRes)).data!.changed).toBe(true);

    // 核心斷言：舊密碼真的失效了（設定頁的假成功正是敗在這一條）
    const oldLogin = await postJson('/api/auth/login', { email, password: oldPassword });
    expect(oldLogin.status).toBe(401);
    const oldBody = await readJson(oldLogin);
    expect(oldBody.success).toBe(false);
    expect(oldBody.code).toBe('AUTH_002');

    const newLogin = await postJson('/api/auth/login', { email, password: newPassword });
    expect(newLogin.status).toBe(200);

    const newApi = await loginAs(email, newPassword);
    const meRes = await newApi.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect((await readJson<{ email: string }>(meRes)).data!.email).toBe(email);
  });
});

describe('② 登出接線（issue #4 驗收 2 的後端面；03 §1/§4）', () => {
  it('POST /api/auth/logout 之後，原 session 打 /api/auth/me 回 401', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

    const before = await api.get('/api/auth/me');
    expect(before.status).toBe(200);

    const logoutRes = await api.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);
    expect((await readJson<{ loggedOut: boolean }>(logoutRes)).data!.loggedOut).toBe(true);

    // Topbar 舊實作只換頁不打這支端點，session 依舊有效——這條就是那個差別
    const after = await api.get('/api/auth/me');
    expect(after.status).toBe(401);
  });
});

describe('③ LINE 解除連接接線（issue #4 驗收 3；06 §6、§7）', () => {
  const CHANNEL_ID = '2005459361';
  const CHANNEL_SECRET = 'disconnect-test-secret-0123456789';
  const ACCESS_TOKEN = 'disconnect-test-access-token-0123456789abcdef';

  afterAll(async () => {
    // 還原種子初始狀態：兩個 *_enc 空、line jsonb 清回空物件
    const { error } = await admin
      .from('tenant_settings')
      .update({ line: {}, line_channel_secret_enc: '', line_channel_access_token_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
  });

  it('disconnect 後：兩個 *_enc 為空、line jsonb 無 channelId，且 verify 五項全回「尚未設定」', async () => {
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

    // 先真的綁上去（PUT /api/settings/line 會把明文加密寫進 *_enc）
    const put = await api.put('/api/settings/line', {
      channelId: CHANNEL_ID, channelSecret: CHANNEL_SECRET, channelAccessToken: ACCESS_TOKEN,
    });
    expect(put.status).toBe(200);

    const seeded = await readRow();
    expect(seeded.secretEnc).not.toBe('');
    expect(seeded.tokenEnc).not.toBe('');
    expect(seeded.line.channelId).toBe(CHANNEL_ID);

    const res = await api.post('/api/settings/line/disconnect');
    expect(res.status).toBe(200);
    expect((await readJson(res)).success).toBe(true);

    // service role 直查（不經 API，看的是資料庫裡真正的樣子）
    const after = await readRow();
    expect(after.secretEnc).toBe('');
    expect(after.tokenEnc).toBe('');
    expect(after.line.channelId).toBeFalsy();
    expect(after.line.channelSecret).toBeUndefined();
    expect(after.line.channelAccessToken).toBeUndefined();

    // verify 五項：沒有 token 時全部回「尚未設定 LINE Channel Token」（06 §7）
    const verifyRes = await api.post('/api/settings/line/verify');
    expect(verifyRes.status).toBe(200);
    const checks = (await readJson<{ checks: { key: string; pass: boolean; message: string }[] }>(verifyRes))
      .data!.checks;
    expect(checks.map((c) => c.key)).toEqual(['TOKEN', 'WEBHOOK', 'AUTO_REPLY', 'RICH_MENU', 'QUOTA']);
    for (const c of checks) {
      expect(c.pass).toBe(false);
      expect(c.message).toContain('尚未設定');
    }
  });

  /** 直查 tenant_settings（04 §A-1：兩個密文只在 `*_enc` 欄位，line jsonb 不存）。 */
  async function readRow(): Promise<{
    secretEnc: string; tokenEnc: string; line: Record<string, unknown>;
  }> {
    const { data, error } = await admin
      .from('tenant_settings')
      .select('line, line_channel_secret_enc, line_channel_access_token_enc')
      .eq('tenant_id', SHOP_A.id)
      .maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    const row = data as {
      line: Record<string, unknown> | null;
      line_channel_secret_enc: string | null;
      line_channel_access_token_enc: string | null;
    };
    return {
      secretEnc: row.line_channel_secret_enc ?? '',
      tokenEnc: row.line_channel_access_token_enc ?? '',
      line: row.line ?? {},
    };
  }
});
