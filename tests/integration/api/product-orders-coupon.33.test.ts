/**
 * 商品訂單套用票券 — GitHub issue #33 第 ① 筆。
 * `POST /api/product-orders/:id/apply-coupon`（04 分冊 §B-4）。
 *
 * 修改前：`/tenant/product-orders` 的「套用票券並完成」把折抵金額寫死成 100
 * （`const discount = withCoupon ? 100 : 0`），票券代碼從未離開瀏覽器。
 * `d7b8158` 先把那個捏造的數字誠實化掉，本輪補上真正的端點。
 *
 * 本檔驗證：
 *   ① 套用有效票券 → 回應的 couponDiscount 與 DB 的 coupon_discount /
 *      total_amount / coupon_instances.redeemed_at 一致（全部直查斷言，
 *      不拿端點自己的回應當期望值）
 *   ② 票券不存在 / 已核銷 / 已過期 / 不是這位顧客的 → 對應錯誤碼，
 *      且**訂單金額前後不變**（直查 DB 前後值）
 *   ③ RLS：A 店的訂單不能用 B 店的票券
 *   ④ 「套用票券成功但完成訂單失敗」：兩段是獨立請求，第一段的核銷**留著**
 *      （原站 jsStrings[77]「票券已套用，但「完成訂單」失敗：」的語意）
 *   ⑤ PERCENT 折扣走同一套計算；GIFT 只核銷不影響金額
 *   ⑥ 已完成／已取消的訂單不再接受套券（409）
 *
 * 清理紀律：seed 沒有任何 products / product_orders / coupons，本檔資料全部
 * 自建，afterAll 依 FK 方向清：product_orders（items cascade）→ products →
 * coupon_instances → coupons → customers。顧客不用 seed 的 customerA1/A2/A3
 * （reports.a5 手算期望值依賴它們），一律自建。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

let customerId: string;   // A 店的訂單顧客
let otherCustomerId: string; // A 店的另一位顧客（驗「票券不屬於這位顧客」）
let productId: string;
const createdOrderIds: string[] = [];
const createdCouponIds: string[] = [];

function code(prefix: string): string {
  return `${prefix}${Math.random().toString(36).slice(2, 8)}`.toUpperCase();
}

/** 直接以 service role 建一張訂單（不走 manual 端點：本檔要的是固定金額） */
async function makeOrder(total: number, status = 'PENDING', customer = customerId): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('product_orders').insert({
    id, tenant_id: SHOP_A.id, order_no: `PO33${Date.now().toString(36).slice(-6).toUpperCase()}${createdOrderIds.length}`,
    customer_id: customer, total_amount: total, status, payment_status: 'UNPAID',
  });
  expect(error).toBeNull();
  createdOrderIds.push(id);
  return id;
}

/**
 * 建一張票券 + 一張發給指定顧客的實體，回核銷代碼。
 * `endAt` 給定時寫進 coupons.end_at（過期測試用）。
 */
async function issueCoupon(opts: {
  tenantId?: string;
  customerId?: string;
  discountType: 'AMOUNT' | 'PERCENT' | 'GIFT';
  discountValue: number;
  endAt?: string;
  redeemed?: boolean;
}): Promise<string> {
  const couponId = randomUUID();
  const tenantId = opts.tenantId ?? SHOP_A.id;
  expect((await admin.from('coupons').insert({
    id: couponId, tenant_id: tenantId, name: '#33 商品訂單票券',
    discount_type: opts.discountType, discount_value: opts.discountValue,
    total_quantity: 0, status: 'PUBLISHED',
    ...(opts.endAt ? { end_at: opts.endAt } : {}),
  })).error).toBeNull();
  createdCouponIds.push(couponId);

  const c = code('T33');
  expect((await admin.from('coupon_instances').insert({
    id: randomUUID(), tenant_id: tenantId, coupon_id: couponId,
    customer_id: opts.customerId ?? customerId, code: c,
    ...(opts.redeemed ? { redeemed_at: new Date().toISOString() } : {}),
  })).error).toBeNull();
  return c;
}

async function orderRow(id: string) {
  const { data } = await admin.from('product_orders')
    .select('total_amount, coupon_discount, coupon_instance_id, status').eq('id', id).single();
  return data as unknown as {
    total_amount: string | number; coupon_discount: string | number | null;
    coupon_instance_id: string | null; status: string;
  };
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  customerId = randomUUID();
  otherCustomerId = randomUUID();
  expect((await admin.from('customers').insert([
    { id: customerId, tenant_id: SHOP_A.id, name: '#33 票券訂單顧客', phone: '' },
    { id: otherCustomerId, tenant_id: SHOP_A.id, name: '#33 另一位顧客', phone: '' },
  ])).error).toBeNull();

  productId = randomUUID();
  expect((await admin.from('products').insert({
    id: productId, tenant_id: SHOP_A.id, name: '#33 票券測試商品',
    price: 1000, stock: 100, safety_stock: 0,
  })).error).toBeNull();
});

