/**
 * 商品 / 訂單 / 庫存 API 整合測試 — 12 分冊 §4「Phase 5」矩陣「其餘 B 組端點：
 * 照 §3 骨架，含各狀態機 409」。端點規格見 docs/integration/04-API-CONTRACTS.md §B-3：
 *   - POST /api/products/:id/adjust-stock：{delta, reason}，stock 不可 <0（409）
 *     ＋寫 inventory_logs
 *   - POST /api/product-orders/manual：驗庫存 → 扣庫存＋logs＋建單
 *     （單價取當下 price 快照）
 *   - POST /api/product-orders/:id/confirm‖cancel：狀態機同預約；cancel 回補庫存
 *   - GET /api/product-orders/pending/count：{count}
 *
 * 清理紀律：seed 沒有任何 products/product_orders，本檔資料全部自建
 * （service role 建商品/顧客；訂單走 API），afterAll／finally 依 FK 方向清：
 * product_order_items → product_orders → products（inventory_logs 隨商品
 * cascade）→ customers。顧客不用 seed 的 customerA1/A2/A3（reports.a5 手算
 * 期望值依賴），一律自建。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'node:crypto';
import { SHOP_A } from '../../fixtures';
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
let customerId: string;

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  customerId = randomUUID();
  const { error } = await admin
    .from('customers')
    .insert({ id: customerId, tenant_id: SHOP_A.id, name: 'B3 訂單測試專屬顧客', phone: '' });
  expect(error).toBeNull();
});

afterAll(async () => {
  // 保險清掃：刪掉此顧客殘留的訂單（items cascade），再刪顧客
  const { data: orders } = await admin
    .from('product_orders').select('id').eq('customer_id', customerId);
  const ids = (orders ?? []).map((o: any) => o.id);
  if (ids.length > 0) await admin.from('product_orders').delete().in('id', ids);
  await admin.from('customers').delete().eq('id', customerId);
});

async function insertProduct(params: { stock: number; price: number }): Promise<string> {
  const id = randomUUID();
  const { error } = await admin.from('products').insert({
    id, tenant_id: SHOP_A.id, name: `B3 測試商品-${uniqueSuffix()}`,
    price: params.price, stock: params.stock, safety_stock: 0,
  });
  expect(error).toBeNull();
  return id;
}

async function productStock(id: string): Promise<number> {
  const { data, error } = await admin.from('products').select('stock').eq('id', id).single();
  expect(error).toBeNull();
  return (data as any).stock as number;
}

async function deleteProduct(id: string): Promise<void> {
  await admin.from('inventory_logs').delete().eq('product_id', id);
  const { error } = await admin.from('products').delete().eq('id', id);
  expect(error).toBeNull();
}

/** 走 API 建一筆手動訂單並回傳 {orderId}；qty 商品各一項。 */
async function createManualOrder(productId: string, quantity: number): Promise<string> {
  const res = await ownerA.post('/api/product-orders/manual', {
    customerId,
    items: [{ productId, quantity }],
  });
  expect(res.status).toBe(200);
  const body = await readJson<{ id: string }>(res);
  expect(body.success).toBe(true);
  expect(typeof body.data?.id).toBe('string');
  return body.data!.id;
}

async function deleteOrder(orderId: string): Promise<void> {
  const { error } = await admin.from('product_orders').delete().eq('id', orderId); // items cascade
  expect(error).toBeNull();
}

describe('POST /api/products/:id/adjust-stock（04 §B-3：不可調到 <0）', () => {
  it('負到 0 以下 → 409 REQ_003，庫存不變、不寫 inventory_logs', async () => {
    const productId = await insertProduct({ stock: 3, price: 100 });
    try {
      const res = await ownerA.post(`/api/products/${productId}/adjust-stock`, {
        delta: -5,
        reason: 'B3 測試：超扣',
      });
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
      expect(await productStock(productId)).toBe(3);

      const { count } = await admin
        .from('inventory_logs')
        .select('id', { count: 'exact', head: true })
        .eq('product_id', productId);
      expect(count ?? 0).toBe(0);
    } finally {
      await deleteProduct(productId);
    }
  });
});

