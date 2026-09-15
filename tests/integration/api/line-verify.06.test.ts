/**
 * POST /api/settings/line/verify — AUTO_REPLY 三態語意整合測試（Issue #477 P0）。
 *
 * 背景：舊版 AUTO_REPLY 檢查恆回 `pass:false`（假 FAIL），且沒有任何測試守著
 * 這個行為（#477 本文 Evidence：本檔在修復前不存在，GitHub 查 404）。LINE 官方
 * 沒有公開 API 能直接讀取「自動回應訊息」這顆開關本身——GET /v2/bot/info 的
 * chatMode 欄位只代表 LINE OA Manager 的「Chat」開／關，不是自動回應開關，
 * 不能拿 chatMode 的值去推論 AUTO_REPLY 的 PASS/FAIL。
 *
 * 本檔驗證修復後的正確語意（src/app/api/settings/line/verify/route.ts 檔頭）：
 *   - AUTO_REPLY 不論 chatMode 為何、缺欄位、甚至 /v2/bot/info 呼叫失敗，
 *     一律回 status:'WARN'（不是 PASS，也不是舊版的假 FAIL）。
 *   - TOKEN 檢查的 PASS/FAIL 判定完全獨立，不因 AUTO_REPLY 恆為 WARN 而被牽動
 *     （也不因為 AUTO_REPLY 邏輯的存在而被連坐影響）。
 *   - 摘要「失敗數」只能計入真正的 FAIL，WARN 不算失敗——這是前端
 *     src/app/tenant/line-settings/page.tsx 的 failCount 計算規則，這裡在
 *     API 回傳層面驗證 status 欄位本身正確，讓前端規則有正確資料可用。
 *
 * 鏈路與既有 line-webhook.06.test.ts 相同：next dev（BASE_URL）打
 * src/server/line.ts 的 lineGetRaw，其 base 由 LINE_API_BASE 指向本檔用
 * tests/helpers/line-mock.ts 起的本地假 LINE server（固定 port，走
 * LineMockServer.setBotInfo() 覆寫 GET /v2/bot/info 的回應內容）、
 * failNext() 模擬呼叫失敗。
 *
 * 前置資料：beforeAll 以 service role + encryptSecret() 把測試用 LINE
 * Channel Access Token 寫進 SHOP_A 的 tenant_settings（seed 預設是空字串，
 * 無 token 時全部檢查一律 FAIL，不會走到本檔要驗證的邏輯）；afterAll 還原
 * 快照，不影響其他測試檔對 SHOP_A LINE 憑證「尚未設定」的假設
 * （settings.a1.test.ts 檔頭清理紀律段落）。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs } from '../../helpers/auth';
import { encryptSecret } from '@/server/crypto';
import { LineMockServer } from '../../helpers/line-mock';

type CheckStatus = 'PASS' | 'WARN' | 'FAIL';
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

const CHANNEL_TOKEN = 'itest-line-access-token-verify06';

let admin: SupabaseClient;
const mock = new LineMockServer();

/** tenant_settings 快照（afterAll 還原用；只動 access token 欄位） */
let tokenEncSnapshot: string | null = null;

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
    .select('line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  tokenEncSnapshot = (snap as { line_channel_access_token_enc: string } | null)?.line_channel_access_token_enc ?? '';

  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN) })
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
  if (tokenEncSnapshot !== null) {
    const { error } = await admin
      .from('tenant_settings')
      .update({ line_channel_access_token_enc: tokenEncSnapshot })
      .eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
  }
});

