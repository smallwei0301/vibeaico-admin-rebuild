/**
 * 分類「編輯」鈕改的欄位真的存得進資料庫（GitHub issue #28 第 ⑭ 筆）
 * -----------------------------------------------------------------------------
 * 04 分冊 §A-4（分類 CRUD+reorder）＋ migration 0018。
 *
 * 修改前：`PUT /api/{service,product}-categories/:id` 的 bodySchema 只有
 * `{ name }`，而分類管理 modal 的「編輯」鈕根本沒打這支端點——它只 onChange 切
 * 本地 active 就 toast「分類已更新」。commit 3aee55e（第 ⑨ 筆）讓 active 變成
 * 真欄位之後，使用者更有理由相信按下去會被保存，誤導性反而提高。
 *
 * 驗收重點同 §7 的判準：不是「端點回 200」，而是 **PUT 送進去的值與 service role
 * 直查 DB 的值逐欄相符**，而且 GET 讀回來的也是同一個值（重新整理不會還原）。
 *
 * 另含「舊呼叫端只送 name」的相容案例：沒帶的欄位維持現值，不是被重設成預設值
 * ——update 的「預設」語意是「不動」，若寫成 `?? ''` / `?? true` 就會把使用者
 * 既有的說明與停用狀態默默抹掉，那是另一種資料蒸發。
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

/** 建一個分類回 id，讓每個案例各玩各的（reset-db 之外自行清乾淨）。 */
async function createServiceCategory(body: Record<string, unknown>): Promise<string> {
  const res = await ownerA.post('/api/service-categories', body);
  expect(res.status).toBe(200);
  return (await readJson<{ id: string }>(res)).data!.id;
}

async function createProductCategory(body: Record<string, unknown>): Promise<string> {
  const res = await ownerA.post('/api/product-categories', body);
  expect(res.status).toBe(200);
  return (await readJson<{ id: string }>(res)).data!.id;
}

