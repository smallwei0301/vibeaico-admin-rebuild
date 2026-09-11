/**
 * issue #238：products 的排序取號與重排。
 *
 * 修復前（canonical TEST 實測，兩者皆 500）：
 *   - 新增第二個商品：POST 只算 sort_order = max+1，line_sort_order 完全沒給
 *     （column default 0），撞 products_tenant_line_sort_order_uq。
 *   - 重新排序：逐筆 update({sort_order: i})，第一次迭代把某筆設成 0 時，
 *     原本就是 0 的那筆還在，撞 products_tenant_sort_order_uq。
 *
 * 正式庫沒有這兩個索引所以不會 500，但 line_sort_order 全是 0 —— 代表
 * 「LINE 商品排序」根本沒有作用：店家拖曳、存檔、沒報錯，顧客看到的順序
 * 卻不是他排的。所以這裡不只驗「不會 500」，還要驗**值真的不同**。
 *
 * 期望值一律以 service role 獨立查一次算出，不採信 API 自己的回應。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
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
const created: string[] = [];
const createdPortfolios: string[] = [];

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  if (created.length) await admin.from('products').delete().in('id', created);
  if (createdPortfolios.length) {
    await admin.from('portfolios').delete().in('id', createdPortfolios);
  }
  await admin.from('catalog_position_counters')
    .delete().eq('tenant_id', SHOP_A.id).in('resource', ['products', 'portfolios']);
});

async function createProduct(name: string): Promise<string> {
  const res = await ownerA.post('/api/products', {
    name, price: 100, stock: 5, safetyStock: 0,
  });
  expect(res.status).toBe(200);
  const body = await readJson<{ id: string }>(res);
  expect(body.success).toBe(true);
  const id = body.data!.id;
  created.push(id);
  return id;
}

describe('issue #238：products 排序取號與重排', () => {
  it('連續新增三個商品都成功，且 sort_order 與 line_sort_order 各自互不重複', async () => {
    // 修復前這裡的第二筆就會 500（line_sort_order 皆為 0）。
    const a = await createProduct(`#238商品A-${uniqueSuffix()}`);
    const b = await createProduct(`#238商品B-${uniqueSuffix()}`);
    const c = await createProduct(`#238商品C-${uniqueSuffix()}`);

    const { data } = await admin.from('products')
      .select('id, sort_order, line_sort_order')
      .in('id', [a, b, c]);
    const rows = data as Array<{ id: string; sort_order: number; line_sort_order: number }>;
    expect(rows).toHaveLength(3);

    const sorts = rows.map((r) => r.sort_order);
    const lineSorts = rows.map((r) => r.line_sort_order);
    expect(new Set(sorts).size).toBe(3);
    expect(new Set(lineSorts).size).toBe(3);

    // 這一條是重點：修復前 line_sort_order 全部是 0（正式庫現況就是如此），
    // 所以「全都不同」比「沒有 500」更能證明 LINE 排序真的有值。
    expect(lineSorts).not.toEqual([0, 0, 0]);
  });

  it('重新排序成功，且順序真的照送出的清單改變（不是沒報錯而已）', async () => {
    const { data: before } = await admin.from('products')
      .select('id, sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const beforeIds = (before as Array<{ id: string }>).map((r) => r.id);
    expect(beforeIds.length).toBeGreaterThanOrEqual(3);

    // 把整個清單反轉送出——修復前第一次迭代就撞 23505 → 500。
    const reversed = [...beforeIds].reverse();
    const res = await ownerA.post('/api/products/reorder', { ids: reversed });
    expect(res.status).toBe(200);

    const { data: after } = await admin.from('products')
      .select('id, sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const afterIds = (after as Array<{ id: string }>).map((r) => r.id);

    expect(afterIds).toEqual(reversed);
    // 順序真的變了，不是碰巧相同
    expect(afterIds).not.toEqual(beforeIds);
    // 而且 sort_order 仍然互不重複
    const sorts = (after as Array<{ sort_order: number }>).map((r) => r.sort_order);
    expect(new Set(sorts).size).toBe(sorts.length);
  });

  it('只送部分 id 時，未送到的商品保持相對順序接在後面', async () => {
    const { data: before } = await admin.from('products')
      .select('id, sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const ids = (before as Array<{ id: string }>).map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);

    // 只送最後一筆 → 它應該排到最前面，其餘維持原相對順序
    const partial = [ids[ids.length - 1]];
    const res = await ownerA.post('/api/products/reorder', { ids: partial });
    expect(res.status).toBe(200);

    const { data: after } = await admin.from('products')
      .select('id').eq('tenant_id', SHOP_A.id).order('sort_order');
    const afterIds = (after as Array<{ id: string }>).map((r) => r.id);

    expect(afterIds[0]).toBe(partial[0]);
    expect(afterIds).toEqual([partial[0], ...ids.filter((id) => id !== partial[0])]);
  });
});

async function createPortfolio(title: string): Promise<string> {
  const res = await ownerA.post('/api/portfolios', {
    title, imageUrl: `https://example.test/${uniqueSuffix()}.jpg`,
  });
  expect(res.status).toBe(200);
  const body = await readJson<{ id: string }>(res);
  expect(body.success).toBe(true);
  const id = body.data!.id;
  createdPortfolios.push(id);
  return id;
}

describe('issue #238：portfolios 排序取號與兩條 lane 的重排', () => {
  it('連續新增三個作品都成功，且兩個排序欄位各自互不重複', async () => {
    // 修復前第二筆就會 500（實測撞 portfolios_tenant_line_sort_order_uq）。
    const a = await createPortfolio(`#238作品A-${uniqueSuffix()}`);
    const b = await createPortfolio(`#238作品B-${uniqueSuffix()}`);
    const c = await createPortfolio(`#238作品C-${uniqueSuffix()}`);

    const { data } = await admin.from('portfolios')
      .select('id, sort_order, line_sort_order').in('id', [a, b, c]);
    const rows = data as Array<{ id: string; sort_order: number; line_sort_order: number }>;
    expect(rows).toHaveLength(3);
    expect(new Set(rows.map((r) => r.sort_order)).size).toBe(3);
    expect(new Set(rows.map((r) => r.line_sort_order)).size).toBe(3);
    // 正式庫現況是全部 0——只驗「沒 500」會完全漏掉它。
    expect(rows.map((r) => r.line_sort_order)).not.toEqual([0, 0, 0]);
  });

  it('公開頁重排（public lane）只動 sort_order，不動 line_sort_order', async () => {
    const { data: before } = await admin.from('portfolios')
      .select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const rows = before as Array<{ id: string; line_sort_order: number }>;
    const ids = rows.map((r) => r.id);
    expect(ids.length).toBeGreaterThanOrEqual(3);
    const lineBefore = new Map(rows.map((r) => [r.id, r.line_sort_order]));

    const reversed = [...ids].reverse();
    const res = await ownerA.post('/api/portfolios/reorder', { ids: reversed });
    expect(res.status).toBe(200);

    const { data: after } = await admin.from('portfolios')
      .select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id).order('sort_order');
    const afterRows = after as Array<{ id: string; line_sort_order: number }>;
    expect(afterRows.map((r) => r.id)).toEqual(reversed);

    // 兩條 lane 必須各寫各的——這正是 issue #15 ② already 建立的不變式。
    for (const row of afterRows) {
      expect(row.line_sort_order).toBe(lineBefore.get(row.id));
    }
  });

  it('LINE 重排（line lane）只動 line_sort_order，不動 sort_order', async () => {
    const { data: before } = await admin.from('portfolios')
      .select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id).order('line_sort_order');
    const rows = before as Array<{ id: string; sort_order: number }>;
    const ids = rows.map((r) => r.id);
    const publicBefore = new Map(rows.map((r) => [r.id, r.sort_order]));

    const reversed = [...ids].reverse();
    const res = await ownerA.post('/api/portfolios/reorder-line', { ids: reversed });
    expect(res.status).toBe(200);

    const { data: after } = await admin.from('portfolios')
      .select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id).order('line_sort_order');
    const afterRows = after as Array<{ id: string; sort_order: number }>;
    expect(afterRows.map((r) => r.id)).toEqual(reversed);

    for (const row of afterRows) {
      expect(row.sort_order).toBe(publicBefore.get(row.id));
    }
  });
});