describe('POST /api/settings/line/verify — AUTO_REPLY 三態（Issue #477 P0）', () => {
  it('chatMode=bot → AUTO_REPLY 為 WARN（不是 PASS，不是 FAIL）', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'bot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    expect(body.success).toBe(true);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('WARN');
    expect(autoReply.pass).toBe(false);
  });

  it('chatMode=chat → AUTO_REPLY 仍為 WARN（chatMode 的值不影響判定）', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'chat' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('WARN');
  });

  it('缺少 chatMode 欄位 → AUTO_REPLY 為 WARN', async () => {
    mock.reset();
    mock.setBotInfo({ userId: 'Umockbot0000000000000000000000000', basicId: '@mockbot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('WARN');
  });

  it('GET /v2/bot/info 呼叫失敗 → AUTO_REPLY 仍為 WARN（不因 TOKEN 檢查失敗而變 FAIL 或 PASS）', async () => {
    mock.reset();
    mock.failNext(500);
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('WARN');
  });

  it('TOKEN 真的驗證失敗時仍正確產生 FAIL（確認 AUTO_REPLY 恆為 WARN 的邏輯沒有連坐影響 TOKEN 的判定）', async () => {
    mock.reset();
    mock.failNext(401);
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const token = findCheck(body.data!.checks, 'TOKEN');
    expect(token.status).toBe('FAIL');
    expect(token.pass).toBe(false);
    // AUTO_REPLY 仍是 WARN，不是被 TOKEN 的失敗拖成 FAIL
    const autoReply = findCheck(body.data!.checks, 'AUTO_REPLY');
    expect(autoReply.status).toBe('WARN');
  });

  it('摘要失敗數只計入真正的 FAIL，WARN 不算失敗（正常設定下：TOKEN/WEBHOOK/RICH_MENU/QUOTA 皆 PASS，AUTO_REPLY 為 WARN）', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'bot' });
    const api = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
    // 讓 WEBHOOK、RICH_MENU 也走到 PASS 分支，模擬「正常設定」——否則 mock
    // 預設回應（endpoint 缺欄位、richMenuId 缺欄位）會讓這兩項照 route.ts 的
    // 判定邏輯真的 FAIL，掩蓋了本案例真正要驗證的性質（WARN 不算 FAIL）。
    // 期望的 webhook URL 不能在測試檔裡自己用 APP_URL 重算——測試 process 與
    // global-setup spawn 的 next dev（實際跑 route.ts 的那個 process）環境變數
    // 不保證一致（實測發現前者是 vercel 網域、後者是 http://localhost:3100），
    // 一定要向同一個 next dev 要它自己算出的值：GET /api/settings 用
    // 跟 verify route 相同的 buildWebhookUrl(APP_URL, shopCode) 算 line.webhookUrl
    // （04 分冊 A-1），直接沿用即可對齊。
    const settingsRes = await api.get('/api/settings');
    expect(settingsRes.status).toBe(200);
    const settingsBody = await readJson<{ line: { webhookUrl: string } }>(settingsRes);
    const expectedWebhookUrl = settingsBody.data!.line.webhookUrl;
    expect(expectedWebhookUrl).toBeTruthy();
    mock.setWebhookEndpoint({ endpoint: expectedWebhookUrl, active: true });
    mock.setRichMenuAll({ richMenuId: 'richmenu-mock-0001' });
    const res = await api.post('/api/settings/line/verify');
    expect(res.status).toBe(200);
    const body = await readJson<{ checks: Check[] }>(res);
    const checks = body.data!.checks;

    // TOKEN/WEBHOOK/RICH_MENU/QUOTA 這裡都是真的 PASS（mock 沒有 fail 且設定齊全），
    // AUTO_REPLY 是 WARN——用跟前端 line-settings/page.tsx 相同的規則重算一次，
    // 確認 WARN 不進失敗數。
    const failCount = checks.filter((c) => c.status === 'FAIL').length;
    const warnCount = checks.filter((c) => c.status === 'WARN').length;
    const autoReply = findCheck(checks, 'AUTO_REPLY');

    expect(autoReply.status).toBe('WARN');
    expect(warnCount).toBeGreaterThanOrEqual(1);
    // AUTO_REPLY 不應該被算進 failCount
    expect(checks.filter((c) => c.status === 'FAIL').map((c) => c.key)).not.toContain('AUTO_REPLY');
    // 正常設定下（TOKEN 真的 PASS）不應該有任何真正的 FAIL，只有 AUTO_REPLY 是 WARN。
    // 這裡刻意寫死 0，而不是拿 checks.filter(...).length 跟自己比較——後者是恆真斷言，
    // 永遠不會轉紅（Sol early diff audit 找到的問題 3）。
    expect(failCount).toBe(0);
  });

  it('無 LINE token 設定時，五項皆為 FAIL、統一錯誤訊息、且不對 LINE 發出任何請求', async () => {
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

      expect(checks).toHaveLength(5);
      for (const c of checks) {
        expect(c.status, `${c.key} 應為 FAIL（無 token）`).toBe('FAIL');
        expect(c.pass).toBe(false);
      }
      // 五項訊息應一致，反映「沒有設定 token，所以整批都沒查」的單一原因，
      // 不是各自對 LINE 呼叫後才各自失敗。
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

  it('pass 欄位與 status 的向後相容不變式：對五個 check 都要成立 pass === (status === \'PASS\')', async () => {
    mock.reset();
    mock.setBotInfo({ chatMode: 'bot' });
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