describe('PUT /api/service-categories/:id（04 §A-4 + issue #28 ⑭）', () => {
  it('改 active 與 description → service role 直查 service_categories 兩欄都相符', async () => {
    const s = suffix();
    const id = await createServiceCategory({
      name: `編輯前-${s}`, description: `編輯前說明-${s}`, active: true,
    });
    try {
      const res = await ownerA.put(`/api/service-categories/${id}`, {
        description: `編輯後說明-${s}`,
        active: false,
      });
      expect(res.status).toBe(200);
      expect((await readJson(res)).success).toBe(true);

      // ← 本筆缺陷本體：修改前這支端點收不到這兩欄，頁面也根本沒打它
      const { data: row, error } = await admin
        .from('service_categories')
        .select('tenant_id, name, description, active')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      expect(row!.tenant_id).toBe(SHOP_A.id);
      expect(row!.description).toBe(`編輯後說明-${s}`);
      expect(row!.active).toBe(false);
      // 沒帶的 name 維持原值
      expect(row!.name).toBe(`編輯前-${s}`);

      // 重新整理（= 再 GET 一次）之後改動還在，不會還原
      const list = await readJson<CategoryDto[]>(await ownerA.get('/api/service-categories'));
      const found = list.data!.find((c) => c.id === id);
      expect(found).toBeDefined();
      expect(found!.active).toBe(false);
      expect(found!.description).toBe(`編輯後說明-${s}`);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('停用後再啟用 → active 真的回到 true（切換兩次都落地）', async () => {
    const id = await createServiceCategory({ name: `來回切-${suffix()}`, active: true });
    try {
      await ownerA.put(`/api/service-categories/${id}`, { active: false });
      const { data: off } = await admin
        .from('service_categories').select('active').eq('id', id).single();
      expect(off!.active).toBe(false);

      await ownerA.put(`/api/service-categories/${id}`, { active: true });
      const { data: on } = await admin
        .from('service_categories').select('active').eq('id', id).single();
      expect(on!.active).toBe(true);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('不帶 description/active（舊呼叫端只送 name）→ 只改名，另兩欄維持現值不被重設', async () => {
    const s = suffix();
    const id = await createServiceCategory({
      name: `改名前-${s}`, description: `不該被清掉-${s}`, active: false,
    });
    try {
      const res = await ownerA.put(`/api/service-categories/${id}`, { name: `改名後-${s}` });
      expect(res.status).toBe(200);

      const { data: row } = await admin
        .from('service_categories').select('name, description, active').eq('id', id).single();
      expect(row!.name).toBe(`改名後-${s}`);
      // 若端點寫成 description: b.description ?? ''，這兩行會紅——那是資料蒸發
      expect(row!.description).toBe(`不該被清掉-${s}`);
      expect(row!.active).toBe(false);
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('body 三欄全沒帶 → 400，不回一個什麼都沒做的 200', async () => {
    const id = await createServiceCategory({ name: `空 body-${suffix()}` });
    try {
      const res = await ownerA.put(`/api/service-categories/${id}`, {});
      expect(res.status).toBe(400);
      const body = await readJson(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('REQ_001');
    } finally {
      await admin.from('service_categories').delete().eq('id', id);
    }
  });

  it('別家店的分類 id → 404（租戶隔離沒因為新欄位而鬆掉）', async () => {
    const res = await ownerA.put(
      '/api/service-categories/00000000-0000-0000-0000-000000000000',
      { active: false },
    );
    expect(res.status).toBe(404);
    expect((await readJson(res)).code).toBe('REQ_002');
  });
});

describe('PUT /api/product-categories/:id（04 §A-4 + issue #28 ⑭）', () => {
  it('改 active 與 description → service role 直查 product_categories 兩欄都相符', async () => {
    const s = suffix();
    const id = await createProductCategory({
      name: `商品分類編輯前-${s}`, description: `編輯前說明-${s}`, active: true,
    });
    try {
      const res = await ownerA.put(`/api/product-categories/${id}`, {
        description: `編輯後說明-${s}`,
        active: false,
      });
      expect(res.status).toBe(200);

      const { data: row, error } = await admin
        .from('product_categories')
        .select('tenant_id, name, description, active')
        .eq('id', id)
        .single();
      expect(error).toBeNull();
      expect(row!.tenant_id).toBe(SHOP_A.id);
      expect(row!.description).toBe(`編輯後說明-${s}`);
      expect(row!.active).toBe(false);
      expect(row!.name).toBe(`商品分類編輯前-${s}`);

      const list = await readJson<CategoryDto[]>(await ownerA.get('/api/product-categories'));
      const found = list.data!.find((c) => c.id === id);
      expect(found).toBeDefined();
      expect(found!.active).toBe(false);
      expect(found!.description).toBe(`編輯後說明-${s}`);
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });

  it('停用後再啟用 → active 真的回到 true（切換兩次都落地）', async () => {
    const id = await createProductCategory({ name: `來回切-${suffix()}`, active: true });
    try {
      await ownerA.put(`/api/product-categories/${id}`, { active: false });
      const { data: off } = await admin
        .from('product_categories').select('active').eq('id', id).single();
      expect(off!.active).toBe(false);

      await ownerA.put(`/api/product-categories/${id}`, { active: true });
      const { data: on } = await admin
        .from('product_categories').select('active').eq('id', id).single();
      expect(on!.active).toBe(true);
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });

  it('不帶 description/active（舊呼叫端只送 name）→ 只改名，另兩欄維持現值不被重設', async () => {
    const s = suffix();
    const id = await createProductCategory({
      name: `改名前-${s}`, description: `不該被清掉-${s}`, active: false,
    });
    try {
      const res = await ownerA.put(`/api/product-categories/${id}`, { name: `改名後-${s}` });
      expect(res.status).toBe(200);

      const { data: row } = await admin
        .from('product_categories').select('name, description, active').eq('id', id).single();
      expect(row!.name).toBe(`改名後-${s}`);
      expect(row!.description).toBe(`不該被清掉-${s}`);
      expect(row!.active).toBe(false);
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });

  it('sortOrder 不由這支端點寫入（排序走 reorder 端點，避免兩條寫入路徑）', async () => {
    const id = await createProductCategory({ name: `排序不歸這管-${suffix()}`, sortOrder: 7 });
    try {
      // 帶了也不該被寫進去：schema 沒有這個 key，zod 預設會忽略未知欄位
      const res = await ownerA.put(`/api/product-categories/${id}`, { sortOrder: 99, active: false });
      expect(res.status).toBe(200);
      const { data: row } = await admin
        .from('product_categories').select('sort_order, active').eq('id', id).single();
      expect(row!.sort_order).toBe(7);
      expect(row!.active).toBe(false);
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });

  it('body 三欄全沒帶 → 400，不回一個什麼都沒做的 200', async () => {
    const id = await createProductCategory({ name: `空 body-${suffix()}` });
    try {
      const res = await ownerA.put(`/api/product-categories/${id}`, {});
      expect(res.status).toBe(400);
      expect((await readJson(res)).code).toBe('REQ_001');
    } finally {
      await admin.from('product_categories').delete().eq('id', id);
    }
  });
});
