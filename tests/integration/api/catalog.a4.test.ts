/**
 * 目錄 API 整合測試（services / staff / products / product-orders / coupons /
 * membership-levels）— 12 分冊 §4「Phase 3（核心 API）」矩陣：
 *   「每端點照 §3 骨架，另加…」＋ 04 §A-4「全部 GET，list 全量不分頁」。
 * 端點行為規格見 docs/integration/04-API-CONTRACTS.md §A-4。
 *
 * ⚠️ TDD 紅燈說明：撰寫本檔當下 `src/app/api/{services,staff,products,
 * product-orders,coupons,membership-levels}/**` 完全未實作（Phase 3 施工中），
 * 全部紅燈——誠實的「先寫測試」狀態，不得為轉綠放寬斷言（12 §2.4）。
 *
 * 清理紀律：seed 沒有 coupons/membership-levels/product-orders/products 資料，
 * 六個端點裡的 join/聚合欄位（categoryName／serviceIds／issuedQuantity 等）
 * 一律自建（service role）驗證後在同一個 test 內清理（try/finally），且：
 *   - staff 的聚合測試會暫時往 seed 的 staffA1 插一筆 staff_services——插入前
 *     baseline 先斷言是 []，插入後驗證聚合，最後刪掉那筆讓 staffA1 的
 *     serviceIds 還原成 []，不留給其他檔案。
 *   - membership-levels 的聚合測試會暫時把 seed 的 customerA2.membership_level_id
 *     從 null 改成新建等級的 id，驗證完立刻改回 null，並刪掉新建的等級。
 * 這兩處都用 try/finally 包住，確保斷言失敗時也會執行復原。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { Service, Staff, Product, ProductOrder, Coupon, MembershipLevel } from '@/lib/types';

const BASE = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

function uniqueSuffix(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

describe('GET /api/services（04 §A-4）', () => {
  it('200；seed serviceA1 categoryName=null；自建 category+service → categoryName 有值', async () => {
    const listRes = await ownerA.get('/api/services');
    expect(listRes.status).toBe(200);
    const body = await readJson<Service[]>(listRes);
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    const seedService = body.data!.find((s) => s.id === SHOP_A.serviceA1);
    expect(seedService).toBeDefined();
    expect(seedService!.categoryName).toBeNull();
    expect(seedService!.price).toBe(800);

    const categoryId = randomUUID();
    const serviceId = randomUUID();
    const categoryName = `分類-服務測試-${uniqueSuffix()}`;
    try {
      await admin.from('service_categories').insert({ id: categoryId, tenant_id: SHOP_A.id, name: categoryName, sort_order: 0 });
      const { error: serviceError } = await admin.from('services').insert({
        id: serviceId, tenant_id: SHOP_A.id, category_id: categoryId,
        name: `分類服務-${uniqueSuffix()}`, duration_minutes: 30, price: 500,
        sort_order: 70, line_sort_order: 70,
      });
      expect(serviceError).toBeNull();

      const res2 = await ownerA.get('/api/services');
      const body2 = await readJson<Service[]>(res2);
      const withCategory = body2.data!.find((s) => s.id === serviceId);
      expect(withCategory).toBeDefined();
      expect(withCategory!.categoryName).toBe(categoryName);
      expect(withCategory!.categoryId).toBe(categoryId);
    } finally {
      await admin.from('services').delete().eq('id', serviceId);
      await admin.from('service_categories').delete().eq('id', categoryId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/services`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/staff（04 §A-4：staff + staff_services 聚合成 serviceIds）', () => {
  it('seed staffA1/staffA2 baseline serviceIds=[]；插一筆 staff_services 後聚合出 [serviceA1]；清理後還原', async () => {
    const listRes = await ownerA.get('/api/staff');
    expect(listRes.status).toBe(200);
    const body = await readJson<Staff[]>(listRes);
    expect(body.success).toBe(true);
    const staffA1Before = body.data!.find((s) => s.id === SHOP_A.staffA1);
    const staffA2 = body.data!.find((s) => s.id === SHOP_A.staffA2);
    expect(staffA1Before).toBeDefined();
    expect(staffA1Before!.serviceIds).toEqual([]);
    expect(staffA2).toBeDefined();
    expect(staffA2!.serviceIds).toEqual([]);

    try {
      const { error } = await admin
        .from('staff_services')
        .insert({ staff_id: SHOP_A.staffA1, service_id: SHOP_A.serviceA1, tenant_id: SHOP_A.id });
      expect(error).toBeNull();

      const res2 = await ownerA.get('/api/staff');
      const body2 = await readJson<Staff[]>(res2);
      const staffA1After = body2.data!.find((s) => s.id === SHOP_A.staffA1);
      expect(staffA1After!.serviceIds).toEqual([SHOP_A.serviceA1]);
      // staffA2 不受影響
      const staffA2After = body2.data!.find((s) => s.id === SHOP_A.staffA2);
      expect(staffA2After!.serviceIds).toEqual([]);
    } finally {
      await admin
        .from('staff_services')
        .delete()
        .eq('staff_id', SHOP_A.staffA1)
        .eq('service_id', SHOP_A.serviceA1);
    }

    // 復原驗證：清理後 staffA1 應回到 []
    const resAfterCleanup = await ownerA.get('/api/staff');
    const bodyAfterCleanup = await readJson<Staff[]>(resAfterCleanup);
    expect(bodyAfterCleanup.data!.find((s) => s.id === SHOP_A.staffA1)!.serviceIds).toEqual([]);
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/staff`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/products（04 §A-4：products join product_categories）', () => {
  it('200，形狀為陣列；自建 category+product → categoryName 有值', async () => {
    const baseline = await ownerA.get('/api/products');
    expect(baseline.status).toBe(200);
    const baselineBody = await readJson<Product[]>(baseline);
    expect(baselineBody.success).toBe(true);
    expect(Array.isArray(baselineBody.data)).toBe(true);

    const categoryId = randomUUID();
    const productId = randomUUID();
    const categoryName = `分類-產品測試-${uniqueSuffix()}`;
    try {
      await admin.from('product_categories').insert({ id: categoryId, tenant_id: SHOP_A.id, name: categoryName, sort_order: 0 });
      await admin.from('products').insert({
        id: productId, tenant_id: SHOP_A.id, category_id: categoryId,
        name: `分類產品-${uniqueSuffix()}`, price: 199, stock: 5, safety_stock: 1,
      });

      const res2 = await ownerA.get('/api/products');
      const body2 = await readJson<Product[]>(res2);
      const withCategory = body2.data!.find((p) => p.id === productId);
      expect(withCategory).toBeDefined();
      expect(withCategory!.categoryName).toBe(categoryName);
      expect(withCategory!.price).toBe(199);
      expect(withCategory!.stock).toBe(5);
    } finally {
      await admin.from('products').delete().eq('id', productId);
      await admin.from('product_categories').delete().eq('id', categoryId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/products`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/product-orders（04 §A-4：product_orders + items 聚合 + customer name）', () => {
  it('自建一筆含 1 個品項的訂單 → items 陣列與 customerName 正確', async () => {
    const productId = randomUUID();
    const orderId = randomUUID();
    const itemId = randomUUID();
    const productName = `訂單測試商品-${uniqueSuffix()}`;
    try {
      await admin.from('products').insert({ id: productId, tenant_id: SHOP_A.id, name: productName, price: 150, stock: 10, safety_stock: 0 });
      await admin.from('product_orders').insert({
        id: orderId, tenant_id: SHOP_A.id, order_no: `TESTPO${uniqueSuffix()}`,
        customer_id: SHOP_A.customerA1, total_amount: 300, status: 'PENDING', payment_status: 'UNPAID',
      });
      await admin.from('product_order_items').insert({
        id: itemId, order_id: orderId, tenant_id: SHOP_A.id, product_id: productId,
        product_name: productName, quantity: 2, price: 150,
      });

      const res = await ownerA.get('/api/product-orders');
      expect(res.status).toBe(200);
      const body = await readJson<ProductOrder[]>(res);
      expect(body.success).toBe(true);
      const order = body.data!.find((o) => o.id === orderId);
      expect(order).toBeDefined();
      expect(order!.customerName).toBe('顧客 A1（測試）');
      expect(order!.totalAmount).toBe(300);
      expect(order!.items).toHaveLength(1);
      expect(order!.items[0].productId).toBe(productId);
      expect(order!.items[0].productName).toBe(productName);
      expect(order!.items[0].quantity).toBe(2);
      expect(order!.items[0].price).toBe(150);
    } finally {
      await admin.from('product_order_items').delete().eq('id', itemId);
      await admin.from('product_orders').delete().eq('id', orderId);
      await admin.from('products').delete().eq('id', productId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/product-orders`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/coupons（04 §A-4：coupons + issued/redeemed count 子查詢）', () => {
  it('發 2 張、核銷 1 張 → issuedQuantity=2、redeemedQuantity=1', async () => {
    const couponId = randomUUID();
    const instance1 = randomUUID();
    const instance2 = randomUUID();
    try {
      await admin.from('coupons').insert({
        id: couponId, tenant_id: SHOP_A.id, name: `測試票券-${uniqueSuffix()}`,
        discount_type: 'AMOUNT', discount_value: 100, total_quantity: 0, status: 'PUBLISHED',
      });
      await admin.from('coupon_instances').insert([
        { id: instance1, tenant_id: SHOP_A.id, coupon_id: couponId, customer_id: SHOP_A.customerA1, code: `CPA${uniqueSuffix()}`.toUpperCase().slice(0, 12), redeemed_at: new Date().toISOString() },
        { id: instance2, tenant_id: SHOP_A.id, coupon_id: couponId, customer_id: SHOP_A.customerA2, code: `CPB${uniqueSuffix()}`.toUpperCase().slice(0, 12) },
      ]);

      const res = await ownerA.get('/api/coupons');
      expect(res.status).toBe(200);
      const body = await readJson<Coupon[]>(res);
      expect(body.success).toBe(true);
      const coupon = body.data!.find((c) => c.id === couponId);
      expect(coupon).toBeDefined();
      expect(coupon!.issuedQuantity).toBe(2);
      expect(coupon!.redeemedQuantity).toBe(1);
    } finally {
      await admin.from('coupon_instances').delete().in('id', [instance1, instance2]);
      await admin.from('coupons').delete().eq('id', couponId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/coupons`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});

describe('GET /api/membership-levels（04 §A-4：+ customerCount(count customers)）', () => {
  it('掛 1 位顧客 → customerCount=1；清理後 customerA2 還原成 null', async () => {
    const levelId = randomUUID();
    try {
      await admin.from('membership_levels').insert({
        id: levelId, tenant_id: SHOP_A.id, name: `測試等級-${uniqueSuffix()}`,
        color: '#123456', threshold_spent: 0, discount_percent: 0, point_rate_multiplier: 1, sort_order: 99,
      });
      const { error: updErr } = await admin.from('customers').update({ membership_level_id: levelId }).eq('id', SHOP_A.customerA2);
      expect(updErr).toBeNull();

      const res = await ownerA.get('/api/membership-levels');
      expect(res.status).toBe(200);
      const body = await readJson<MembershipLevel[]>(res);
      expect(body.success).toBe(true);
      const level = body.data!.find((l) => l.id === levelId);
      expect(level).toBeDefined();
      expect(level!.customerCount).toBe(1);
    } finally {
      await admin.from('customers').update({ membership_level_id: null }).eq('id', SHOP_A.customerA2);
      await admin.from('membership_levels').delete().eq('id', levelId);
    }
  });

  it('未登入 → 401 AUTH_001', async () => {
    const res = await fetch(`${BASE}/api/membership-levels`);
    expect(res.status).toBe(401);
    expect((await readJson(res)).code).toBe('AUTH_001');
  });
});
