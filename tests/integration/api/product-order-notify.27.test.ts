/**
 * 手動建單的「LINE 通知顧客消費明細」勾選框 — issue #27 ③
 * -----------------------------------------------------------------------------
 * 契約出處：docs/integration/04-API-CONTRACTS.md §B-3（`POST /api/product-orders/manual`）、
 * docs/integration/06-LINE-INTEGRATION.md §2（推播額度）。
 * 實作：src/app/api/product-orders/manual/route.ts、src/server/line-notify.ts
 * （notifyProductOrderReceipt）、src/server/email/send.ts、src/server/email/templates.ts。
 *
 * 修好前的病（14 分冊 §7.4）：建單視窗有一個**可勾選**（未 disabled）的勾選框，
 * 標籤寫著「LINE 通知顧客消費明細（未綁 LINE 自動改寄 Email；每則扣 1 推播額度）」，
 * 送出後跳一則把那句標籤**逐字重播**的 toast，讀起來就是「已通知」。但端點只做
 * 扣庫存＋建單＋寫 inventory_logs，一則 LINE 都沒發、一封信都沒寄、額度也沒扣。
 *
 * 本檔把標籤上寫的那套規則逐條驗出來（都打真端點、看真 mock 收到什麼、真查額度）：
 *   1. 勾選 + 顧客已綁 LINE  → mock LINE 收到消費明細、額度 -1、notify='LINE'
 *   2. 勾選 + 顧客未綁 LINE  → mock Resend 收到信、**額度不變**、notify='EMAIL'
 *   3. 不勾選                → 零 LINE、零 Email、額度不變、notify='NONE'
 *   4. 勾選 + 既沒綁 LINE 也沒 Email → 零通知、notify='NO_CONTACT'（不謊稱送出）
 *   5. 勾選 + 推播額度用盡  → 零 push、額度不變、notify='QUOTA_EXCEEDED'，訂單仍建立成功
 *
 * 鏈路：本測試 process 起兩個 mock server —— 假 LINE（port 4123，LINE_API_BASE）
 * 與假 Resend（port 4124，RESEND_BASE_URL）；global-setup 起的 next dev 讀
 * .env.test 打到這裡。⚠️ 通知在端點裡是 **await** 的（要知道走了哪一條路才能
 * 如實顯示），所以回應到手時 mock 已經收完，不需要輪詢。
 *
 * 清理紀律：本檔自建顧客/商品/訂單，afterAll 依 FK 方向刪回去；tenant_settings
 * 的 LINE 憑證欄與 push_quota_usage 當月列都先快照後還原。
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { ResendMockServer } from '../../helpers/resend-mock';
import { encryptSecret } from '@/server/crypto';

const PUSH_PATH = '/v2/bot/message/push';

/** 本檔專用測試憑證與 LINE user id（避免與其他測試檔互踩） */
const CHANNEL_SECRET = 'itest-line-secret-27-order';
const CHANNEL_TOKEN = 'itest-line-token-27-order';
const LINE_USER = 'Upo27itest00000000000000000000001';
const EMAIL_ONLY_ADDRESS = 'po27-email-only@test.local';

const PRODUCT_NAME = '#27③ 測試洗髮精';
const PRODUCT_PRICE = 780;

type NotifyOutcome = 'NONE' | 'LINE' | 'EMAIL' | 'NO_CONTACT' | 'QUOTA_EXCEEDED' | 'FAILED';
type ManualOrderResult = { id: string; orderNo: string; notify: NotifyOutcome };
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const lineMock = new LineMockServer();
const resendMock = new ResendMockServer();

let productId: string;
let customerWithLine: string;
let customerEmailOnly: string;
let customerNoContact: string;
/** 本檔建出來的訂單（afterAll 連同 items 一起刪） */
const createdOrderIds: string[] = [];

let settingsSnapshot: {
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let quotaSnapshot: number | null = null;

async function quotaUsed(): Promise<number> {
  const { data } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used });
  expect(error).toBeNull();
}

/** 庫存補回一個安全值，讓每個案例都從同一個起點出發 */
async function resetStock(stock = 500): Promise<void> {
  const { error } = await admin.from('products').update({ stock }).eq('id', productId);
  expect(error).toBeNull();
}

