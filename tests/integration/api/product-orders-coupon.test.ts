/**
 * POST /api/product-orders/:id/apply-coupon 整合測試 —— issue #33 第 ① 筆。
 *
 * 修復前：前端假裝套用票券（固定顯示折抵 NT$100），票券代碼從沒送到後端，
 * 票券也從沒被核銷（可以無限次重複使用）。本檔驗證：
 *   - 合法票券：core 核銷寫入 coupon_instances.redeemed_at，回傳的
 *     couponDiscount／totalAmount 與 DB 實際折抵後的 total_amount 一致
 *     （用 service-role 獨立查一次，不信任 API 回應自己）。
 *   - 找不到票券 → 404 REQ_002，訂單金額不變。
 *   - 已核銷的票券 → 409 REQ_003，訂單金額不變，coupon_instances 不變。
 *   - 票券不屬於該訂單顧客 → 409 REQ_003，訂單金額不變。
 *   - 跨租戶：A 店的訂單不能拿 B 店的票券核銷（B 店 code 對 A 店的
 *     tenant_id 查不到 → 404，等同「找不到此票券」，不會洩漏 B 店資料）。
 *
 * 與 tests/integration/api/coupons-points.b4.test.ts 共用 insertCoupon 之類
 * 的建構手法；與 tests/integration/api/products-orders.b3.test.ts 共用
 * insertProduct / createManualOrder 之類的建構手法，但本檔不 import 那兩份
 * 檔案（各檔案獨立、可平行跑），本檔自己各刻一份精簡版。
 *
 * 清理紀律：coupons/coupon_instances/products/product_orders/customers 全部
 * 自建，try/finally 內以 service role 刪除（依 FK 方向：
 * product_order_items → product_orders → products；coupon_instances 隨
 * coupons cascade，仍逐一明確清）。
 *
 * ⚠️ 依 Terra 任務指示：本檔只寫測試，不執行（TEST Supabase 序列化中，
 * PR #205 持有中）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

async function insertCustomer(tenantId: string, name: string): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('customers')
    .insert({ id, tenant_id: tenantId, name: `${name}-${uniqueSuffix()}`, phone: '' });
  expect(error).toBeNull();
  return id;
}

/**
 * canonical TEST 的 products 有唯一索引 `products_tenant_sort_order_uq`
 * (tenant_id, sort_order)，而 sort_order 的 column default 是 0——所以同一個
 * 租戶插入第二筆不帶 sort_order 的商品就會撞 23505。
 *
 * ⚠️ 這個索引**不在 repo 的 migration 帳本裡**（`grep products_tenant_sort_order_uq
 * supabase/migrations/` 無輸出），也**不在正式庫**——三方分歧，已另立 issue 追。
 * 這裡先取「該租戶目前最大值 +1」，讓本檔在有無該索引的資料庫上都成立，
 * 而不是把數字寫死或賭隨機不撞。
 */
async function nextSortOrder(tenantId: string): Promise<number> {
  const { data } = await admin.from('products')
    .select('sort_order').eq('tenant_id', tenantId)
    .order('sort_order', { ascending: false }).limit(1).maybeSingle();
  return Number(data?.sort_order ?? 0) + 1;
}

async function insertProduct(tenantId: string, price: number): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('products').insert({
    id, tenant_id: tenantId, name: `票券測試商品-${uniqueSuffix()}`,
    price, stock: 100, safety_stock: 0, sort_order: await nextSortOrder(tenantId),
  });
  expect(error).toBeNull();
  return id;
}

async function insertOrder(
  tenantId: string, customerId: string, productId: string, totalAmount: number,
): Promise<string> {
  const id = randomUUID();
  const { error: oErr } = await admin.from('product_orders').insert({
    id, tenant_id: tenantId, order_no: `PO-COUPON-${uniqueSuffix()}`,
    customer_id: customerId, total_amount: totalAmount, status: 'PENDING', payment_status: 'UNPAID',
  });
  expect(oErr).toBeNull();
  const { error: iErr } = await admin.from('product_order_items').insert({
    id: randomUUID(), order_id: id, tenant_id: tenantId, product_id: productId,
    product_name: '票券測試商品', quantity: 1, price: totalAmount,
  });
  expect(iErr).toBeNull();
  return id;
}

async function insertCoupon(
  tenantId: string, discountType: 'AMOUNT' | 'PERCENT' | 'GIFT', discountValue: number,
  period?: { start_at?: string; end_at?: string },
): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('coupons').insert({
    id, tenant_id: tenantId, name: `票券測試票券-${uniqueSuffix()}`,
    discount_type: discountType, discount_value: discountValue, total_quantity: 0, status: 'PUBLISHED',
    ...(period ?? {}),
  });
  expect(error).toBeNull();
  return id;
}