describe('POST /api/product-orders/manual（04 §B-3：扣庫存＋logs＋建單、單價快照）', () => {
  it('成功建單：庫存 10→8、total=價×量、items 快照名稱與單價、寫 inventory_logs', async () => {
    const productId = await insertProduct({ stock: 10, price: 150 });
    let orderId: string | null = null;
    try {
      orderId = await createManualOrder(productId, 2);

      expect(await productStock(productId)).toBe(8);

      const { data: order, error: oErr } = await admin
        .from('product_orders')
        .select('order_no, total_amount, status, payment_status')
        .eq('id', orderId).single();
      expect(oErr).toBeNull();
      expect(Number((order as any).total_amount)).toBe(300);
      expect((order as any).status).toBe('PENDING');

      // items 快照：product_name / price 為下單當下的值
      const { data: prodRow } = await admin
        .from('products').select('name').eq('id', productId).single();
      const { data: items, error: iErr } = await admin
        .from('product_order_items')
        .select('product_id, product_name, quantity, price')
        .eq('order_id', orderId);
      expect(iErr).toBeNull();
      expect(items).toHaveLength(1);
      expect((items as any[])[0].product_id).toBe(productId);
      expect((items as any[])[0].product_name).toBe((prodRow as any).name);
      expect((items as any[])[0].quantity).toBe(2);
      expect(Number((items as any[])[0].price)).toBe(150);

      // 扣庫存有寫 inventory_logs（delta -2、stock_after 8）
      const { data: logs, error: lErr } = await admin
        .from('inventory_logs')
        .select('delta, stock_after')
        .eq('product_id', productId);
      expect(lErr).toBeNull();
      expect(logs).toHaveLength(1);
      expect((logs as any[])[0].delta).toBe(-2);
      expect((logs as any[])[0].stock_after).toBe(8);
    } finally {
      if (orderId) await deleteOrder(orderId);
      await deleteProduct(productId);
    }
  });

  it('庫存不足 → 409 REQ_003，庫存未變、未建單', async () => {
    const productId = await insertProduct({ stock: 3, price: 100 });
    try {
      const { count: ordersBefore } = await admin
        .from('product_orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId);

      const res = await ownerA.post('/api/product-orders/manual', {
        customerId,
        items: [{ productId, quantity: 99 }],
      });
      expect(res.status).toBe(409);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');

      expect(await productStock(productId)).toBe(3); // 未被扣

      const { count: ordersAfter } = await admin
        .from('product_orders')
        .select('id', { count: 'exact', head: true })
        .eq('customer_id', customerId);
      expect(ordersAfter ?? 0).toBe(ordersBefore ?? 0); // 沒建出半張單
    } finally {
      await deleteProduct(productId);
    }
  });
});

describe('POST /api/product-orders/:id/cancel（04 §B-3：cancel 回補庫存）', () => {
  it('PENDING → CANCELLED，庫存 8→10 回補並寫回補 log', async () => {
    const productId = await insertProduct({ stock: 10, price: 150 });
    let orderId: string | null = null;
    try {
      orderId = await createManualOrder(productId, 2);
      expect(await productStock(productId)).toBe(8);

      const res = await ownerA.post(`/api/product-orders/${orderId}/cancel`);
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      const { data } = await admin
        .from('product_orders').select('status').eq('id', orderId).single();
      expect((data as any).status).toBe('CANCELLED');
      expect(await productStock(productId)).toBe(10);

      const { data: logs } = await admin
        .from('inventory_logs')
        .select('delta, stock_after')
        .eq('product_id', productId)
        .order('created_at', { ascending: true });
      // 第 1 筆：下單扣 -2；第 2 筆：取消回補 +2
      expect(logs).toHaveLength(2);
      expect((logs as any[])[1].delta).toBe(2);
      expect((logs as any[])[1].stock_after).toBe(10);
    } finally {
      if (orderId) await deleteOrder(orderId);
      await deleteProduct(productId);
    }
  });
});

describe('GET /api/product-orders/pending/count（04 §B-3：Topbar 徽章）', () => {
  it('建一張 PENDING 單 → count +1；取消後 → 還原', async () => {
    const productId = await insertProduct({ stock: 5, price: 100 });
    let orderId: string | null = null;
    try {
      const base = await ownerA.get('/api/product-orders/pending/count');
      expect(base.status).toBe(200);
      const baseBody = await readJson<{ count: number }>(base);
      expect(baseBody.success).toBe(true);
      expect(typeof baseBody.data?.count).toBe('number');
      const before = baseBody.data!.count;

      orderId = await createManualOrder(productId, 1);
      const after = await readJson<{ count: number }>(
        await ownerA.get('/api/product-orders/pending/count'),
      );
      expect(after.data!.count).toBe(before + 1);

      const cancel = await ownerA.post(`/api/product-orders/${orderId}/cancel`);
      expect(cancel.status).toBe(200);
      const restored = await readJson<{ count: number }>(
        await ownerA.get('/api/product-orders/pending/count'),
      );
      expect(restored.data!.count).toBe(before);
    } finally {
      if (orderId) await deleteOrder(orderId);
      await deleteProduct(productId);
    }
  });
});

describe('POST /api/product-orders/:id/confirm 狀態機（04 §B-3：同預約，重複操作 409）', () => {
  it('PENDING → CONFIRMED 200；重複 confirm → 409 REQ_003', async () => {
    const productId = await insertProduct({ stock: 5, price: 100 });
    let orderId: string | null = null;
    try {
      orderId = await createManualOrder(productId, 1);

      const first = await ownerA.post(`/api/product-orders/${orderId}/confirm`);
      expect(first.status).toBe(200);
      expect((await readJson(first)).success).toBe(true);
      const { data } = await admin
        .from('product_orders').select('status').eq('id', orderId).single();
      expect((data as any).status).toBe('CONFIRMED');

      const again = await ownerA.post(`/api/product-orders/${orderId}/confirm`);
      expect(again.status).toBe(409);
      const body = await readJson(again);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_003');
    } finally {
      if (orderId) await deleteOrder(orderId);
      await deleteProduct(productId);
    }
  });
});
