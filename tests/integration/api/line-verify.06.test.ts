/**
 * POST /api/settings/line/verify —— 五項檢查全分支整合測試
 * -----------------------------------------------------------------------------
 * 12 分冊 §4「Phase 6（LINE）」2026-08-24 補列第二組：
 *   「verify 五項：TOKEN/WEBHOOK/AUTO_REPLY/RICH_MENU/QUOTA 各自的 pass 與
 *    fail/WARN 分支，用 line-mock 控制 /v2/bot/info（含 chatMode 三態）、
 *    webhook endpoint、richmenu、quota 回應逐一驗證；無 token 時五項全 fail。」
 * 契約出處：docs/integration/06-LINE-INTEGRATION.md §7。實作：
 * src/app/api/settings/line/verify/route.ts、src/server/line.ts（lineGetRaw）。
 *
 * ⚠️ 這一組不只是「補覆蓋率」，它釘的是 CLAUDE.md 開頭那整節的教訓。
 * 這份報告曾經把「我們根本沒去檢查的東西」畫成紅色失敗（AUTO_REPLY 寫死
 * `pass:false`），而且頁面把所有非 pass 都算失敗，於是**在任何設定下都印不出
 * 「全部通過」**。使用者照著紅字去 LINE 後台關掉設定、重跑、還是紅的，才問出
 * 這件事。所以本檔除了逐項驗 pass/fail，還額外釘死兩件事：
 *
 *   1. **WARN 不得被算成 FAIL**：`severity:'WARN'` 的項目代表「查不到／還沒做」，
 *      與「查了，壞了」必須可分辨。本檔用 `isFail()`（`!pass && severity!=='WARN'`）
 *      當判準，逐案例斷言哪些是真失敗、哪些只是提醒。
 *   2. **報告在正常設定下真的能全綠**：見「五項全部通過」那一條。
 *      一個永遠不可能全綠的檢查等於沒有檢查——這一條紅了，就是那個病復發了。
 *
 * chatMode 三態（`bot` / `chat` / 讀不到）之所以要全涵蓋：它是 `GET /v2/bot/info`
 * 的欄位，也正是當初「自動回應無法檢查」這個錯誤結論被推翻的關鍵（LINE 官方
 * OpenAPI `BotInfoResponse.chatMode`）。
 *
 * 鏈路：本測試 process 在固定 port 4123 起假 LINE server（tests/helpers/line-mock.ts），
 * 用它的 respondTo() 逐條路徑控制回應；global-setup spawn 的 next dev 讀 .env.test
 * 的 LINE_API_BASE 打到這裡。
 *
 * 清理紀律：只動 SHOP_A tenant_settings 的兩個 *_enc 欄位，beforeAll 快照、
 * afterAll 還原；不建立任何業務資料列。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

const CHANNEL_TOKEN = 'itest-line-token-07-verify';

const PATH_INFO = '/v2/bot/info';
const PATH_WEBHOOK = '/v2/bot/channel/webhook/endpoint';
const PATH_RICHMENU = '/v2/bot/user/all/richmenu';
const PATH_QUOTA = '/v2/bot/message/quota';
const PATH_CONSUMPTION = '/v2/bot/message/quota/consumption';

const ALL_KEYS = ['TOKEN', 'WEBHOOK', 'AUTO_REPLY', 'RICH_MENU', 'QUOTA'] as const;

type Check = { key: string; pass: boolean; message: string; severity?: 'FAIL' | 'WARN' };
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let tokenSnapshot = '';
/** 本店 webhook URL —— 由伺服器算（buildWebhookUrl(APP_URL, shopCode)），從設定端點取回 */
let expectedWebhookUrl = '';

/**
 * 「這一項是真的失敗嗎？」
 * severity 省略時視為 FAIL（route 的既有約定）；'WARN' 代表「查不到／還沒做」，
 * 不得被算成失敗——這正是本檔要釘死的那條線。
 */
const isFail = (c: Check): boolean => !c.pass && c.severity !== 'WARN';
const isWarn = (c: Check): boolean => !c.pass && c.severity === 'WARN';

async function verify(): Promise<Record<string, Check>> {
  const res = await ownerA.post('/api/settings/line/verify');
  expect(res.status).toBe(200);
  const body = (await res.json()) as Envelope<{ checks: Check[] }>;
  expect(body.success).toBe(true);
  const checks = body.data?.checks ?? [];
  // 五項一個都不能少，順序也照 06 §7 的表
  expect(checks.map((c) => c.key)).toEqual([...ALL_KEYS]);
  return Object.fromEntries(checks.map((c) => [c.key, c]));
}