/** 發一張票券給指定顧客，回傳核銷用的 code。 */
async function issueCouponInstance(
  tenantId: string, couponId: string, customerId: string, redeemedAt: string | null = null,
): Promise<{ instanceId: string; code: string }> {
  const instanceId = randomUUID();
  const code = uniqueSuffix().toUpperCase().slice(0, 8).padEnd(8, 'X');
  const { error } = await admin.from('coupon_instances').insert({
    id: instanceId, tenant_id: tenantId, coupon_id: couponId, customer_id: customerId,
    code, redeemed_at: redeemedAt,
  });
  expect(error).toBeNull();
  return { instanceId, code };
}

async function orderTotalAmount(orderId: string): Promise<number> {
  const { data, error } = await admin.from('product_orders')
    .select('total_amount').eq('id', orderId).single();
  expect(error).toBeNull();
  return Number((data as any).total_amount);
}

async function instanceRedeemedAt(instanceId: string): Promise<string | null> {
  const { data, error } = await admin.from('coupon_instances')
    .select('redeemed_at').eq('id', instanceId).single();
  expect(error).toBeNull();
  return (data as any).redeemed_at as string | null;
}

async function cleanupOrder(orderId: string): Promise<void> {
  await admin.from('product_order_items').delete().eq('order_id', orderId);
  await admin.from('product_orders').delete().eq('id', orderId);
}

async function cleanupCoupon(couponId: string): Promise<void> {
  await admin.from('coupon_instances').delete().eq('coupon_id', couponId);
  await admin.from('coupons').delete().eq('id', couponId);
}