/** 打真的建單端點（頁面 → services/products.ts createManualProductOrder → 這裡） */
async function createOrder(
  customerId: string, quantity: number, notifyCustomer: boolean,
): Promise<{ status: number; data?: ManualOrderResult }> {
  const res = await ownerA.post('/api/product-orders/manual', {
    customerId, items: [{ productId, quantity }], notifyCustomer,
  });
  const body = await readJson<ManualOrderResult>(res);
  if (body.data?.id) createdOrderIds.push(body.data.id);
  return { status: res.status, data: body.data };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  if (!process.env.LINE_API_BASE) {
    throw new Error(
      '缺少 LINE_API_BASE：本檔需要 .env.test（或 CI env）設 ' +
      'LINE_API_BASE=http://localhost:4123 與 LINE_DATA_API_BASE=http://localhost:4123。',
    );
  }
  if (!process.env.RESEND_BASE_URL || !process.env.RESEND_API_KEY) {
    throw new Error(
      '缺少 RESEND_BASE_URL / RESEND_API_KEY：issue #27 ③ 的 email 分支需要 .env.test' +
      '（或 CI env）設 RESEND_BASE_URL=http://localhost:4124 與一把假的 RESEND_API_KEY，' +
      '否則 src/server/email/send.ts 會在「未設定就略過寄信」的短路上直接回 ' +
      'SKIPPED_NO_KEY，測到的不是 email 分支而是「沒設定 key」那條路。',
    );
  }
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();

  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await lineMock.start();
  await resendMock.start();

  const { data: snap, error: e0 } = await admin.from('tenant_settings')
    .select('line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  const { data: q } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey()).maybeSingle();
  quotaSnapshot = (q as { used: number } | null)?.used ?? null;

  // ---- 本檔自建的商品與三種聯絡方式的顧客 ----
  productId = randomUUID();
  customerWithLine = randomUUID();
  customerEmailOnly = randomUUID();
  customerNoContact = randomUUID();

  const { error: e2 } = await admin.from('products').insert({
    id: productId, tenant_id: SHOP_A.id, name: PRODUCT_NAME,
    price: PRODUCT_PRICE, stock: 500, active: true,
  });
  expect(e2).toBeNull();

  const { error: e3 } = await admin.from('customers').insert([
    { id: customerWithLine, tenant_id: SHOP_A.id, name: '#27③ 已綁 LINE 顧客',
      phone: '0900270031', line_user_id: LINE_USER, email: 'po27-has-line@test.local' },
    { id: customerEmailOnly, tenant_id: SHOP_A.id, name: '#27③ 只有 Email 顧客',
      phone: '0900270032', email: EMAIL_ONLY_ADDRESS },
    // ⚠️ email 必須明寫 ''（customers.email 是 not null default ''）：
    //    supabase 的批次 insert 會把所有列對齊成同一組欄位，這一列省略 email
    //    就會被送成顯式 NULL 而撞 23502，而不是套用 DB 預設值。
    { id: customerNoContact, tenant_id: SHOP_A.id, name: '#27③ 無聯絡管道顧客',
      phone: '0900270033', email: '' },
  ]);
  expect(e3).toBeNull();
});

afterAll(async () => {
  // beforeAll 可能在環境契約或 mock server 啟動前就失敗；teardown 不應用
  // undefined admin 製造第二個錯誤，掩蓋真正的 setup 根因。
  if (!admin) {
    await lineMock.stop();
    await resendMock.stop();
    return;
  }
  for (const id of createdOrderIds) {
    await admin.from('product_order_items').delete().eq('order_id', id);
    await admin.from('product_orders').delete().eq('id', id);
  }
  // inventory_logs 沒有 order_id 欄（0004），只認 product_id；本檔的商品是自建的，
  // 刪它就把本檔寫出來的異動紀錄一併帶走（FK on delete cascade 也會，這裡明寫一次）
  await admin.from('inventory_logs').delete().eq('product_id', productId);
  await admin.from('customers').delete()
    .in('id', [customerWithLine, customerEmailOnly, customerNoContact]);
  await admin.from('products').delete().eq('id', productId);

  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  if (quotaSnapshot === null) {
    await admin.from('push_quota_usage').delete()
      .eq('tenant_id', SHOP_A.id).eq('month', taipeiMonthKey());
  } else {
    await admin.from('push_quota_usage')
      .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used: quotaSnapshot });
  }
  await lineMock.stop();
  await resendMock.stop();
});

beforeEach(async () => {
  lineMock.reset();
  resendMock.reset();
  await setQuotaUsed(0);
  await resetStock();
});

