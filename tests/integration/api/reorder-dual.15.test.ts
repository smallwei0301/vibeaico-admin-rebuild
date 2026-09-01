/**
 * Issue #15：公開頁排序與 LINE 精選排序各自持久化。
 * 這支測試只使用自建 UUID，並在結束時刪除，避免改到 seed 排序。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;
const serviceIds = [randomUUID(), randomUUID()];
const productIds = [randomUUID(), randomUUID()];
const portfolioIds = [randomUUID(), randomUUID()];

async function values(table: string, ids: string[]) {
  const { data, error } = await admin.from(table)
    .select('id, sort_order, line_sort_order').in('id', ids);
  expect(error).toBeNull();
  const byId = new Map((data ?? []).map((row: any) => [row.id, row]));
  return ids.map((id) => {
    const row = byId.get(id);
    expect(row, `${table} 缺少 ${id}`).toBeTruthy();
    return { sortOrder: row.sort_order as number, lineSortOrder: row.line_sort_order as number };
  });
}

async function assertIndependent(table: string, path: string, ids: string[]) {
  const first = await ownerA.post(path, { ids: [ids[1], ids[0]] });
  expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
  const line = await ownerA.post(path.replace('/reorder', '/reorder-line'), { ids: [ids[0], ids[1]] });
  expect(line.status, JSON.stringify(await line.clone().json())).toBe(200);
  const [x, y] = await values(table, ids);
  expect(y.sortOrder).toBe(0);
  expect(x.sortOrder).toBe(1);
  expect(x.lineSortOrder).toBe(0);
  expect(y.lineSortOrder).toBe(1);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  const suffix = Date.now().toString(36);
  const { error: serviceError } = await admin.from('services').insert(serviceIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, name: `#15 排序服務 ${suffix}-${i}`, duration_minutes: 30, price: 100,
  })));
  expect(serviceError).toBeNull();
  const { error: productError } = await admin.from('products').insert(productIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, name: `#15 排序商品 ${suffix}-${i}`, price: 100, stock: 1,
  })));
  expect(productError).toBeNull();
  const { error: portfolioError } = await admin.from('portfolios').insert(portfolioIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, title: `#15 排序作品 ${suffix}-${i}`, image_url: 'https://example.test/image.png',
  })));
  expect(portfolioError).toBeNull();
});

afterAll(async () => {
  await admin.from('services').delete().in('id', serviceIds);
  await admin.from('products').delete().in('id', productIds);
  await admin.from('portfolios').delete().in('id', portfolioIds);
});

describe('Issue #15 dual reorder endpoints', () => {
  it('services：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('services', '/api/services/reorder', serviceIds);
    const res = await ownerA.get('/api/services');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === serviceIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });

  it('products：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('products', '/api/products/reorder', productIds);
    const res = await ownerA.get('/api/products');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === productIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });

  it('portfolios：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('portfolios', '/api/portfolios/reorder', portfolioIds);
    const res = await ownerA.get('/api/portfolios');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === portfolioIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });
});
