/**
 * GUIDE 的「訂單查詢」查 `tour_orders`（issue #373）整合測試
 * -----------------------------------------------------------------------------
 * ## 為什麼有這一檔
 *
 * `replyOrders()`（`src/server/line-events.ts`）在 `businessTypeOf === 'GUIDE'`
 * 時，曾經一律回 `MSG.notReadyOrder`（「訂單查詢還在準備中」）。那句話在
 * `tour_orders` 表與 `create_tour_order`／`cancel_tour_order` 等 rpc 都不存在的
 * 時候是誠實的；`0087`／`0088` 進 `main`、2026-09-11 依 Owner 具名授權套用至
 * 正式庫之後，繼續回「準備中」就變成「查得到卻說查不到」——PB-027 的第四種
 * 形狀（符號存在 ≠ 事情會發生）。
 *
 * 這一檔驗的是「顧客收到什麼」，走真實 webhook（簽章 → route → `after()` →
 * mock LINE），比照 `line-order-query.251.test.ts`（`product_orders` 那半邊）
 * 與 `keyword-replies.05.test.ts` 的既有慣例。
 *
 * ⚠️ 「查詢失敗不得說成『沒有訂單』」那一條驗收，改在單元測試
 * `tests/unit/line-tour-order-query-error.373.test.ts` 驗證——原因見該檔開頭：
 * `tour_orders` 的 `tenant_id`／`customer_id` 都是 `uuid` 型別，黑箱打不出一個
 * 「查詢真的失敗」的 PostgREST 錯誤。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, TRIP_A } from '../../fixtures';
import { LineMockServer, type RecordedLineRequest } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';
import type { BusinessType } from '@/config/modes';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-o373';
const CHANNEL_TOKEN = 'itest-line-access-token-o373';

/** 本檔專用 LINE user id（避免跟 keyword-replies.05 / line-webhook.06 / line-order-query.251 互踩） */
const USER = 'Uorder373itest00000000000000000001';

/** 「都沒命中」時的分支 ⑥ 回覆——有它，「命中」與「沒命中」在斷言上才分得開 */
const DEFAULT_REPLY = '【itest-373】這是分支⑥的預設回覆，代表沒有任何 handler 命中';

/**
 * 本檔造出來的旅遊訂單編號。
 *
 * ⚠️ 全部帶 `itest-373-` 前綴，afterAll 只刪自己的：`tour_orders` 的唯一索引是
 * `(tenant_id, order_no)`（`0087`），整表 delete 會把別的測試檔（例如
 * `tour-orders.10.test.ts`）留下的訂單一起清掉。
 */
const ORDER_NO = {
  newest: 'itest-373-A-0003',
  middle: 'itest-373-A-0002',
  oldest: 'itest-373-A-0001',
  otherCustomer: 'itest-373-A-OTHER',
} as const;

let admin: SupabaseClient;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let businessTypeSnapshot = 'LOCAL_SHOP';

/** LINE 官方簽章規則（與 route.ts 驗簽演算法互為鏡像） */
function sign(rawBody: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(rawBody).digest('base64');
}

function eventBody(text: string, replyToken: string): string {
  return JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message',
      replyToken,
      source: { type: 'user', userId: USER },
      message: { id: `m-${replyToken}`, type: 'text', text },
    }],
  });
}

async function postWebhook(text: string, replyToken: string): Promise<void> {
  const raw = eventBody(text, replyToken);
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status, `webhook 對「${text}」回了 ${res.status}`).toBe(200);
  // #31：回 200 後事件才在 after() 裡處理（06 §3.1）。drainWebhook 是 server 端的
  // 確定性完成訊號，不是 sleep 猜等（12 §2.3）。
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
}

/** 以顧客身分送一則文字訊息，回傳 mock LINE 收到的 reply 文字（沒回覆＝null） */
async function customerSays(text: string): Promise<string | null> {
  mock.reset();
  await postWebhook(text, `rt-${Math.random().toString(36).slice(2)}`);
  const replies = mock.requestsFor('/v2/bot/message/reply');
  if (replies.length === 0) return null;
  expect(replies).toHaveLength(1);
  return String(replies[0].body?.messages?.[0]?.text ?? '');
}

/**
 * 打一則顧客訊息，回傳 mock LINE 在**這一輪**收到的全部請求。
 *
 * 「bot 閉嘴了」的最強斷言是這個陣列為空，而不是 `customerSays() === null`：
 * customerSays 只翻 `/v2/bot/message/reply`，push / multicast 偷跑它抓不到。
 */
async function lineCallsFor(text: string): Promise<RecordedLineRequest[]> {
  mock.reset();
  await postWebhook(text, `rt-${Math.random().toString(36).slice(2)}`);
  return [...mock.requests];
}