describe('POST /api/product-orders/manual — 消費明細通知（issue #27 ③）', () => {
  it('勾選 + 顧客已綁 LINE → mock LINE 收到消費明細、推播額度 -1、notify=LINE', async () => {
    const { status, data } = await createOrder(customerWithLine, 2, true);
    expect(status).toBe(200);
    expect(data?.notify).toBe('LINE');

    const pushes = lineMock.requestsFor(PUSH_PATH);
    expect(pushes).toHaveLength(1);
    expect(pushes[0].headers.authorization).toBe(`Bearer ${CHANNEL_TOKEN}`);
    expect(pushes[0].body.to).toBe(LINE_USER);

    // 訊息內容＝消費明細：品項、數量、金額、訂單編號（勾選框標籤承諾的四件事）
    const text = String(pushes[0].body.messages[0].text);
    expect(text).toContain(PRODUCT_NAME);
    expect(text).toContain('×2');
    expect(text).toContain((PRODUCT_PRICE * 2).toLocaleString());
    expect(text).toContain(data!.orderNo);

    // LINE 這條路要扣 1 則推播額度
    expect(await quotaUsed()).toBe(1);
    // 走 LINE 就不該同時寄信
    expect(resendMock.emails).toHaveLength(0);
  });

  it('勾選 + 顧客未綁 LINE → 改走 Email（mock Resend 收到）、**不扣**推播額度、notify=EMAIL', async () => {
    const { status, data } = await createOrder(customerEmailOnly, 3, true);
    expect(status).toBe(200);
    expect(data?.notify).toBe('EMAIL');

    // 完全沒打 LINE
    expect(lineMock.requestsFor(PUSH_PATH)).toHaveLength(0);

    const emails = resendMock.emails;
    expect(emails).toHaveLength(1);
    expect(emails[0].body.to).toBe(EMAIL_ONLY_ADDRESS);
    expect(String(emails[0].body.subject)).toContain(data!.orderNo);
    const html = String(emails[0].body.html);
    expect(html).toContain(PRODUCT_NAME);
    expect(html).toContain(data!.orderNo);
    expect(html).toContain((PRODUCT_PRICE * 3).toLocaleString());

    // ⚠️ 標籤明寫「每則 LINE 扣 1 推播額度」——email 這條路不扣
    expect(await quotaUsed()).toBe(0);
  });

  it('不勾選 → 零 LINE、零 Email、額度不變、notify=NONE', async () => {
    const { status, data } = await createOrder(customerWithLine, 1, false);
    expect(status).toBe(200);
    expect(data?.notify).toBe('NONE');

    expect(lineMock.requestsFor(PUSH_PATH)).toHaveLength(0);
    expect(resendMock.emails).toHaveLength(0);
    expect(await quotaUsed()).toBe(0);
  });

  it('勾選 + 既沒綁 LINE 也沒 Email → notify=NO_CONTACT，零通知（不謊稱送出）', async () => {
    const { status, data } = await createOrder(customerNoContact, 1, true);
    expect(status).toBe(200);
    expect(data?.notify).toBe('NO_CONTACT');

    expect(lineMock.requestsFor(PUSH_PATH)).toHaveLength(0);
    expect(resendMock.emails).toHaveLength(0);
    expect(await quotaUsed()).toBe(0);
  });

  it('勾選 + 推播額度用盡 → 零 push、額度不變、notify=QUOTA_EXCEEDED，但訂單仍建立成功', async () => {
    // SHOP_A 種子含 EXTRA_PUSH → 上限 700（09 分冊 §5）；填滿它
    await setQuotaUsed(700);

    const { status, data } = await createOrder(customerWithLine, 1, true);
    expect(status).toBe(200);                       // 通知送不出去不能讓建單失敗
    expect(data?.notify).toBe('QUOTA_EXCEEDED');
    expect(data?.orderNo).toBeTruthy();

    expect(lineMock.requestsFor(PUSH_PATH)).toHaveLength(0);
    expect(await quotaUsed()).toBe(700);            // 沒送出就不該扣

    // 訂單真的在 DB 裡（通知失敗 ≠ 建單失敗）
    const { data: row } = await admin.from('product_orders')
      .select('id, order_no').eq('id', data!.id).maybeSingle();
    expect(row?.order_no).toBe(data!.orderNo);
  });

  it('寄信失敗（Resend 回 500）→ notify=FAILED，不得報成 EMAIL', async () => {
    resendMock.failNext(500);

    const { status, data } = await createOrder(customerEmailOnly, 1, true);
    expect(status).toBe(200);
    expect(data?.notify).toBe('FAILED');            // 信沒出去就不是 'EMAIL'
    expect(await quotaUsed()).toBe(0);
  });
});
