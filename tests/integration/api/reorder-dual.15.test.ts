/**
 * 公開頁排序 / LINE 精選排序「兩套各自持久化」整合測試
 * — GitHub issue #15（修復-7）第 ② 項。
 *
 * 修改前：services / products / portfolio 三頁的 move() 一律 toast 成功，但只有
 * sortMode==='line' 會呼叫後端；sortMode==='public' 只改本地 state，重整即失。
 * 兩個模式並排、只有一個是真的，使用者無從分辨。
 *
 * 補齊方式（照原站端點命名，兩支各寫各的欄位）：
 *   POST …/reorder      → sort_order       ＝公開頁排序
 *   POST …/reorder-line → line_sort_order  ＝LINE 精選排序（0017 新欄位）
 *
 * 本檔對 services / products / portfolios 三組各驗一次：
 *   ① 兩支端點分別寫入後，兩欄位各自為預期順序；
 *   ② **互不干擾**：先設好一套、再改另一套，先設的那一套不變（＝重整後還在）；
 *   ③ GET 端點會把兩套順序都吐回前端（sortOrder / lineSortOrder）。
 *
 * 清理紀律：本檔只動自建的資料列（隨機 uuid），不碰 seed 的 serviceA1/A2；
 * afterAll 以 service role 全部刪除。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import type { Product, Service } from '@/lib/types';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

let admin: SupabaseClient;
let ownerA: AuthedApi;

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

/** 三張表各兩列自建資料（X、Y），afterAll 清掉 */
const svcX = randomUUID();
const svcY = randomUUID();
const prodX = randomUUID();
const prodY = randomUUID();
const pfX = randomUUID();
const pfY = randomUUID();

async function orders(table: string, ids: string[]) {
  const { data, error } = await admin
    .from(table)
    .select('id, sort_order, line_sort_order')
    .in('id', ids);
  expect(error).toBeNull();
  const byId = new Map((data ?? []).map((r: any) => [r.id, r]));
  return ids.map((id) => {
    const r = byId.get(id);
    expect(r, `${table} 找不到列 ${id}`).toBeTruthy();
    return { sortOrder: r!.sort_order as number, lineSortOrder: r!.line_sort_order as number };
  });
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);

  const s = suffix();
  const { error: e1 } = await admin.from('services').insert([
    { id: svcX, tenant_id: SHOP_A.id, name: `排序服務X-${s}`, duration_minutes: 30, price: 100 },
    { id: svcY, tenant_id: SHOP_A.id, name: `排序服務Y-${s}`, duration_minutes: 30, price: 100 },
  ]);
  expect(e1).toBeNull();
  const { error: e2 } = await admin.from('products').insert([
    { id: prodX, tenant_id: SHOP_A.id, name: `排序商品X-${s}`, price: 100 },
    { id: prodY, tenant_id: SHOP_A.id, name: `排序商品Y-${s}`, price: 100 },
  ]);
  expect(e2).toBeNull();
  const { error: e3 } = await admin.from('portfolios').insert([
    { id: pfX, tenant_id: SHOP_A.id, title: `排序作品X-${s}`, image_url: 'https://example.test/x.png' },
    { id: pfY, tenant_id: SHOP_A.id, title: `排序作品Y-${s}`, image_url: 'https://example.test/y.png' },
  ]);
  expect(e3).toBeNull();
});

afterAll(async () => {
  await admin.from('services').delete().in('id', [svcX, svcY]);
  await admin.from('products').delete().in('id', [prodX, prodY]);
  await admin.from('portfolios').delete().in('id', [pfX, pfY]);
});