/** 把 mock 調成「一切正常」的基線；個別案例再用 respondTo 覆寫要壞的那一條 */
function respondAllHealthy(): void {
  mock.respondTo(PATH_INFO, {
    body: { userId: 'Uitest', basicId: '@itest', displayName: 'itest', chatMode: 'bot' },
  });
  mock.respondTo(PATH_WEBHOOK, { body: { endpoint: expectedWebhookUrl, active: true } });
  mock.respondTo(PATH_RICHMENU, { body: { richMenuId: 'richmenu-itest-verify' } });
  mock.respondTo(PATH_QUOTA, { body: { type: 'limited', value: 500 } });
  mock.respondTo(PATH_CONSUMPTION, { body: { totalUsage: 120 } });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 ' +
      'LINE_API_BASE=http://localhost:4123，讓 next dev 的 src/server/line.ts ' +
      '打到 tests/helpers/line-mock.ts 起的假 LINE。',
    );
  }

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await mock.start();

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line_channel_access_token_enc').eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  tokenSnapshot = (snap?.line_channel_access_token_enc ?? '') as string;

  const { error: e1 } = await admin.from('tenant_settings')
    .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN) })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 期望的 webhook URL 由伺服器算出（APP_URL + shopCode），不在測試裡另抄一份規則
  const settingsRes = await ownerA.get('/api/settings');
  expect(settingsRes.status).toBe(200);
  const settings = (await settingsRes.json()) as Envelope<{ line: { webhookUrl: string } }>;
  expectedWebhookUrl = settings.data?.line.webhookUrl ?? '';
  expect(expectedWebhookUrl).toContain(`/api/line/webhook/${SHOP_A.shopCode}`);
});

afterAll(async () => {
  await admin.from('tenant_settings')
    .update({ line_channel_access_token_enc: tokenSnapshot }).eq('tenant_id', SHOP_A.id);
  await mock.stop();
});

beforeEach(() => { mock.reset(); });

describe('POST /api/settings/line/verify — 全綠與 WARN/FAIL 的分界（06 §7）', () => {
  it('五項全部通過：報告在正常設定下真的能是全綠（沒有任何 FAIL，也沒有任何 WARN）', async () => {
    respondAllHealthy();
    const c = await verify();

    for (const key of ALL_KEYS) {
      expect(`${key}:${c[key].pass}`).toBe(`${key}:true`);
    }
    expect(Object.values(c).filter(isFail)).toEqual([]);
    expect(Object.values(c).filter(isWarn)).toEqual([]);

    // 五項都是真的去問過 LINE 才有的結論（不是寫死的）
    const paths = new Set(mock.requests.map((r) => r.path));
    expect(paths).toEqual(new Set([
      PATH_INFO, PATH_WEBHOOK, PATH_RICHMENU, PATH_QUOTA, PATH_CONSUMPTION,
    ]));
    for (const r of mock.requests) {
      expect(r.headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    }
  });

  it('未設定 Channel Access Token → 五項全 fail、統一提示，且一個 LINE 請求都不發', async () => {
    const { error } = await admin.from('tenant_settings')
      .update({ line_channel_access_token_enc: '' }).eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    try {
      const c = await verify();
      for (const key of ALL_KEYS) {
        expect(`${key}:${c[key].pass}`).toBe(`${key}:false`);
        expect(c[key].message).toBe('尚未設定 LINE Channel Token');
        expect(c[key].severity).toBeUndefined();      // 五項都是 FAIL，不是 WARN
      }
      expect(mock.requests).toHaveLength(0);
    } finally {
      await admin.from('tenant_settings')
        .update({ line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN) })
        .eq('tenant_id', SHOP_A.id);
    }
  });
});

describe('AUTO_REPLY —— chatMode 三態（06 §7；CLAUDE.md「不要製造假的已知」）', () => {
  it('chatMode=bot → AUTO_REPLY 通過（不是永遠的紅色失敗）', async () => {
    respondAllHealthy();
    const c = await verify();
    expect(c.AUTO_REPLY.pass).toBe(true);
    expect(isFail(c.AUTO_REPLY)).toBe(false);
    expect(c.AUTO_REPLY.message).toContain('聊天');
  });

  it('chatMode=chat → AUTO_REPLY 是 WARN 而非 FAIL，其餘四項仍全綠', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_INFO, { body: { basicId: '@itest', chatMode: 'chat' } });

    const c = await verify();
    expect(c.AUTO_REPLY.pass).toBe(false);
    expect(c.AUTO_REPLY.severity).toBe('WARN');
    expect(isFail(c.AUTO_REPLY)).toBe(false);          // ← WARN 不得被算成 FAIL
    expect(c.AUTO_REPLY.message).toContain('聊天');

    // 這份報告裡「真的壞掉」的項目數應為 0：唯一非 pass 的是那則提醒
    expect(Object.values(c).filter(isFail)).toEqual([]);
    for (const key of ['TOKEN', 'WEBHOOK', 'RICH_MENU', 'QUOTA'] as const) {
      expect(`${key}:${c[key].pass}`).toBe(`${key}:true`);
    }
  });

  it('chatMode 讀不到（/v2/bot/info 回應沒有這個欄位）→ AUTO_REPLY 是 WARN 提醒，不是失敗', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_INFO, { body: { basicId: '@itest', displayName: 'itest' } }); // 無 chatMode

    const c = await verify();
    expect(c.TOKEN.pass).toBe(true);                   // token 本身仍有效
    expect(c.AUTO_REPLY.pass).toBe(false);
    expect(c.AUTO_REPLY.severity).toBe('WARN');
    expect(c.AUTO_REPLY.message).toContain('無法讀取');
    expect(Object.values(c).filter(isFail)).toEqual([]);
  });
});

