/**
 * POST /api/settings/line/verify — 六項可查證檢查 + 一項人工確認提示（Issue #477 P0
 * 首次修正 AUTO_REPLY 假故障；本檔隨後續改版更新為新版報告結構）。
 *
 * 背景：舊版 AUTO_REPLY 檢查恆回 `pass:false`（假 FAIL），且沒有任何測試守著
 * 這個行為（#477 本文 Evidence：本檔在修復前不存在，GitHub 查 404）。LINE 官方
 * 沒有公開 API 能直接讀取「自動回應訊息」這顆開關本身——GET /v2/bot/info 的
 * chatMode 欄位只代表 LINE OA Manager 的「Chat」開／關，不是自動回應開關，
 * 不能拿 chatMode 的值去推論 AUTO_REPLY 的 PASS/FAIL。
 *
 * 新版報告結構（src/app/api/settings/line/verify/route.ts 檔頭）：
 *   六項可查證檢查（status 只會是 PASS/FAIL）：
 *     CREDENTIALS、TOKEN、ID_SECRET_PAIR、BOT_MODE、WEBHOOK、WEBHOOK_TEST
 *   一項獨立的人工確認提示（AUTO_REPLY，status 恆為 INFO，不計入通過／失敗）：
 *     LINE 無公開 API 可查該開關本身，一律導引店家自行到 LINE Official Account
 *     Manager 確認——不論 chatMode 為何、缺欄位、甚至 /v2/bot/info 呼叫失敗。
 *
 * 前端 src/app/tenant/line-settings/page.tsx 的 failCount 計算規則只計入
 * status==='FAIL' 的六項可查證檢查；AUTO_REPLY 的 INFO 完全排除在外——這裡在
 * API 回傳層面驗證 status 欄位本身正確，讓前端規則有正確資料可用。
 *
 * 鏈路與既有 line-webhook.06.test.ts 相同：next dev（BASE_URL）打
 * src/server/line.ts 的 lineGetRaw/linePostRaw/lineOAuthClientCredentialsRaw，
 * 其 base 由 LINE_API_BASE 指向本檔用 tests/helpers/line-mock.ts 起的本地假
 * LINE server（固定 port），用 LineMockServer 的 setBotInfo() / setWebhookEndpoint()
 * / setOAuthToken() / setWebhookTest() 覆寫對應端點的回應內容、failNext() 模擬
 * 呼叫失敗。
 *
 * 前置資料：beforeAll 以 service role + encryptSecret() 把測試用 LINE
 * Channel ID / Secret / Access Token 寫進 SHOP_A 的 tenant_settings（seed 預設是
 * 空字串，無 token 時全部檢查一律 FAIL，不會走到本檔要驗證的邏輯）；afterAll
 * 還原快照，不影響其他測試檔對 SHOP_A LINE 憑證「尚未設定」的假設
 * （settings.a1.test.ts 檔頭清理紀律段落）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';
import { LineMockServer } from '../../helpers/line-mock';

type CheckStatus = 'PASS' | 'FAIL' | 'INFO';
type Check = { key: string; status: CheckStatus; pass: boolean; message: string };
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function findCheck(checks: Check[], key: string): Check {
  const c = checks.find((x) => x.key === key);
  expect(c, `checks 陣列缺少 ${key}`).toBeDefined();
  return c!;
}

const VERIFIABLE_KEYS = ['CREDENTIALS', 'TOKEN', 'ID_SECRET_PAIR', 'BOT_MODE', 'WEBHOOK', 'WEBHOOK_TEST'];

const CHANNEL_ID = '2005459361';
const CHANNEL_SECRET = 'itest-line-channel-secret-verify06-32ch';
const CHANNEL_TOKEN = 'itest-line-access-token-verify06';

let admin: SupabaseClient;
const mock = new LineMockServer();

/** tenant_settings 快照（afterAll 還原用） */
let lineSnapshot: Record<string, unknown> | null = null;
let secretEncSnapshot: string | null = null;
let tokenEncSnapshot: string | null = null;