describe('POST /api/product-orders/:id/apply-coupon（issue #33①：真核銷，不再假造折抵）', () => {
  it('合法票券（AMOUNT 100）：DB total_amount 真的少 100，coupon_instances 真的核銷', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客A');
    const productId = await insertProduct(SHOP_A.id, 500);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 500);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 100);
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(200);
      const body = await readJson<{ totalAmount: number; couponDiscount: number }>(res);
      expect(body.success).toBe(true);
      expect(body.data!.couponDiscount).toBe(100);
      expect(body.data!.totalAmount).toBe(400);

      // 回應數字不能只是「API 自己說的」——用 service role 獨立查一次 DB 真實狀態
      expect(await orderTotalAmount(orderId)).toBe(400);
      expect(await instanceRedeemedAt(instanceId)).not.toBeNull();

      // 已核銷的票券不能再用第二次
      const second = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(second.status).toBe(409);
      expect((await readJson(second)).code).toBe('REQ_003');
      expect(await orderTotalAmount(orderId)).toBe(400); // 沒有被二次折抵
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('票券代碼不存在 → 404 REQ_002，訂單金額不變', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客B');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 300);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: 'NOSUCHCODE' });
      expect(res.status).toBe(404);
      expect((await readJson(res)).code).toBe('REQ_002');
      expect(await orderTotalAmount(orderId)).toBe(300);
    } finally {
      await cleanupOrder(orderId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  /**
   * issue #33 第 ① 筆的驗收格明文要求「不存在／已核銷／**已過期** 三種」。
   * 這一種原本沒有測試——回去看實作才發現 coupons.start_at / end_at 從
   * 0004 migration 就存在，但整條核銷路徑從來沒有檢查過：過期票券照樣核銷
   * 得掉、金額照樣折。這兩個案例是那個缺陷的守門。
   */
  it('票券已過期 → 409 REQ_003，訂單金額不變且票券未被核銷', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客E');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 300);
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 50, { end_at: yesterday });
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(409);
      expect((await readJson(res)).code).toBe('REQ_003');
      // 三重斷言：錯誤碼、訂單金額不變、票券**沒有**被標成已核銷
      expect(await orderTotalAmount(orderId)).toBe(300);
      expect(await instanceRedeemedAt(instanceId)).toBeNull();
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('票券尚未開始 → 409 REQ_003，訂單金額不變且票券未被核銷', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客F');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 300);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 50, { start_at: tomorrow });
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(409);
      expect((await readJson(res)).code).toBe('REQ_003');
      expect(await orderTotalAmount(orderId)).toBe(300);
      expect(await instanceRedeemedAt(instanceId)).toBeNull();
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('活動期間內的票券 → 正常核銷（證明有效期檢查沒有把好的擋掉）', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客G');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 300);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 50, {
      start_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      end_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(200);
      expect(await orderTotalAmount(orderId)).toBe(250);
      expect(await instanceRedeemedAt(instanceId)).not.toBeNull();
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('票券已核銷過 → 409 REQ_003，訂單金額不變', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客C');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 300);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 50);
    const { code } = await issueCouponInstance(
      SHOP_A.id, couponId, customerId, new Date().toISOString());
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(409);
      expect((await readJson(res)).code).toBe('REQ_003');
      expect(await orderTotalAmount(orderId)).toBe(300);
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('票券發給的是別的顧客 → 409 REQ_003，訂單金額不變', async () => {
    const orderCustomerId = await insertCustomer(SHOP_A.id, '訂單顧客');
    const couponCustomerId = await insertCustomer(SHOP_A.id, '票券持有人');
    const productId = await insertProduct(SHOP_A.id, 300);
    const orderId = await insertOrder(SHOP_A.id, orderCustomerId, productId, 300);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 50);
    const { code } = await issueCouponInstance(SHOP_A.id, couponId, couponCustomerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(409);
      expect((await readJson(res)).code).toBe('REQ_003');
      expect(await orderTotalAmount(orderId)).toBe(300);
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', orderCustomerId);
      await admin.from('customers').delete().eq('id', couponCustomerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('跨租戶：A 店訂單不能用 B 店的票券代碼核銷（404，不洩漏 B 店資料）', async () => {
    const customerA = await insertCustomer(SHOP_A.id, 'A店顧客');
    const productA = await insertProduct(SHOP_A.id, 300);
    const orderA = await insertOrder(SHOP_A.id, customerA, productA, 300);

    const customerB = await insertCustomer(SHOP_B.id, 'B店顧客');
    const couponB = await insertCoupon(SHOP_B.id, 'AMOUNT', 50);
    const { code: codeB } = await issueCouponInstance(SHOP_B.id, couponB, customerB);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderA}/apply-coupon`, { code: codeB });
      expect(res.status).toBe(404);
      expect((await readJson(res)).code).toBe('REQ_002');
      expect(await orderTotalAmount(orderA)).toBe(300);

      // B 店自己的訂單不能被 A 店操作到（B 店 owner 拿 A 店訂單 id → 404）
      const crossRes = await ownerB.post(`/api/product-orders/${orderA}/apply-coupon`, { code: codeB });
      expect(crossRes.status).toBe(404);
      expect((await readJson(crossRes)).code).toBe('REQ_002');
    } finally {
      await cleanupOrder(orderA);
      await cleanupCoupon(couponB);
      await admin.from('customers').delete().eq('id', customerA);
      await admin.from('customers').delete().eq('id', customerB);
      await admin.from('products').delete().eq('id', productA);
    }
  });

  it('PERCENT 型票券：折扣照 discount_value% 取整計算', async () => {
    const customerId = await insertCustomer(SHOP_A.id, '票券顧客D');
    const productId = await insertProduct(SHOP_A.id, 333);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 333);
    const couponId = await insertCoupon(SHOP_A.id, 'PERCENT', 10); // 九折
    const { code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);
    try {
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(res.status).toBe(200);
      const body = await readJson<{ totalAmount: number; couponDiscount: number }>(res);
      // Math.round(333 * 0.9) = 300
      expect(body.data!.totalAmount).toBe(300);
      expect(body.data!.couponDiscount).toBe(33);
      expect(await orderTotalAmount(orderId)).toBe(300);
    } finally {
      await cleanupOrder(orderId);
      await cleanupCoupon(couponId);
      await admin.from('customers').delete().eq('id', customerId);
      await admin.from('products').delete().eq('id', productId);
    }
  });
});

/**
 * issue #33 ①-6：「套用票券成功但『完成訂單』失敗」的交易語意。
 *
 * apply-coupon 與 complete 是**兩個獨立的請求**，不是一個交易。原站
 * docs/specs/product-orders.json 的 jsStrings 同時有：
 *   「票券已套用！折抵 ${formatMoney(couponRes.data?.couponDiscount || 0)}」
 *   「票券已套用，但「完成訂單」失敗：」
 * 後者的存在本身就證明原站允許「票券已套用」與「訂單未完成」並存，且分別告知。
 * 契約寫在 docs/integration/04-API-CONTRACTS.md B-3。
 *
 * 這一組驗的是**不回滾**：核銷是對顧客手上那張券的狀態變更，店員當下已經看到
 * 「票券已套用」的提示；自動退回會讓畫面說過的話與資料庫不一致，而店員無從得知。
 */
describe('issue #33 ①-6：套用票券成功但完成訂單失敗（兩個請求，不是一個交易）', () => {
  it('套用後訂單被取消 → complete 回 409，但票券維持已核銷、金額維持已折抵，兩者都不回滾', async () => {
    const customerId = await insertCustomer(SHOP_A.id, `#33①-6顧客-${uniqueSuffix()}`);
    const productId = await insertProduct(SHOP_A.id, 1000);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 1000);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 300);
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);

    try {
      // 1) 套用票券 —— 成功
      const applyRes = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code });
      expect(applyRes.status).toBe(200);
      const applied = await readJson<{ totalAmount: number; couponDiscount: number }>(applyRes);
      expect(applied.success).toBe(true);
      expect(applied.data?.couponDiscount).toBe(300);
      expect(applied.data?.totalAmount).toBe(700);

      // 2) 模擬真實併發：在店員按「完成」之前，這筆訂單已被取消
      //    （complete 端點只接受 PENDING/CONFIRMED，見 route 的 .in(...)）
      const { error: cancelErr } = await admin.from('product_orders')
        .update({ status: 'CANCELLED' }).eq('id', orderId);
      expect(cancelErr).toBeNull();

      // 3) 完成訂單 —— 失敗
      const completeRes = await ownerA.post(`/api/product-orders/${orderId}/complete`, {});
      expect(completeRes.status).toBe(409);
      const completed = await readJson(completeRes);
      expect(completed.success).toBe(false);
      expect(completed.code).toBe('REQ_003');

      // 4) 以 service role 獨立查一次，不信任任何 API 回應：
      //    票券仍是已核銷（不回滾）
      const { data: inst } = await admin.from('coupon_instances')
        .select('redeemed_at').eq('id', instanceId).maybeSingle();
      expect(inst?.redeemed_at).not.toBeNull();

      //    訂單金額仍是折抵後的 700、折抵明細仍在、仍指向那張票券（不回滾）
      const { data: order } = await admin.from('product_orders')
        .select('total_amount, coupon_discount, coupon_instance_id, status')
        .eq('id', orderId).maybeSingle();
      expect(Number(order?.total_amount)).toBe(700);
      expect(Number(order?.coupon_discount)).toBe(300);
      expect(order?.coupon_instance_id).toBe(instanceId);

      //    而訂單確實沒有被完成
      expect(order?.status).toBe('CANCELLED');
    } finally {
      await admin.from('product_order_items').delete().eq('order_id', orderId);
      await admin.from('product_orders').delete().eq('id', orderId);
      await admin.from('products').delete().eq('id', productId);
      await admin.from('coupon_instances').delete().eq('id', instanceId);
      await admin.from('coupons').delete().eq('id', couponId);
      await admin.from('customers').delete().eq('id', customerId);
    }
  });

  it('那張票券已被消耗：同一組代碼不能再套用到另一筆訂單（證明不回滾不是「看起來沒退」）', async () => {
    const customerId = await insertCustomer(SHOP_A.id, `#33①-6顧客B-${uniqueSuffix()}`);
    const productId = await insertProduct(SHOP_A.id, 1000);
    const orderId = await insertOrder(SHOP_A.id, customerId, productId, 1000);
    const secondOrderId = await insertOrder(SHOP_A.id, customerId, productId, 1000);
    const couponId = await insertCoupon(SHOP_A.id, 'AMOUNT', 300);
    const { instanceId, code } = await issueCouponInstance(SHOP_A.id, couponId, customerId);

    try {
      expect((await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code })).status).toBe(200);
      await admin.from('product_orders').update({ status: 'CANCELLED' }).eq('id', orderId);
      expect((await ownerA.post(`/api/product-orders/${orderId}/complete`, {})).status).toBe(409);

      // 若失敗路徑偷偷把核銷退回去，這裡就會變成 200 —— 那才是真正危險的假成功
      // （店員以為券沒用掉，實際上第一筆訂單的金額已經折抵過了）。
      const reuse = await ownerA.post(`/api/product-orders/${secondOrderId}/apply-coupon`, { code });
      expect(reuse.status).toBe(409);
      expect((await readJson(reuse)).code).toBe('REQ_003');

      // 第二筆訂單金額完全沒被動到
      const { data: second } = await admin.from('product_orders')
        .select('total_amount, coupon_discount').eq('id', secondOrderId).maybeSingle();
      expect(Number(second?.total_amount)).toBe(1000);
      expect(Number(second?.coupon_discount ?? 0)).toBe(0);
    } finally {
      await admin.from('product_order_items').delete().in('order_id', [orderId, secondOrderId]);
      await admin.from('product_orders').delete().in('id', [orderId, secondOrderId]);
      await admin.from('products').delete().eq('id', productId);
      await admin.from('coupon_instances').delete().eq('id', instanceId);
      await admin.from('coupons').delete().eq('id', couponId);
      await admin.from('customers').delete().eq('id', customerId);
    }
  });
});
