/**
 * 服務／商品分類的說明與啟用欄位真的落地（GitHub issue #28 第 ⑨ 筆）
 * -----------------------------------------------------------------------------
 * 04 分冊 §A-4（分類 CRUD+reorder）＋ migration 0018。
 *
 * 修改前：`createSchema = z.object({ name })`、insert 只有 name + sort_order，
 * 所以分類管理 modal 上填的「說明」（服務）與「排序／啟用」（商品）從未離開
 * 瀏覽器；product-categories 的 GET 甚至硬回 `active: true`。畫面顯示
 * 「分類已新增」並把值列進表格，重新整理就全部消失。
 *
 * 驗收重點同 §7 的判準：不是「有新增一列」，而是**送進去的值與 DB 裡的值逐欄相符**，
 * 而且 GET 讀回來的也是同一個值（重新整理不會蒸發）。
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

async function readJson<T = unknown>(res: Response): Promise<Envelope<T>> {
  return (await res.json()) as Envelope<T>;
}

const suffix = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

interface CategoryDto {
  id: string;
  name: string;
  description: string;
  active: boolean;
  sortOrder: number;
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

describe('POST /api/service-categories（04 §A-4 + migration 0018）', () => {
  it('新增分類帶「說明」→ service role 直查 service_categories，description 內容相符', async () => {
    const s = suffix();
    const payload = { name: `服務分類-${s}`, description: `這個分類的說明-${s}`, active: true };

    const res = await ownerA.post('/api/service-categories', payload);
    expect(res.status).toBe(200);
    const created = await readJson<{ id: string; sortOrder: number }>(res);
    expect(created.success).toBe(true);
    const id = created.data!.id;

    try {
      const { data: row, error } = await admin
        .from('service_categories')
        .select('tenant_id, name, description, active, sort_order')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      expect(row!.tenant_id).toBe(SHOP_A.id);
      expect(row!.name).toBe(payload.name);
      // ← 這一行就是本筆缺陷：修改前 description 永遠是 ''
      expect(row!.description).toBe(payload.description);
      expect(row!.active).toBe(true);
      expect(row!.sort_order).toBe(created.data!.sortOrder);

      // 重新整理（= 再 GET 一次）之後說明還在
      const listRes = await ownerA.get('/api/service-categories');
      const list = await readJson<CategoryDto[]>(listRes);
      const found = list.data!.find((c) => c.id === id);
      expect(found).toBeDefined();
      expect(found!.description).toBe(payload.description);
      expect(found!.active).toBe(true);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('active: false 新增 → DB 與 GET 都是 false（不再硬回 true）', async () => {
    const s = suffix();
    const res = await ownerA.post('/api/service-categories', {
      name: `停用服務分類-${s}`, description: `停用說明-${s}`, active: false,
    });
    const id = (await readJson<{ id: string }>(res)).data!.id;
    try {
      const { data: row } = await admin
        .from('service_categories').select('description, active').eq('id', id).single();
      expect(row!.active).toBe(false);
      expect(row!.description).toBe(`停用說明-${s}`);

      const list = await readJson<CategoryDto[]>(await ownerA.get('/api/service-categories'));
      expect(list.data!.find((c) => c.id === id)!.active).toBe(false);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('不帶 description/active（舊呼叫端）→ 走欄位預設值（空字串／true），不報錯', async () => {
    const res = await ownerA.post('/api/service-categories', { name: `只有名字-${suffix()}` });
    expect(res.status).toBe(200);
    const id = (await readJson<{ id: string }>(res)).data!.id;
    try {
      const { data: row } = await admin
        .from('service_categories').select('description, active').eq('id', id).single();
      expect(row!.description).toBe('');
      expect(row!.active).toBe(true);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });
});

describe('POST /api/product-categories（04 §A-4 + migration 0018）', () => {
  it('新增分類帶「排序／啟用／說明」→ 直查 product_categories 三欄都相符', async () => {
    const s = suffix();
    const payload = {
      name: `商品分類-${s}`,
      description: `商品分類說明-${s}`,
      active: false,
      sortOrder: 42,
    };

    const res = await ownerA.post('/api/product-categories', payload);
    expect(res.status).toBe(200);
    const created = await readJson<{ id: string; sortOrder: number }>(res);
    const id = created.data!.id;

    try {
      const { data: row, error } = await admin
        .from('product_categories')
        .select('tenant_id, name, description, active, sort_order')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      expect(row!.tenant_id).toBe(SHOP_A.id);
      expect(row!.name).toBe(payload.name);
      expect(row!.description).toBe(payload.description);
      // ← 修改前這兩欄不存在，畫面上的排序與啟用純粹是本地 state
      expect(row!.active).toBe(false);
      expect(row!.sort_order).toBe(42);
      // 端點回的 sortOrder 是實際寫入值，頁面用它顯示（不自己猜）
      expect(created.data!.sortOrder).toBe(42);

      const list = await readJson<CategoryDto[]>(await ownerA.get('/api/product-categories'));
      const found = list.data!.find((c) => c.id === id);
      expect(found).toBeDefined();
      expect(found!.active).toBe(false);
      expect(found!.sortOrder).toBe(42);
      expect(found!.description).toBe(payload.description);
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });

  it('不帶 sortOrder → 沿用「目前最大值 +1」的既有行為', async () => {
    const { data: last } = await admin
      .from('product_categories')
      .select('sort_order')
      .eq('tenant_id', SHOP_A.id)
      .order('sort_order', { ascending: false })
      .limit(1)
      .maybeSingle();
    const expected = ((last?.sort_order as number | undefined) ?? 0) + 1;

    const res = await ownerA.post('/api/product-categories', { name: `無排序-${suffix()}` });
    const created = await readJson<{ id: string; sortOrder: number }>(res);
    const id = created.data!.id;
    try {
      expect(created.data!.sortOrder).toBe(expected);
      const { data: row } = await admin
        .from('product_categories').select('sort_order, active, description').eq('id', id).single();
      expect(row!.sort_order).toBe(expected);
      expect(row!.active).toBe(true);
      expect(row!.description).toBe('');
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });
});
