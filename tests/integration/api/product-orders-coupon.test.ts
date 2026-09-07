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

async function insertProduct(tenantId: string, price: number): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('products').insert({
    id, tenant_id: tenantId, name: `票券測試商品-${uniqueSuffix()}`,
    price, stock: 100, safety_stock: 0,
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
): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('coupons').insert({
    id, tenant_id: tenantId, name: `票券測試票券-${uniqueSuffix()}`,
    discount_type: discountType, discount_value: discountValue, total_quantity: 0, status: 'PUBLISHED',
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