async function setBusinessType(bt: BusinessType): Promise<void> {
  const { error } = await admin.from('tenants').update({ business_type: bt }).eq('id', SHOP_A.id);
  expect(error).toBeNull();
}

async function patchLineJsonb(patch: Record<string, unknown>): Promise<void> {
  const { data } = await admin
    .from('tenant_settings').select('line').eq('tenant_id', SHOP_A.id).single();
  const { error } = await admin
    .from('tenant_settings')
    .update({ line: { ...((data?.line ?? {}) as object), ...patch } })
    .eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
}

/** 綁定／解除本檔 LINE user 與某位顧客的關聯 */
async function bindTo(customerId: string | null): Promise<void> {
  if (customerId === null) {
    await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
    return;
  }
  const { error } = await admin.from('line_users').upsert({
    tenant_id: SHOP_A.id,
    line_user_id: USER,
    display_name: 'itest-373 顧客',
    followed: true,
    customer_id: customerId,
  }, { onConflict: 'tenant_id,line_user_id' });
  expect(error).toBeNull();
}

async function deleteTestOrders(): Promise<void> {
  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    await admin
      .from('tour_orders')
      .delete()
      .eq('tenant_id', tenantId)
      .like('order_no', 'itest-373-%');
  }
}

/**
 * 造 A 店三筆旅遊訂單（顧客 A1）＋一筆同店別位顧客。
 *
 * ⚠️ 直接 insert，不走 `create_tour_order` rpc：這裡只需要「查得到訂單」，
 * 不需要驗名額扣減（那是 `tour-orders.10.test.ts` 的範圍）。直接 insert 也
 * 完全不動 `trip_departures.seats_booked`，不用擔心「已知陷阱」提到的
 * 名額殘留問題。
 *
 * ⚠️ 沒有「別家店的訂單」案例：共用 TEST 專案的 `tour_orders` 掛著 `#41`
 * historical overlay trigger（`0098` 的註解已記錄這件事），會比照
 * `create_tour_order()` 驗證 `departure_id` 真的屬於 `tenant_id`——`SHOP_B`
 * 沒有自己的行程資料，硬塞 `tenant_id=SHOP_B` 卻指到 A 店的 `departure1` 會被
 * 該 trigger 擋下（`DEPARTURE_NOT_FOUND`）。`tenant_id` 有沒有真的帶進
 * `replyTourOrders()` 的查詢，由下面「同店別位顧客不會出現」＋程式碼本身
 * 明寫的 `.eq('tenant_id', ctx.tenant.id)` 一起佐證，不再另外造一筆跨租戶
 * 訂單（那需要先在 `SHOP_B` 建一整組行程資料，代價換不回等值的把關）。
 */
async function seedOrders(): Promise<void> {
  await deleteTestOrders();
  const base = {
    tenant_id: SHOP_A.id,
    trip_id: TRIP_A.id,
    plan_id: TRIP_A.planA1,
    departure_id: TRIP_A.departure1,
    unit_price: 1000,
    source: 'MANUAL' as const,
    // ⚠️ 批次 insert 時 supabase-js／PostgREST 以「第一筆物件的 key 聯集」建立欄位
    // 清單，某一筆沒帶到的欄位會被明寫成 NULL，不會落回 column default（0）。
    // 所以 paid_amount 一律在 base 裡顯式帶上，需要非 0 的那筆（已收款）再覆寫。
    paid_amount: 0,
  };
  const { error } = await admin.from('tour_orders').insert([
    {
      ...base, order_no: ORDER_NO.oldest, customer_id: SHOP_A.customerA1,
      party_size: 2, total_amount: 2000, status: 'COMPLETED', payment_status: 'PAID',
      paid_amount: 2000, created_at: '2026-03-01T02:00:00Z',
    },
    {
      ...base, order_no: ORDER_NO.middle, customer_id: SHOP_A.customerA1,
      party_size: 1, total_amount: 1250, status: 'CANCELLED', payment_status: 'REFUNDED',
      created_at: '2026-03-02T02:00:00Z',
    },
    {
      ...base, order_no: ORDER_NO.newest, customer_id: SHOP_A.customerA1,
      party_size: 12, total_amount: 12345, status: 'PENDING', payment_status: 'UNPAID',
      // ⚠️ UTC 17:00 ＝ 台北隔天 01:00，跟 251 的日期案例一致刻意選在跨日位置。
      created_at: '2026-03-03T17:00:00Z',
    },
    {
      ...base, order_no: ORDER_NO.otherCustomer, customer_id: SHOP_A.customerA2,
      party_size: 3, total_amount: 999, status: 'CONFIRMED', payment_status: 'UNPAID',
      created_at: '2026-03-04T02:00:00Z',
    },
  ]);
  expect(error, `種子旅遊訂單插入失敗：${error?.message}`).toBeNull();
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test 設 LINE_API_BASE=http://localhost:4123 ' +
        '與 LINE_DATA_API_BASE=http://localhost:4123（見 line-webhook.06.test.ts 的同段說明）。',
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
  settingsSnapshot = snap as typeof settingsSnapshot;

  const { data: tsnap } = await admin
    .from('tenants').select('business_type').eq('id', SHOP_A.id).single();
  businessTypeSnapshot = (tsnap?.business_type as string) ?? 'LOCAL_SHOP';

  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
      line: {
        autoReplyEnabled: true,
        defaultReply: DEFAULT_REPLY,
        systemKeywordGroupsDisabled: [],
        campaignKeywordEnabled: false,
      },
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  // 自訂關鍵字優先於內建指令（06 §3 優先序 ② 早於 ④）——本檔不驗那條規則，
  // 但若別的檔留下一組含「訂單」的關鍵字，這裡會被它攔截而神秘轉紅。
  await admin.from('keyword_replies').delete().eq('tenant_id', SHOP_A.id);
  await setBusinessType('GUIDE');
  await seedOrders();
});

