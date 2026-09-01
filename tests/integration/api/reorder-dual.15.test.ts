/**
 * Issue #15：公開頁排序與 LINE 精選排序各自持久化。
 * API 要求完整租戶集合；測試會先保存整個 tenant 的兩條排序，結束後完整還原。
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
const baseline = new Map<string, Map<string, { sort_order: number; line_sort_order: number }>>();

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

async function fullTenantIds(table: string, ownIds: string[]) {
  const { data, error } = await admin.from(table).select('id').eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
  const own = new Set(ownIds);
  return [...ownIds, ...(data ?? []).map((row) => row.id).filter((id) => !own.has(id))];
}

async function availableRanks(table: string, count: number) {
  const { data, error } = await admin.from(table)
    .select('sort_order, line_sort_order').eq('tenant_id', SHOP_A.id);
  expect(error).toBeNull();
  const publicMax = Math.max(-1, ...(data ?? []).map((row: any) => row.sort_order ?? -1));
  const lineMax = Math.max(-1, ...(data ?? []).map((row: any) => row.line_sort_order ?? -1));
  const base = Math.max(publicMax, lineMax) + 1;
  return Array.from({ length: count }, (_, i) => ({
    sort_order: base + i,
    line_sort_order: base + i,
  }));
}

async function assertIndependent(table: string, path: string, ids: string[]) {
  const first = await ownerA.post(path, { ids: [ids[1], ids[0], ...ids.slice(2)] });
  expect(first.status, JSON.stringify(await first.clone().json())).toBe(200);
  const line = await ownerA.post(path.replace('/reorder', '/reorder-line'), {
    ids: [ids[0], ids[1], ...ids.slice(2)],
  });
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
  const serviceRanks = await availableRanks('services', serviceIds.length);
  const productRanks = await availableRanks('products', productIds.length);
  const portfolioRanks = await availableRanks('portfolios', portfolioIds.length);
  const { error: serviceError } = await admin.from('services').insert(serviceIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, name: `#15 排序服務 ${suffix}-${i}`, duration_minutes: 30, price: 100,
    ...serviceRanks[i],
  })));
  expect(serviceError).toBeNull();
  const { error: productError } = await admin.from('products').insert(productIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, name: `#15 排序商品 ${suffix}-${i}`, price: 100, stock: 1,
    ...productRanks[i],
  })));
  expect(productError).toBeNull();
  const { error: portfolioError } = await admin.from('portfolios').insert(portfolioIds.map((id, i) => ({
    id, tenant_id: SHOP_A.id, title: `#15 排序作品 ${suffix}-${i}`, image_url: 'https://example.test/image.png',
    ...portfolioRanks[i],
  })));
  expect(portfolioError).toBeNull();

  for (const table of ['services', 'products', 'portfolios']) {
    const { data, error } = await admin.from(table)
      .select('id, sort_order, line_sort_order').eq('tenant_id', SHOP_A.id);
    expect(error).toBeNull();
    baseline.set(table, new Map((data ?? []).map((row: any) => [row.id, {
      sort_order: row.sort_order,
      line_sort_order: row.line_sort_order,
    }])));
  }
});

afterAll(async () => {
  for (const [table, rows] of baseline) {
    for (const [id, row] of rows) {
      await admin.from(table).update({
        sort_order: row.sort_order,
        line_sort_order: row.line_sort_order,
      }).eq('id', id).eq('tenant_id', SHOP_A.id);
    }
  }
  await admin.from('services').delete().in('id', serviceIds);
  await admin.from('products').delete().in('id', productIds);
  await admin.from('portfolios').delete().in('id', portfolioIds);
});

describe('Issue #15 dual reorder endpoints', () => {
  it('services：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('services', '/api/services/reorder', await fullTenantIds('services', serviceIds));
    const res = await ownerA.get('/api/services');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === serviceIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });

  it('services：新增服務同時取得兩條排序位置且不碰撞既有資料', async () => {
    let createdId: string | undefined;
    try {
      const res = await ownerA.post('/api/services', {
        name: `#15 新增服務 ${Date.now().toString(36)}`,
        durationMinutes: 30,
        price: 100,
      });
      const body = (await res.json()) as Envelope<{ id?: string; sortOrder?: number; lineSortOrder?: number }>;
      expect(res.status, JSON.stringify(body)).toBe(200);
      expect(body.success).toBe(true);
      expect(body.data?.id).toBeTruthy();
      expect(typeof body.data?.sortOrder).toBe('number');
      expect(typeof body.data?.lineSortOrder).toBe('number');
      createdId = body.data!.id;

      const { data, error } = await admin
        .from('services')
        .select('id, sort_order, line_sort_order')
        .eq('id', createdId)
        .eq('tenant_id', SHOP_A.id)
        .single();
      expect(error).toBeNull();
      const { data: existing, error: existingError } = await admin
        .from('services')
        .select('id, sort_order, line_sort_order')
        .eq('tenant_id', SHOP_A.id)
        .neq('id', createdId);
      expect(existingError).toBeNull();
      expect(existing?.some((row: any) => row.sort_order === data.sort_order)).toBe(false);
      expect(existing?.some((row: any) => row.line_sort_order === data.line_sort_order)).toBe(false);

      expect(data).toMatchObject({
        id: createdId,
        sort_order: body.data!.sortOrder,
        line_sort_order: body.data!.lineSortOrder,
      });
    } finally {
      if (createdId) {
        await admin.from('services').delete().eq('id', createdId).eq('tenant_id', SHOP_A.id);
      }
    }
  });

  it('products：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('products', '/api/products/reorder', await fullTenantIds('products', productIds));
    const res = await ownerA.get('/api/products');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === productIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });

  it('portfolios：公開與 LINE 順序互不覆蓋', async () => {
    await assertIndependent('portfolios', '/api/portfolios/reorder', await fullTenantIds('portfolios', portfolioIds));
    const res = await ownerA.get('/api/portfolios');
    const body = (await res.json()) as Envelope<any[]>;
    expect(res.status).toBe(200);
    const x = body.data!.find((row) => row.id === portfolioIds[0]);
    expect(x).toMatchObject({ sortOrder: 1, lineSortOrder: 0 });
  });
});