/** 讓 WEBHOOK 項目在正常設定下真的 PASS 用的預期 endpoint（依 next dev 自己算出的值對齊） */
async function expectedWebhookUrl(): Promise<string> {
  const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  const res = await api.get('/api/settings');
  const body = await readJson<{ line: { webhookUrl: string } }>(res);
  return body.data!.line.webhookUrl;
}

/** 讓六項可查證檢查全部真的 PASS 的 mock 設定（供多個案例共用） */
async function mockAllPassing(): Promise<void> {
  mock.setBotInfo({ chatMode: 'bot' });
  const url = await expectedWebhookUrl();
  mock.setWebhookEndpoint({ endpoint: url, active: true });
  mock.setWebhookTest({ success: true, statusCode: 200 });
  mock.setOAuthToken({ access_token: 'mock-stateless-token', expires_in: 1800 });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();

  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要主導者在 .env.test（或 global-setup 的 spawn env）加 ' +
        'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts 打到 ' +
        'tests/helpers/line-mock.ts 起的本地假 LINE server。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await mock.start();

  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  lineSnapshot = (snap as { line: Record<string, unknown> } | null)?.line ?? {};
  secretEncSnapshot =
    (snap as { line_channel_secret_enc: string } | null)?.line_channel_secret_enc ?? '';
  tokenEncSnapshot =
    (snap as { line_channel_access_token_enc: string } | null)?.line_channel_access_token_enc ?? '';

  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line: { ...lineSnapshot, channelId: CHANNEL_ID },
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 預熱 GET /api/settings：next dev 對一支從沒被打過的 route 第一次編譯偶爾會
  // 在編譯完成前就回應、造成偶發 500（跟本檔要測的邏輯無關的 next dev 冷啟動雜訊，
  // 實測會間歇重現）。這裡在 beforeAll 先打一次觸發編譯並吃掉結果，讓後面
  // 「摘要失敗數」案例真正呼叫時 route 已經編譯好，不會被這個雜訊污染斷言。
  try {
    const warmupApi = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    await warmupApi.get('/api/settings');
  } catch {
    // 預熱失敗不影響任何斷言，忽略即可
  }
});

afterAll(async () => {
  await mock.stop();
  const { error } = await admin
    .from('tenant_settings')
    .update({
      line: lineSnapshot ?? {},
      line_channel_secret_enc: secretEncSnapshot ?? '',
      line_channel_access_token_enc: tokenEncSnapshot ?? '',
    })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
});