afterAll(async () => {
  await deleteTestOrders();
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER);
  await admin.from('tenants').update({ business_type: businessTypeSnapshot }).eq('id', SHOP_A.id);
  if (settingsSnapshot) {
    await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

/* ========================================================================== */
/* ① GUIDE 顧客：「我的訂單」真的查得到 tour_orders（本檔最關鍵的一條）           */
/* ========================================================================== */
describe('GUIDE 的「訂單查詢」查得到 tour_orders（issue #373）', () => {
  beforeEach(async () => {
    await setBusinessType('GUIDE');
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
    await bindTo(SHOP_A.customerA1);
    await seedOrders();
  });

  it('顧客打「我的訂單」→ 收到自己的旅遊訂單清單（編號、金額、人數、狀態），不是「準備中」', async () => {
    const reply = await customerSays('我的訂單');
    expect(reply).toBeTruthy();
    // 沒有落到分支 ⑥——這是「有沒有 handler」與「handler 回了什麼」的分界線
    expect(reply).not.toBe(DEFAULT_REPLY);
    // 驗收原文的紅線：絕不能是舊的準備中佔位訊息
    expect(reply).not.toContain('準備中');

    expect(reply).toContain(ORDER_NO.newest);
    expect(reply).toContain(ORDER_NO.middle);
    expect(reply).toContain(ORDER_NO.oldest);
    // 金額走千分位（12345 → 12,345），且用 'zh-TW'，跟 replyOrders() 一致
    expect(reply).toContain('NT$12,345');
    // 訂單狀態是顧客看得懂的中文，不是 enum 代碼
    expect(reply).toContain('待確認');
    expect(reply).not.toContain('PENDING');
  });

  it('最新的排最前面（created_at desc）', async () => {
    const reply = (await customerSays('我的訂單'))!;
    expect(reply.indexOf(ORDER_NO.newest)).toBeLessThan(reply.indexOf(ORDER_NO.middle));
    expect(reply.indexOf(ORDER_NO.middle)).toBeLessThan(reply.indexOf(ORDER_NO.oldest));
  });

  it('同店別位顧客的旅遊訂單不會出現（customer_id 有真的帶進查詢）', async () => {
    const reply = (await customerSays('我的訂單'))!;
    expect(reply).not.toContain(ORDER_NO.otherCustomer);
  });

  it.each(['查看訂單', '訂單查詢'])('同義詞「%s」走同一條 handler', async (word) => {
    const reply = await customerSays(word);
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain(ORDER_NO.newest);
  });

  it('沒有任何旅遊訂單 → 回「沒有旅遊訂單紀錄」，不是預設回覆、也不是「準備中」', async () => {
    await deleteTestOrders();
    const reply = await customerSays('我的訂單');
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).not.toContain('準備中');
    expect(reply).toContain('沒有旅遊訂單紀錄');
  });

  it('LINE 帳號還沒綁定顧客 → 請對方留大名，不是回一份空清單', async () => {
    await bindTo(null);
    const reply = await customerSays('我的訂單');
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain('還沒有找到您的顧客資料');
    // 未綁定時絕不可以把店裡任何一筆訂單念出來
    for (const no of Object.values(ORDER_NO)) expect(reply).not.toContain(no);
  });

  it('店家把「訂單查詢」這一組停用 → bot 完全沒有回應（連 ⑥ 都不落）', async () => {
    await patchLineJsonb({ systemKeywordGroupsDisabled: ['ORDER'] });
    const calls = await lineCallsFor('我的訂單');
    // 停用組落到 ⑥ 的話顧客照樣收到訊息，那顆開關就是假的（與 #5 同一條規則）
    expect(calls).toHaveLength(0);
  });
});