afterAll(async () => {
  if (createdOrderIds.length) await admin.from('product_orders').delete().in('id', createdOrderIds);
  if (productId) await admin.from('products').delete().eq('id', productId);
  for (const id of createdCouponIds) {
    await admin.from('coupon_instances').delete().eq('coupon_id', id);
    await admin.from('coupons').delete().eq('id', id);
  }
  for (const id of [customerId, otherCustomerId]) {
    if (id) await admin.from('customers').delete().eq('id', id);
  }
});

describe('POST /api/product-orders/:id/apply-coupon：有效票券（issue #33 ①）', () => {
  it('AMOUNT 100：回應 couponDiscount=100，DB 的 total_amount / coupon_discount / redeemed_at 三者一致', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100 });

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(200);
    const body = await readJson<{ totalAmount: number; couponDiscount: number }>(res);
    expect(body.success).toBe(true);
    expect(body.data!.couponDiscount).toBe(100);
    expect(body.data!.totalAmount).toBe(900);

    // 直查 DB：不拿端點自己的回應當期望值
    const row = await orderRow(orderId);
    expect(Number(row.total_amount)).toBe(900);
    expect(Number(row.coupon_discount)).toBe(100);
    expect(row.coupon_instance_id).not.toBeNull();

    const { data: inst } = await admin.from('coupon_instances')
      .select('redeemed_at').eq('code', c).single();
    expect((inst as any).redeemed_at).not.toBeNull();

    // 列表端點也看得到（mapper 有帶 couponDiscount）。
    // ⚠️ GET /api/product-orders 是**全量不分頁**，data 直接是陣列，
    // 不是 Spring 風格的 { content, totalElements, … }（見該 route 檔頭）。
    const list = await ownerA.get('/api/product-orders');
    const rows = (await readJson<Array<{ id: string; couponDiscount: number | null; totalAmount: number }>>(list)).data!;
    const found = rows.find((o) => o.id === orderId);
    expect(found).toBeTruthy();
    expect(found!.couponDiscount).toBe(100);
    expect(Number(found!.totalAmount)).toBe(900);
  });

  it('PERCENT 10：折抵金額由後端依「目前應付金額」算（1000 → 900，折抵 100）', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'PERCENT', discountValue: 10 });

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(200);
    expect((await readJson<{ couponDiscount: number }>(res)).data!.couponDiscount).toBe(100);
    expect(Number((await orderRow(orderId)).total_amount)).toBe(900);
  });

  it('GIFT：只核銷不影響金額（couponDiscount = 0，total_amount 不動）', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'GIFT', discountValue: 0 });

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(200);
    expect((await readJson<{ couponDiscount: number }>(res)).data!.couponDiscount).toBe(0);
    expect(Number((await orderRow(orderId)).total_amount)).toBe(1000);

    const { data: inst } = await admin.from('coupon_instances')
      .select('redeemed_at').eq('code', c).single();
    expect((inst as any).redeemed_at).not.toBeNull();
  });

  it('同一張訂單套第二張票券 → coupon_discount 累加、total_amount 再扣', async () => {
    const orderId = await makeOrder(1000);
    const c1 = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100 });
    const c2 = await issueCoupon({ discountType: 'AMOUNT', discountValue: 250 });

    expect((await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c1 })).status).toBe(200);
    expect((await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c2 })).status).toBe(200);

    const row = await orderRow(orderId);
    expect(Number(row.coupon_discount)).toBe(350);
    expect(Number(row.total_amount)).toBe(650);
  });
});