describe('POST /api/settings/line/verify — 六項可查證檢查 + AUTO_REPLY 人工提示（Issue #477）', () => {
  it('AUTO_REPLY 恆為 INFO（不是 PASS 也不是舊版的假 FAIL），且不計入通過／失敗清單', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'bot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    expect(body.success).toBe(true);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('INFO');
    expect(autoReply.pass).toBe(false);
  });

  it('chatMode=chat → AUTO_REPLY 仍為 INFO（chatMode 的值不影響 AUTO_REPLY 判定，只影響 BOT_MODE）', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'chat' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('INFO');
    // chatMode='chat' 會讓 BOT_MODE 真的 FAIL（回應方式不是 Bot），兩者是不同的檢查項目。
    const botMode = findCheck(body.data!.checks, 'BOT_MODE');
    expect(botMode.status).toBe('FAIL');
  });

  it('chatMode=bot → BOT_MODE 為 PASS（回應方式：Bot 模式，推薦）', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'bot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const botMode = findCheck(body.data!.checks, 'BOT_MODE');
    expect(botMode.status).toBe('PASS');
  });

  it('缺少 chatMode 欄位 → AUTO_REPLY 仍為 INFO，BOT_MODE 為 FAIL（無法確認回應方式）', async () => {
    mock.reset();
    mock.setBotInfo({ userId: 'Umockbot0000000000000000000000000', basicId: '@mockbot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('INFO');
    const botMode = findCheck(body.data!.checks, 'BOT_MODE');
    expect(botMode.status).toBe('FAIL');
  });

  it('GET /v2/bot/info 呼叫失敗 → AUTO_REPLY 仍為 INFO（不因 TOKEN 檢查失敗而變 FAIL 或 PASS）', async () => {
    mock.reset();
    mock.failNext(500);
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('INFO');
  });

  it('TOKEN 真的驗證失敗時仍正確產生 FAIL（確認 AUTO_REPLY 恆為 INFO 的邏輯沒有連坐影響 TOKEN 的判定）', async () => {
    mock.reset();
    mock.failNext(401);
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const token = findCheck(body.data!.checks, 'TOKEN');
    expect(token.status).toBe('FAIL');
    expect(token.pass).toBe(false);
    // BOT_MODE 依附在同一次 /v2/bot/info 呼叫上，TOKEN 失敗時也應該是 FAIL。
    const botMode = findCheck(body.data!.checks, 'BOT_MODE');
    expect(botMode.status).toBe('FAIL');
    // AUTO_REPLY 仍是 INFO，不是被 TOKEN 的失敗拖成 FAIL。
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('INFO');
  });

  it('Channel ID／Secret 配對正確時 ID_SECRET_PAIR 為 PASS；OAuth 端點回 invalid_client 時為 FAIL', async () => {
    mock.reset();
    mock.setOAuthToken({ access_token: 'mock-stateless-token', expires_in: 1800 });
    const apiOk = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const resOk = await apiOk.post('/api/settings/line/verify');
    const bodyOk = await readJson<{ checks: Check[] }>(resOk);
    expect(findCheck(bodyOk.data!.checks, 'ID_SECRET_PAIR').status).toBe('PASS');

    mock.reset();
    // 帶非 200 status（route.ts 用 res.ok 判定 pair.ok，body 內容不影響 status）。
    mock.setOAuthToken({ error: 'invalid_client' }, 400);
    const apiFail = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const resFail = await apiFail.post('/api/settings/line/verify');
    const bodyFail = await readJson<{ checks: Check[] }>(resFail);
    expect(findCheck(bodyFail.data!.checks, 'ID_SECRET_PAIR').status).toBe('FAIL');
  });

  it('Webhook 端點設定正確時 WEBHOOK 為 PASS，測試請求成功時 WEBHOOK_TEST 為 PASS', async () => {
    mock.reset();
    const url = await expectedWebhookUrl();
    mock.setWebhookEndpoint({ endpoint: url, active: true });
    mock.setWebhookTest({ success: true, statusCode: 200 });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    const body = await readJson<{ checks: Check[] }>(res);
    expect(findCheck(body.data!.checks, 'WEBHOOK').status).toBe('PASS');
    expect(findCheck(body.data!.checks, 'WEBHOOK_TEST').status).toBe('PASS');
  });

  it('Webhook 端點網址與本店不符時 WEBHOOK 為 FAIL（不是隨便回 PASS）', async () => {
    mock.reset();
    mock.setWebhookEndpoint({ endpoint: 'https://not-this-shop.example.com/webhook', active: true });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    const body = await readJson<{ checks: Check[] }>(res);
    expect(findCheck(body.data!.checks, 'WEBHOOK').status).toBe('FAIL');
  });

  it('Webhook 端點 active:false（Use webhook 未開啟）時 WEBHOOK 為 FAIL', async () => {
    mock.reset();
    const url = await expectedWebhookUrl();
    mock.setWebhookEndpoint({ endpoint: url, active: false });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    const body = await readJson<{ checks: Check[] }>(res);
    expect(findCheck(body.data!.checks, 'WEBHOOK').status).toBe('FAIL');
  });

  it('缺 Channel Secret 時 CREDENTIALS 為 FAIL（token 有填但憑證不完整）', async () => {
    mock.reset();
    const { error } = await admin
      .from('tenant_settings')
      .update({ line_channel_secret_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    try {
      const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
      const res = await api.post('/api/settings/line/verify');
      const body = await readJson<{ checks: Check[] }>(res);
      expect(findCheck(body.data!.checks, 'CREDENTIALS').status).toBe('FAIL');
      // 缺 Secret 也會讓 ID_SECRET_PAIR 直接判 FAIL（不呼叫 LINE 就能判定）。
      expect(findCheck(body.data!.checks, 'ID_SECRET_PAIR').status).toBe('FAIL');
    } finally {
      const { error: eRestore } = await admin
        .from('tenant_settings')
        .update({ line_channel_secret_enc: encryptSecret(CHANNEL_SECRET) })
        .eq('tenant_id', SHOP_A.id);
      expect(eRestore).toBeNull();
    }
  });

  it('Webhook 測試回 success:false 時 WEBHOOK_TEST 為 FAIL（即使 WEBHOOK 端點設定本身是 PASS）', async () => {
    mock.reset();
    const url = await expectedWebhookUrl();
    mock.setWebhookEndpoint({ endpoint: url, active: true });
    mock.setWebhookTest({ success: false, statusCode: 500, reason: 'CONNECTION_FAILED' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    const body = await readJson<{ checks: Check[] }>(res);
    expect(findCheck(body.data!.checks, 'WEBHOOK').status).toBe('PASS');
    expect(findCheck(body.data!.checks, 'WEBHOOK_TEST').status).toBe('FAIL');
  });

  it('摘要失敗數只計入六項可查證檢查的真正 FAIL，INFO（AUTO_REPLY）不計入任一邊（正常設定下六項全 PASS）', async () => {
    mock.reset();
    await mockAllPassing();
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const checks = body.data!.checks;

    const verifiable = checks.filter((c) => VERIFIABLE_KEYS.includes(c.key));
    const failCount = verifiable.filter((c) => c.status === 'FAIL').length;
    const autoReply = findCheck(checks, 'AUTO_REPLY');

    expect(autoReply.status).toBe('INFO');
    // AUTO_REPLY 不應該被算進 failCount（它甚至不在 VERIFIABLE_KEYS 裡）。
    expect(verifiable.map((c) => c.key)).not.toContain('AUTO_REPLY');
    // 正常設定下（六項全真的 PASS）不應該有任何真正的 FAIL。
    // 這裡刻意寫死 0，而不是拿 checks.filter(...).length 跟自己比較——後者是恆真斷言，
    // 永遠不會轉紅（Sol early diff audit 在 #477 首次修復時找到的問題）。
    expect(failCount).toBe(0);
  });

  it('無 LINE token 設定時，六項可查證檢查皆為 FAIL、統一錯誤訊息、AUTO_REPLY 不出現、且不對 LINE 發出任何請求', async () => {
    mock.reset();
    const { error: eClear } = await admin
      .from('tenant_settings')
      .update({ line_channel_access_token_enc: '' })
      .eq('tenant_id', SHOP_A.id);
    expect(eClear).toBeNull();

    try {
      const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
      const res = await api.post('/api/settings/line/verify');
      expect(res.status).toBe(200);
      const body = await readJson<{ checks: Check[] }>(res);
      expect(body.success).toBe(true);
      const checks = body.data!.checks;

      // 無 token 時只回六項可查證檢查（皆 FAIL），AUTO_REPLY 這個人工提示不出現——
      // 沒有設定連上方六項都測不了，顯示提示店家去關一個還沒接上的開關沒有意義。
      expect(checks).toHaveLength(6);
      for (const c of checks) {
        expect(c.status, `${c.key} 應為 FAIL（無 token）`).toBe('FAIL');
        expect(c.pass).toBe(false);
      }
      const messages = new Set(checks.map((c) => c.message));
      expect(messages.size).toBe(1);

      // 沒有 token 時不應該打過假 LINE server —— mock.reset() 後若本測試呼叫了
      // LINE，requests 會非空。
      expect(mock.requests.length).toBe(0);
    } finally {
      const { error: eRestore } = await admin
        .from('tenant_settings')
        .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN) })
        .eq('tenant_id', SHOP_A.id);
      expect(eRestore).toBeNull();
    }
  });

  it('pass 欄位與 status 的向後相容不變式：對每個 check 都要成立 pass === (status === \'PASS\')', async () => {
    mock.reset();
    await mockAllPassing();
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const checks = body.data!.checks;
    expect(checks.length).toBeGreaterThan(0);
    for (const c of checks) {
      expect(c.pass, `${c.key}: pass (${c.pass}) 應等於 status==='PASS' (${c.status})`).toBe(
        c.status === 'PASS',
      );
    }
  });
});