describe('services：/reorder 與 /reorder-line 各寫各的欄位（issue #15 ②）', () => {
  it('公開頁排序 [Y,X] 與 LINE 排序 [X,Y] 同時成立，且互不覆蓋', async () => {
    // 公開頁排序：Y 在前
    const r1 = await ownerA.post('/api/services/reorder', { ids: [svcY, svcX] });
    expect(r1.status, JSON.stringify(await r1.clone().json())).toBe(200);
    let [x, y] = await orders('services', [svcX, svcY]);
    expect(y.sortOrder).toBe(0);
    expect(x.sortOrder).toBe(1);

    // LINE 排序：X 在前 —— 寫的是另一欄，公開頁那套必須原封不動
    const r2 = await ownerA.post('/api/services/reorder-line', { ids: [svcX, svcY] });
    expect(r2.status, JSON.stringify(await r2.clone().json())).toBe(200);
    [x, y] = await orders('services', [svcX, svcY]);
    expect(x.lineSortOrder).toBe(0);
    expect(y.lineSortOrder).toBe(1);
    expect(y.sortOrder).toBe(0); // ← 公開頁那套沒被覆蓋
    expect(x.sortOrder).toBe(1);

    // 反向再改一次公開頁：LINE 那套同樣不受影響
    const r3 = await ownerA.post('/api/services/reorder', { ids: [svcX, svcY] });
    expect(r3.status).toBe(200);
    [x, y] = await orders('services', [svcX, svcY]);
    expect(x.sortOrder).toBe(0);
    expect(y.sortOrder).toBe(1);
    expect(x.lineSortOrder).toBe(0); // ← LINE 那套沒被覆蓋
    expect(y.lineSortOrder).toBe(1);
  });

  it('GET /api/services 兩套順序都吐回前端（sortOrder / lineSortOrder）', async () => {
    await ownerA.post('/api/services/reorder', { ids: [svcY, svcX] });
    await ownerA.post('/api/services/reorder-line', { ids: [svcX, svcY] });

    const res = await ownerA.get('/api/services');
    const body = (await res.json()) as Envelope<Service[]>;
    expect(res.status).toBe(200);
    const rowX = body.data!.find((s) => s.id === svcX)!;
    const rowY = body.data!.find((s) => s.id === svcY)!;
    expect(rowY.sortOrder).toBe(0);
    expect(rowX.sortOrder).toBe(1);
    expect(rowX.lineSortOrder).toBe(0);
    expect(rowY.lineSortOrder).toBe(1);
  });
});

describe('products：/reorder 與 /reorder-line 各寫各的欄位（issue #15 ②）', () => {
  it('公開頁排序 [Y,X] 與 LINE 排序 [X,Y] 同時成立，且互不覆蓋', async () => {
    const r1 = await ownerA.post('/api/products/reorder', { ids: [prodY, prodX] });
    expect(r1.status, JSON.stringify(await r1.clone().json())).toBe(200);
    const r2 = await ownerA.post('/api/products/reorder-line', { ids: [prodX, prodY] });
    expect(r2.status, JSON.stringify(await r2.clone().json())).toBe(200);

    const [x, y] = await orders('products', [prodX, prodY]);
    expect(y.sortOrder).toBe(0);
    expect(x.sortOrder).toBe(1);
    expect(x.lineSortOrder).toBe(0);
    expect(y.lineSortOrder).toBe(1);
  });

  it('GET /api/products 兩套順序都吐回前端', async () => {
    const res = await ownerA.get('/api/products');
    const body = (await res.json()) as Envelope<Product[]>;
    expect(res.status).toBe(200);
    const rowX = body.data!.find((p) => p.id === prodX)!;
    const rowY = body.data!.find((p) => p.id === prodY)!;
    expect(rowY.sortOrder).toBe(0);
    expect(rowX.sortOrder).toBe(1);
    expect(rowX.lineSortOrder).toBe(0);
    expect(rowY.lineSortOrder).toBe(1);
  });
});

describe('portfolios：/reorder 與 /reorder-line 各寫各的欄位（issue #15 ②）', () => {
  it('公開頁排序 [Y,X] 與 LINE 排序 [X,Y] 同時成立，且互不覆蓋', async () => {
    const r1 = await ownerA.post('/api/portfolios/reorder', { ids: [pfY, pfX] });
    expect(r1.status, JSON.stringify(await r1.clone().json())).toBe(200);
    const r2 = await ownerA.post('/api/portfolios/reorder-line', { ids: [pfX, pfY] });
    expect(r2.status, JSON.stringify(await r2.clone().json())).toBe(200);

    const [x, y] = await orders('portfolios', [pfX, pfY]);
    expect(y.sortOrder).toBe(0);
    expect(x.sortOrder).toBe(1);
    expect(x.lineSortOrder).toBe(0);
    expect(y.lineSortOrder).toBe(1);
  });

  it('GET /api/portfolios 兩套順序都吐回前端', async () => {
    const res = await ownerA.get('/api/portfolios');
    const body = (await res.json()) as Envelope<
      { id: string; sortOrder: number; lineSortOrder: number }[]
    >;
    expect(res.status).toBe(200);
    const rowX = body.data!.find((p) => p.id === pfX)!;
    const rowY = body.data!.find((p) => p.id === pfY)!;
    expect(rowY.sortOrder).toBe(0);
    expect(rowX.sortOrder).toBe(1);
    expect(rowX.lineSortOrder).toBe(0);
    expect(rowY.lineSortOrder).toBe(1);
  });
});
