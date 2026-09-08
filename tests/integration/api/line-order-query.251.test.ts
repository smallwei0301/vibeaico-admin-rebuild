/**
 * 「訂單查詢」系統關鍵字端到端整合測試（#251 第 2 步 parity；#5 ④ 的漏網半邊）
 * -----------------------------------------------------------------------------
 * ## 為什麼有這一檔
 *
 * `ORDER`（訂單查詢）是 keyword-replies 頁「系統內建關鍵字」15 組之一，**三種業態
 * 的後台都列得出來、都附一顆停用開關**。但在此之前 `replyBuiltin()` 的 `case 'ORDER'`
 * 只對 GUIDE 回一句「準備中」，LOCAL_SHOP 與 CLINIC 直接 `return false` 落到預設回覆：
 *
 *   後台擺著一顆「訂單查詢」開關 → 顧客打「我的訂單」→ 收到一句無關的預設回覆
 *
 * 而 `product_orders` 從 `0004` 就存在，`/api/product-orders` 是完整可用的後台功能。
 * 查得到卻不回答——PB-027 的第四種形狀（符號存在 ≠ 事情會發生）。
 *
 * 這個缺口是在 #251 比對「線上 LINE bot 實際在跑的那條 preview 分支」與 `main` 時發現的：
 * 分支上有 `replyOrders()`，`main` 沒有。#251 的結論是「切 webhook 回正式站前，先把
 * 分支獨有的功能補回 main，否則修好指向＝功能倒退」——這一檔就是那個 parity 的證據。
 *
 * ## 這一檔刻意證的是「顧客收到什麼」，不是「函式存在」
 *
 * 單元層要斷言這件事，只能比對原始碼字串（「`line-events.ts` 裡有 `product_orders`」），
 * 那正是 PB-029 說的「測試名稱宣稱得比它證明的多」。所以全部案例都走真實 webhook：
 * 簽章 → route → `after()` → mock LINE，斷言 mock LINE 收到的那段文字。
 *
 * 前置資料與清理紀律比照 `keyword-replies.05.test.ts`：beforeAll 快照 SHOP_A 的
 * `tenant_settings`（line jsonb ＋ 兩個 `*_enc`）與 `tenants.business_type`，afterAll
 * 逐字還原，並刪掉本檔造出的 product_orders / line_users / chat_messages。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { LineMockServer, type RecordedLineRequest } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';
import type { BusinessType } from '@/config/modes';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

/** 本檔專用測試憑證（明文只存在測試裡；寫進 DB 前會 encryptSecret） */
const CHANNEL_SECRET = 'itest-line-channel-secret-o251';
const CHANNEL_TOKEN = 'itest-line-access-token-o251';

/** 本檔專用 LINE user id（避免跟 keyword-replies.05 / line-webhook.06 互踩） */
const USER = 'Uorder251itest00000000000000000001';

/** 「都沒命中」時的分支 ⑥ 回覆——有它，「命中」與「沒命中」在斷言上才分得開 */
const DEFAULT_REPLY = '【itest-251】這是分支⑥的預設回覆，代表沒有任何 handler 命中';

/**
 * 本檔造出來的訂單編號。
 *
 * ⚠️ 全部帶 `itest-251-` 前綴，afterAll 只刪自己的：`product_orders` 的種子資料
 * （`products-orders.b3.test.ts` 等）與本檔共用同一個 tenant，整表 delete 會把
 * 別人的前置資料一起清掉，那種測試檔會在「別人先跑過」時神秘轉紅。
 */
const ORDER_NO = {
  newest: 'itest-251-A-0003',
  middle: 'itest-251-A-0002',
  oldest: 'itest-251-A-0001',
  otherCustomer: 'itest-251-A-OTHER',
  otherTenant: 'itest-251-B-0001',
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
    display_name: 'itest-251 顧客',
    followed: true,
    customer_id: customerId,
  }, { onConflict: 'tenant_id,line_user_id' });
  expect(error).toBeNull();
}