describe('TOKEN', () => {
  it('/v2/bot/info 回 401 → TOKEN 是 FAIL；同一份報告裡 AUTO_REPLY 降級為 WARN（兩者可分辨）', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_INFO, { status: 401, body: { message: 'Invalid access token' } });

    const c = await verify();
    expect(c.TOKEN.pass).toBe(false);
    expect(c.TOKEN.severity).toBeUndefined();          // = FAIL
    expect(isFail(c.TOKEN)).toBe(true);
    expect(c.TOKEN.message).toBe('Invalid access token');

    // 讀不到 botInfo → AUTO_REPLY 只能是提醒，不能跟著被算成失敗
    expect(isWarn(c.AUTO_REPLY)).toBe(true);
    expect(Object.values(c).filter(isFail).map((x) => x.key)).toEqual(['TOKEN']);
  });
});

describe('WEBHOOK', () => {
  it('LINE 上設定的 endpoint 與本店不符 → FAIL，訊息帶出目前實際值', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_WEBHOOK, {
      body: { endpoint: 'https://someone-else.example/api/line/webhook/other-shop', active: true },
    });

    const c = await verify();
    expect(isFail(c.WEBHOOK)).toBe(true);
    expect(c.WEBHOOK.message).toContain('https://someone-else.example/api/line/webhook/other-shop');
    expect(Object.values(c).filter(isFail).map((x) => x.key)).toEqual(['WEBHOOK']);
  });

  it('endpoint 正確但 active=false → 仍是 FAIL（設定了不等於啟用）', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_WEBHOOK, { body: { endpoint: expectedWebhookUrl, active: false } });

    const c = await verify();
    expect(isFail(c.WEBHOOK)).toBe(true);
    expect(c.WEBHOOK.message).toContain('尚未啟用');
  });

  it('webhook 設定查詢失敗（LINE 回 500）→ FAIL，訊息為查詢失敗', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_WEBHOOK, { status: 500, body: {} });

    const c = await verify();
    expect(isFail(c.WEBHOOK)).toBe(true);
    expect(c.WEBHOOK.message).toBe('Webhook 設定查詢失敗');
    expect(c.TOKEN.pass).toBe(true);                   // 其他項不受牽連
  });
});

describe('RICH_MENU', () => {
  it('已發布預設選單 → pass', async () => {
    respondAllHealthy();
    const c = await verify();
    expect(c.RICH_MENU.pass).toBe(true);
    expect(c.RICH_MENU.message).toBe('Rich Menu 已發布');
  });

  it('尚未發布 → WARN 而非 FAIL（沒有圖文選單不影響 Bot 收訊息，是「還沒做」）', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_RICHMENU, { body: {} });       // 無 richMenuId

    const c = await verify();
    expect(c.RICH_MENU.pass).toBe(false);
    expect(c.RICH_MENU.severity).toBe('WARN');
    expect(isFail(c.RICH_MENU)).toBe(false);
    expect(Object.values(c).filter(isFail)).toEqual([]);
  });
});

describe('QUOTA', () => {
  it('limited 方案 → 依 quota - 已用量算出剩餘則數', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_QUOTA, { body: { type: 'limited', value: 500 } });
    mock.respondTo(PATH_CONSUMPTION, { body: { totalUsage: 120 } });

    const c = await verify();
    expect(c.QUOTA.pass).toBe(true);
    expect(c.QUOTA.message).toBe('本月推播額度尚有 380 則');
  });

  it('已用量超過上限 → 剩餘不會變成負數', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_QUOTA, { body: { type: 'limited', value: 200 } });
    mock.respondTo(PATH_CONSUMPTION, { body: { totalUsage: 260 } });

    const c = await verify();
    expect(c.QUOTA.pass).toBe(true);
    expect(c.QUOTA.message).toBe('本月推播額度尚有 0 則');
  });

  it('無上限方案 → 只報已發送數，不假造一個上限', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_QUOTA, { body: { type: 'none' } });
    mock.respondTo(PATH_CONSUMPTION, { body: { totalUsage: 37 } });

    const c = await verify();
    expect(c.QUOTA.pass).toBe(true);
    expect(c.QUOTA.message).toBe('本月已發送 37 則（無上限方案）');
  });

  it('額度查詢失敗（LINE 回 500）→ FAIL', async () => {
    respondAllHealthy();
    mock.respondTo(PATH_CONSUMPTION, { status: 500, body: {} });

    const c = await verify();
    expect(isFail(c.QUOTA)).toBe(true);
    expect(c.QUOTA.message).toBe('推播額度查詢失敗');
    expect(Object.values(c).filter(isFail).map((x) => x.key)).toEqual(['QUOTA']);
  });
});

describe('權限', () => {
  it('未登入 → 401 AUTH_001，且不打 LINE', async () => {
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/settings/line/verify`, { method: 'POST' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).code).toBe('AUTH_001');
    expect(mock.requests).toHaveLength(0);
  });
});