describe('POST /api/product-orders/:id/apply-coupon：四種拒絕情況，訂單金額一律不變', () => {
  it('票券不存在 → 404 REQ_002，訂單金額前後相同', async () => {
    const orderId = await makeOrder(1000);
    const before = await orderRow(orderId);

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: 'NOSUCHCODE' });
    expect(res.status).toBe(404);
    expect((await readJson(res)).code).toBe('REQ_002');

    const after = await orderRow(orderId);
    expect(Number(after.total_amount)).toBe(Number(before.total_amount));
    expect(after.coupon_discount).toBeNull();
  });

  it('票券已核銷 → 409 REQ_003，訂單金額前後相同', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100, redeemed: true });
    const before = await orderRow(orderId);

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('REQ_003');

    const after = await orderRow(orderId);
    expect(Number(after.total_amount)).toBe(Number(before.total_amount));
    expect(after.coupon_discount).toBeNull();
  });

  it('票券已過期（coupons.end_at 在過去）→ 409 REQ_003，訂單金額不變且票券**沒有被核銷**', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({
      discountType: 'AMOUNT', discountValue: 100,
      endAt: new Date(Date.now() - 86_400_000).toISOString(),
    });
    const before = await orderRow(orderId);

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('REQ_003');

    const after = await orderRow(orderId);
    expect(Number(after.total_amount)).toBe(Number(before.total_amount));
    expect(after.coupon_discount).toBeNull();
    // 被擋下的票券不該被核銷掉（否則店家的票券憑空消失）
    const { data: inst } = await admin.from('coupon_instances')
      .select('redeemed_at').eq('code', c).single();
    expect((inst as any).redeemed_at).toBeNull();
  });

  it('票券不屬於這張訂單的顧客 → 409 REQ_003，訂單金額不變且票券沒有被核銷', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({
      discountType: 'AMOUNT', discountValue: 100, customerId: otherCustomerId,
    });
    const before = await orderRow(orderId);

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('REQ_003');

    const after = await orderRow(orderId);
    expect(Number(after.total_amount)).toBe(Number(before.total_amount));
    const { data: inst } = await admin.from('coupon_instances')
      .select('redeemed_at').eq('code', c).single();
    expect((inst as any).redeemed_at).toBeNull();
  });

  it('已完成的訂單不再接受套券 → 409 REQ_003（套券入口只出現在還沒完成的單）', async () => {
    const orderId = await makeOrder(1000, 'COMPLETED');
    const c = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100 });

    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(409);
    expect((await readJson(res)).code).toBe('REQ_003');
    expect(Number((await orderRow(orderId)).total_amount)).toBe(1000);
  });
});

describe('POST /api/product-orders/:id/apply-coupon：租戶隔離與兩段語意', () => {
  it('RLS：A 店的訂單不能用 B 店的票券（回 404，B 店的票券不會被核銷）', async () => {
    const orderId = await makeOrder(1000);
    // B 店的票券必須發給 B 店的顧客（coupon_instances.customer_id FK）
    const bCustomer = randomUUID();
    expect((await admin.from('customers').insert({
      id: bCustomer, tenant_id: SHOP_B.id, name: '#33 B 店顧客', phone: '',
    })).error).toBeNull();
    try {
      const c = await issueCoupon({
        tenantId: SHOP_B.id, customerId: bCustomer,
        discountType: 'AMOUNT', discountValue: 100,
      });
      const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
      expect(res.status).toBe(404);
      expect((await readJson(res)).code).toBe('REQ_002');

      expect(Number((await orderRow(orderId)).total_amount)).toBe(1000);
      const { data: inst } = await admin.from('coupon_instances')
        .select('redeemed_at').eq('code', c).single();
      expect((inst as any).redeemed_at).toBeNull();
    } finally {
      await admin.from('customers').delete().eq('id', bCustomer);
    }
  });

  it('A 店的訂單，B 店的 owner 打不到（回 404，金額不變）', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100 });
    const ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);

    const res = await ownerB.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c });
    expect(res.status).toBe(404);
    expect(Number((await orderRow(orderId)).total_amount)).toBe(1000);
  });

  it('兩段語意：套券成功之後「完成訂單」失敗，核銷仍然留著（原站 jsStrings[77]）', async () => {
    const orderId = await makeOrder(1000);
    const c = await issueCoupon({ discountType: 'AMOUNT', discountValue: 100 });

    // 第一段：套券成功
    expect((await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: c })).status).toBe(200);

    // 第二段：讓 complete 失敗——先把訂單改成 CANCELLED（complete 只收
    // PENDING/CONFIRMED），模擬「別人先動了這張單」。
    expect((await admin.from('product_orders')
      .update({ status: 'CANCELLED' }).eq('id', orderId)).error).toBeNull();
    const done = await ownerA.post(`/api/product-orders/${orderId}/complete`);
    expect(done.status).toBe(409);

    // 第一段的效果**沒有被回滾**：票券仍是已核銷、折抵仍記在訂單上。
    // 這正是原站那句「票券已套用，但「完成訂單」失敗：」存在的理由。
    const { data: inst } = await admin.from('coupon_instances')
      .select('redeemed_at').eq('code', c).single();
    expect((inst as any).redeemed_at).not.toBeNull();
    const row = await orderRow(orderId);
    expect(Number(row.coupon_discount)).toBe(100);
    expect(Number(row.total_amount)).toBe(900);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const orderId = await makeOrder(1000);
    const base = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
    const res = await fetch(`${base}/api/product-orders/${orderId}/apply-coupon`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: 'WHATEVER' }),
    });
    expect(res.status).toBe(401);
    expect(((await res.json()) as Envelope).code).toBe('AUTH_001');
  });

  it('code 空字串 → 400 REQ_001（zod 擋在查票券之前）', async () => {
    const orderId = await makeOrder(1000);
    const res = await ownerA.post(`/api/product-orders/${orderId}/apply-coupon`, { code: '' });
    expect(res.status).toBe(400);
    expect((await readJson(res)).code).toBe('REQ_001');
  });
});