async function deleteTestOrders(): Promise<void> {
  for (const tenantId of [SHOP_A.id, SHOP_B.id]) {
    await admin
      .from('product_orders')
      .delete()
      .eq('tenant_id', tenantId)
      .like('order_no', 'itest-251-%');
  }
}

/**
 * 造 A 店三筆訂單（顧客 A1）＋一筆同店別位顧客＋一筆 B 店。
 *
 * ⚠️ `product_orders` 的唯一索引是 `(tenant_id, order_no)`（`0004`）。所有編號都帶
 * `itest-251-` 前綴，既避開種子資料撞號，也讓 afterAll 能只刪自己的。
 */
async function seedOrders(): Promise<void> {
  await deleteTestOrders();
  const { error } = await admin.from('product_orders').insert([
    {
      tenant_id: SHOP_A.id, order_no: ORDER_NO.oldest, customer_id: SHOP_A.customerA1,
      total_amount: 480, status: 'COMPLETED', payment_status: 'PAID_OFFLINE',
      created_at: '2026-03-01T02:00:00Z',
    },
    {
      tenant_id: SHOP_A.id, order_no: ORDER_NO.middle, customer_id: SHOP_A.customerA1,
      total_amount: 1250, status: 'CANCELLED', payment_status: 'REFUNDED',
      created_at: '2026-03-02T02:00:00Z',
    },
    {
      tenant_id: SHOP_A.id, order_no: ORDER_NO.newest, customer_id: SHOP_A.customerA1,
      total_amount: 12345, status: 'PENDING', payment_status: 'UNPAID',
      // ⚠️ UTC 17:00 ＝ 台北隔天 01:00。這個時刻刻意選在**跨日**的位置，見下方
      // 「台北牆上時鐘」那條案例的說明——UTC 02:00 分不出「有位移」與「沒位移」。
      created_at: '2026-03-03T17:00:00Z',
    },
    {
      tenant_id: SHOP_A.id, order_no: ORDER_NO.otherCustomer, customer_id: SHOP_A.customerA2,
      total_amount: 999, status: 'CONFIRMED', payment_status: 'PAID_ONLINE',
      created_at: '2026-03-04T02:00:00Z',
    },
    {
      tenant_id: SHOP_B.id, order_no: ORDER_NO.otherTenant, customer_id: SHOP_B.customerB1,
      total_amount: 777, status: 'CONFIRMED', payment_status: 'PAID_ONLINE',
      created_at: '2026-03-05T02:00:00Z',
    },
  ]);
  expect(error, `種子訂單插入失敗：${error?.message}`).toBeNull();
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
/* ① 一般店家：「我的訂單」真的查得到（本檔最關鍵的一條）                        */
/* ========================================================================== */
describe('LOCAL_SHOP 的「訂單查詢」查得到 product_orders（#251 parity）', () => {
  beforeEach(async () => {
    await setBusinessType('LOCAL_SHOP');
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
    await bindTo(SHOP_A.customerA1);
    await seedOrders();
  });

  it('顧客打「我的訂單」→ 收到自己的訂單清單（編號、金額、狀態、付款狀態）', async () => {
    const reply = await customerSays('我的訂單');
    expect(reply).toBeTruthy();
    // 沒有落到分支 ⑥——這是「有沒有 handler」與「handler 回了什麼」的分界線
    expect(reply).not.toBe(DEFAULT_REPLY);

    expect(reply).toContain(ORDER_NO.newest);
    expect(reply).toContain(ORDER_NO.middle);
    expect(reply).toContain(ORDER_NO.oldest);
    // 金額走千分位（12345 → 12,345），不是原始數字字串
    expect(reply).toContain('NT$12,345');
    // 訂單狀態與付款狀態都是顧客看得懂的中文，不是 enum 代碼
    expect(reply).toContain('待確認');
    expect(reply).toContain('未付款');
    expect(reply).not.toContain('PENDING');
    expect(reply).not.toContain('UNPAID');
  });

  it('最新的排最前面（created_at desc）', async () => {
    const reply = (await customerSays('我的訂單'))!;
    expect(reply.indexOf(ORDER_NO.newest)).toBeLessThan(reply.indexOf(ORDER_NO.middle));
    expect(reply.indexOf(ORDER_NO.middle)).toBeLessThan(reply.indexOf(ORDER_NO.oldest));
  });

  it('日期是台北牆上時鐘的日期（UTC 17:00 已經是台北的隔天）', async () => {
    // `itest-251-A-0003` 的 created_at 是 2026-03-03T17:00:00Z ＝ 台北 3/4 01:00。
    //
    // ⚠️ 這條案例第一版是錯的，兩層都錯，留下來的教訓比案例本身值錢：
    //   ① 用的時刻是 UTC 02:00。那個時刻在「+8」與「完全不位移」下**都是 3/3**，
    //      只有寫成 -8 才會變 3/2。案例名字宣稱「驗了台北時區」，實際上只驗得出
    //      三種寫法裡的一種——PB-029 的形狀，這次發生在我自己身上。
    //   ② 斷言寫成 `expect(reply).not.toContain('3/2（')`，比對的是**整份清單**，
    //      而清單裡本來就有一筆真的 3/2 訂單（`itest-251-A-0002`）。那條斷言在
    //      功能完全正確時也必定失敗，`local-isolated-a` 照設計把它打回來了。
    //
    // 現在改成：跨日的時刻（+8 → 3/4；不位移 → 3/3；-8 → 3/3，三者分得開），
    // 且只斷言**那一筆訂單自己那一行**，不再拿整份清單當比對對象。
    const reply = (await customerSays('我的訂單'))!;
    const line = reply.split('\n').find((l) => l.includes(ORDER_NO.newest));
    expect(line, `回覆裡找不到 ${ORDER_NO.newest} 那一行`).toBeTruthy();
    expect(line).toContain('3/4（三）');
  });

  it('同店別位顧客的訂單不會出現（customer_id 有真的帶進查詢）', async () => {
    const reply = (await customerSays('我的訂單'))!;
    expect(reply).not.toContain(ORDER_NO.otherCustomer);
  });

  it('別家店的訂單不會出現（tenant_id 有真的帶進查詢）', async () => {
    const reply = (await customerSays('我的訂單'))!;
    expect(reply).not.toContain(ORDER_NO.otherTenant);
  });

  it.each(['查看訂單', '訂單查詢'])('同義詞「%s」走同一條 handler', async (word) => {
    const reply = await customerSays(word);
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain(ORDER_NO.newest);
  });

  it('沒有任何訂單 → 回「沒有訂單紀錄」，不是預設回覆', async () => {
    await deleteTestOrders();
    const reply = await customerSays('我的訂單');
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain('沒有訂單紀錄');
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

/* ========================================================================== */
/* ② 診所同樣適用；嚮導維持誠實的「準備中」                                      */
/* ========================================================================== */
describe('業態分流：CLINIC 走商品訂單，GUIDE 維持準備中', () => {
  beforeEach(async () => {
    await patchLineJsonb({ systemKeywordGroupsDisabled: [] });
    await bindTo(SHOP_A.customerA1);
    await seedOrders();
  });

  it('CLINIC 也查得到 product_orders（這一組不是 LOCAL_SHOP 專屬）', async () => {
    await setBusinessType('CLINIC');
    const reply = await customerSays('我的訂單');
    expect(reply).not.toBe(DEFAULT_REPLY);
    expect(reply).toContain(ORDER_NO.newest);
  });

  it('GUIDE 回「準備中」，且**不得**把商品訂單當成旅遊訂單念出來', async () => {
    await setBusinessType('GUIDE');
    const reply = (await customerSays('我的訂單'))!;
    // 嚮導的「我的訂單」指的是行程訂單（10 分冊 §6.1），tour_orders 至今不存在。
    // 拿 product_orders 湊一份「旅遊訂單」是回答錯的東西，比誠實說準備中更糟。
    expect(reply).toContain('準備中');
    for (const no of Object.values(ORDER_NO)) expect(reply).not.toContain(no);
  });
});
