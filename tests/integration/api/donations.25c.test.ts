/**
 * 平台贊助金流 —— issue #25 C 段。
 * -----------------------------------------------------------------------------
 * 修好前：`/tenant/donate` 整頁是假的（`MOCK_DONORS`／`MOCK_TOTAL_DONATED`／
 * `MOCK_MY_DONATED` 是頁面檔內的硬編碼常數，`submit()` 只是 `setTimeout(420)`
 * 假裝打錢，永遠成功）。`src/app/api` 底下沒有任何 donations 路由，
 * `platform_donations` 表也不存在。
 *
 * 本檔驗的是「真的存得住、真的驗簽、真的不能重複記帳」：
 *   1. POST /api/donations 建單 → 直查 DB 確認是 PENDING、金額/顯示名稱/
 *      donor_user_id 正確落地。
 *   2. GET /api/donations/:id/checkout 組出的 ECPay AIO 表單欄位可以自己驗簽通過
 *      （用 tests/fixtures.ts 的 ITEST_ECPAY_CREDENTIALS，並非真實金流憑證）。
 *   3. 別人的訂單 id 不能拿去 checkout（404，不外流別人是否存在這筆訂單）。
 *   4. 偽造 callback（CheckMacValue 錯誤）：fail closed，DB 一個字不動。
 *   5. 查無此訂單編號的 callback：fail closed，不會無中生有建一筆。
 *   6. 合法 callback：訂單真的變成 PAID，paid_at 落地，provider_trade_no 落地。
 *   7. 同一筆 callback 重放：冪等——回應仍是「1|OK」，但 DB 不會再被寫一次
 *      （updated_at 不變，藉此證明「沒有重覆記帳」而不只是「回應恰好一樣」）。
 *   8. 金額不符的 callback：驗簽通過但金額對不上 → 標記 FAILED，不是 PAID。
 *   9. GET /api/donations/summary：PENDING 不計入累積／感謝名單；PAID 之後
 *      totalDonated／myDonated／donors 都反映出來。
 *
 * 清理紀律：afterAll 用 TAG 前綴的 display_name 找出本檔造的所有列並刪除。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A, SHOP_B, ITEST_ECPAY_CREDENTIALS } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { computeCheckMacValue } from '@/server/ecpay';

const INTEGRATION_BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TAG = 'itest25c-';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
const readJson = async <T = unknown>(res: Response): Promise<Envelope<T>> =>
  (await res.json()) as Envelope<T>;

interface DonationRow {
  id: string;
  donor_user_id: string;
  display_name: string;
  amount: number;
  status: 'PENDING' | 'PAID' | 'FAILED';
  merchant_trade_no: string;
  provider_trade_no: string | null;
  paid_at: string | null;
  updated_at: string;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

async function dbRow(id: string): Promise<DonationRow | null> {
  const { data, error } = await admin.from('platform_donations').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(`直查 platform_donations 失敗：${error.message}`);
  return data as DonationRow | null;
}

async function createOrder(api: AuthedApi, amount: number, displayName: string) {
  const res = await api.post('/api/donations', { amount, displayName });
  const env = await readJson<{ id: string; merchantTradeNo: string; amount: number }>(res);
  if (res.status !== 200 || !env.success || !env.data?.id) {
    throw new Error(`建立贊助訂單失敗（${res.status}）：${JSON.stringify(env)}`);
  }
  return env.data;
}

/** 直接組一份「ECPay callback」的 x-www-form-urlencoded body 並送出。 */
async function postCallback(fields: Record<string, string>) {
  const body = new URLSearchParams(fields).toString();
  const res = await fetch(`${INTEGRATION_BASE_URL}/api/donations/callback`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const text = await res.text();
  return { status: res.status, text };
}

/** 用整合測試假憑證簽出一份合法（除非呼叫端刻意竄改）的 callback 欄位。 */
function signedCallbackFields(input: {
  merchantTradeNo: string;
  amount: number;
  rtnCode?: string;
}): Record<string, string> {
  const base = {
    MerchantID: ITEST_ECPAY_CREDENTIALS.merchantId,
    MerchantTradeNo: input.merchantTradeNo,
    RtnCode: input.rtnCode ?? '1',
    RtnMsg: 'Succeeded',
    TradeNo: `ECPAYTEST${input.merchantTradeNo}`,
    TradeAmt: String(input.amount),
    PaymentDate: '2026/09/15 12:00:00',
    PaymentType: 'Credit_CreditCard',
  };
  const mac = computeCheckMacValue(base, ITEST_ECPAY_CREDENTIALS.hashKey, ITEST_ECPAY_CREDENTIALS.hashIv);
  return { ...base, CheckMacValue: mac };
}

beforeAll(async () => {
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  await admin.from('platform_donations').delete().like('display_name', `${TAG}%`);
});

describe('POST /api/donations', () => {
  it('建立一筆 PENDING 訂單，金額與顯示名稱真的落地', async () => {
    const order = await createOrder(ownerA, 300, `${TAG}建單`);
    const row = await dbRow(order.id);
    expect(row).toBeTruthy();
    expect(row!.status).toBe('PENDING');
    expect(row!.amount).toBe(300);
    expect(row!.display_name).toBe(`${TAG}建單`);
    expect(row!.merchant_trade_no).toBe(order.merchantTradeNo);
  });

  it('金額超出範圍回 400', async () => {
    const res = await ownerA.post('/api/donations', { amount: 5, displayName: `${TAG}太小` });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/donations/:id/checkout', () => {
  it('組出的表單欄位可以用同一組假憑證驗簽通過', async () => {
    const order = await createOrder(ownerA, 500, `${TAG}checkout`);
    const res = await ownerA.get(`/api/donations/${order.id}/checkout`);
    const env = await readJson<{ actionUrl: string; fields: Record<string, string> }>(res);
    expect(res.status, JSON.stringify(env)).toBe(200);
    expect(env.data!.fields.MerchantID).toBe(ITEST_ECPAY_CREDENTIALS.merchantId);
    expect(env.data!.fields.TotalAmount).toBe('500');
    expect(env.data!.fields.ChoosePayment).toBe('Credit');
    const expectedMac = computeCheckMacValue(
      env.data!.fields, ITEST_ECPAY_CREDENTIALS.hashKey, ITEST_ECPAY_CREDENTIALS.hashIv,
    );
    expect(env.data!.fields.CheckMacValue).toBe(expectedMac);
  });

  it('別人的訂單 id 拿去 checkout 回 404', async () => {
    const order = await createOrder(ownerA, 500, `${TAG}別人的單`);
    const res = await ownerB.get(`/api/donations/${order.id}/checkout`);
    expect(res.status).toBe(404);
  });
});

describe('POST /api/donations/callback —— fail closed', () => {
  it('CheckMacValue 錯誤：DB 一個字不動，回應不是 1|OK', async () => {
    const order = await createOrder(ownerA, 200, `${TAG}偽造簽章`);
    const fields = signedCallbackFields({ merchantTradeNo: order.merchantTradeNo, amount: 200 });
    fields.CheckMacValue = 'DELIBERATELY-WRONG-MAC-VALUE';

    const { status, text } = await postCallback(fields);
    expect(status).toBe(200);
    expect(text).not.toBe('1|OK');

    const row = await dbRow(order.id);
    expect(row!.status).toBe('PENDING');
    expect(row!.paid_at).toBeNull();
  });

  it('查無此訂單編號：不會無中生有建一筆，回應不是 1|OK', async () => {
    const fields = signedCallbackFields({ merchantTradeNo: `${TAG}unknown-trade-no`, amount: 100 });
    const { status, text } = await postCallback(fields);
    expect(status).toBe(200);
    expect(text).not.toBe('1|OK');

    const { data, error } = await admin
      .from('platform_donations').select('id').eq('merchant_trade_no', `${TAG}unknown-trade-no`).maybeSingle();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });

  it('簽章正確但金額不符：標記 FAILED，不是 PAID', async () => {
    const order = await createOrder(ownerA, 300, `${TAG}金額不符`);
    const fields = signedCallbackFields({ merchantTradeNo: order.merchantTradeNo, amount: 999 }); // 訂單其實是 300
    const { status, text } = await postCallback(fields);
    expect(status).toBe(200);
    expect(text).not.toBe('1|OK');

    const row = await dbRow(order.id);
    expect(row!.status).toBe('FAILED');
  });
});

describe('POST /api/donations/callback —— 合法付款成功 + 冪等', () => {
  it('order → callback → PAID，重放同一筆 callback 不會重覆記帳', async () => {
    const order = await createOrder(ownerA, 1000, `${TAG}合法付款`);
    const fields = signedCallbackFields({ merchantTradeNo: order.merchantTradeNo, amount: 1000 });

    const first = await postCallback(fields);
    expect(first.status).toBe(200);
    expect(first.text).toBe('1|OK');

    const afterFirst = await dbRow(order.id);
    expect(afterFirst!.status).toBe('PAID');
    expect(afterFirst!.paid_at).not.toBeNull();
    expect(afterFirst!.provider_trade_no).toBe(`ECPAYTEST${order.merchantTradeNo}`);

    // 重放：ECPay 真實環境會重送同一筆通知；這裡刻意送完全相同的 body 兩次。
    const second = await postCallback(fields);
    expect(second.status).toBe(200);
    expect(second.text).toBe('1|OK'); // 從呼叫端角度仍是「成功」，不是錯誤

    const afterSecond = await dbRow(order.id);
    expect(afterSecond!.status).toBe('PAID');
    // 真正證明「沒有重覆記帳」的是這一行：updated_at 完全沒變，代表第二次
    // callback 沒有再次觸發 UPDATE（`.eq('status','PENDING')` 擋住了它）。
    expect(afterSecond!.updated_at).toBe(afterFirst!.updated_at);
  });
});

describe('GET /api/donations/summary', () => {
  it('PENDING 不計入累積／感謝名單；PAID 之後累積、我的贊助、名單都反映', async () => {
    const before = await readJson<{ totalDonated: number; myDonated: number; donors: { id: string }[] }>(
      await ownerA.get('/api/donations/summary'),
    );

    const order = await createOrder(ownerA, 700, `${TAG}summary`);
    const pending = await readJson<{ totalDonated: number; myDonated: number; donors: { id: string }[] }>(
      await ownerA.get('/api/donations/summary'),
    );
    expect(pending.data!.totalDonated).toBe(before.data!.totalDonated);
    expect(pending.data!.myDonated).toBe(before.data!.myDonated);
    expect(pending.data!.donors.some((d) => d.id === order.id)).toBe(false);

    const fields = signedCallbackFields({ merchantTradeNo: order.merchantTradeNo, amount: 700 });
    const { text } = await postCallback(fields);
    expect(text).toBe('1|OK');

    const after = await readJson<{ totalDonated: number; myDonated: number; donors: { id: string }[] }>(
      await ownerA.get('/api/donations/summary'),
    );
    expect(after.data!.totalDonated).toBe(before.data!.totalDonated + 700);
    expect(after.data!.myDonated).toBe(before.data!.myDonated + 700);
    expect(after.data!.donors.some((d) => d.id === order.id)).toBe(true);
  });
});
