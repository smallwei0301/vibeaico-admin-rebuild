/**
 * 分類編輯 modal 送出的東西真的存得進資料庫（issue #28 第 ⑭ 筆的後續）
 * -----------------------------------------------------------------------------
 * 04 分冊 §A-4 ＋ migration 0018。與 category-edit.28.test.ts 的分工：
 * 那一檔驗的是端點本身的欄位語意（只更新有帶的、全沒帶回 400、租戶隔離）；
 * **這一檔驗的是編輯 modal 實際會送出的那幾種 payload 形狀**——因為使用者按下
 * 「儲存」時，畫面送的不是隨便一組欄位，而是「這次真的改了哪幾欄」。
 *
 * 為什麼要另外測這個形狀：modal 刻意只送有變的欄位（不動而非重設）。如果哪天有人
 * 「簡化」成整包送出，端點照樣回 200、category-edit.28.test.ts 也照樣全綠，
 * 但兩個使用者同時編輯同一列時就會互相覆蓋。這裡把三種真實形狀各釘一次。
 *
 * 驗收判準同 §7：不是「端點回 200」，而是 **送進去的值與 service role 直查 DB
 * 的值逐欄相符**，而且 GET 讀回來也是同一個值（重新整理不會還原）。
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

/**
 * 兩頁的 modal 形狀完全相同（同一份實作抄兩份），所以斷言也共用一組，
 * 只換 API 路徑與資料表名。
 */
function suite(label: string, endpoint: string, table: string): void {
  const create = async (body: Record<string, unknown>): Promise<string> => {
    const res = await ownerA.post(`/api/${endpoint}`, body);
    expect(res.status).toBe(200);
    return (await readJson<{ id: string }>(res)).data!.id;
  };

  describe(label, () => {
    it('modal 三欄同時改（名稱＋說明＋啟用）→ service role 直查三欄逐一相符', async () => {
      const s = suffix();
      const id = await create({
        name: `編輯前名稱-${s}`, description: `編輯前說明-${s}`, active: true,
      });
      try {
        // ← 使用者三欄都改了：modal 送出的 patch 就長這樣
        const res = await ownerA.put(`/api/${endpoint}/${id}`, {
          name: `編輯後名稱-${s}`,
          description: `編輯後說明-${s}`,
          active: false,
        });
        expect(res.status).toBe(200);
        expect((await readJson(res)).success).toBe(true);

        const { data: row, error } = await admin
          .from(table)
          .select('tenant_id, name, description, active')
          .eq('id', id)
          .single();
        expect(error).toBeNull();
        expect(row!.tenant_id).toBe(SHOP_A.id);
        expect(row!.name).toBe(`編輯後名稱-${s}`);
        expect(row!.description).toBe(`編輯後說明-${s}`);
        expect(row!.active).toBe(false);

        // 重新整理（＝再 GET 一次）之後改動還在
        const list = await readJson<CategoryDto[]>(await ownerA.get(`/api/${endpoint}`));
        const found = list.data!.find((c) => c.id === id);
        expect(found).toBeDefined();
        expect(found!.name).toBe(`編輯後名稱-${s}`);
        expect(found!.description).toBe(`編輯後說明-${s}`);
        expect(found!.active).toBe(false);
      } finally {
        await admin.from(table).delete().eq('id', id);
      }
    });

    it('modal 只改名稱 → 說明與啟用維持現值（不動而非重設）', async () => {
      const s = suffix();
      const id = await create({
        name: `只改名前-${s}`, description: `不該被清掉-${s}`, active: false,
      });
      try {
        // modal 只送有變的欄位，所以這次的 body 只有 name
        const res = await ownerA.put(`/api/${endpoint}/${id}`, { name: `只改名後-${s}` });
        expect(res.status).toBe(200);

        const { data: row } = await admin
          .from(table).select('name, description, active').eq('id', id).single();
        expect(row!.name).toBe(`只改名後-${s}`);
        expect(row!.description).toBe(`不該被清掉-${s}`);
        expect(row!.active).toBe(false);
      } finally {
        await admin.from(table).delete().eq('id', id);
      }
    });

    it('modal 只改說明 → 名稱與啟用維持現值', async () => {
      const s = suffix();
      const id = await create({
        name: `只改說明-${s}`, description: `舊說明-${s}`, active: false,
      });
      try {
        const res = await ownerA.put(`/api/${endpoint}/${id}`, { description: `新說明-${s}` });
        expect(res.status).toBe(200);

        const { data: row } = await admin
          .from(table).select('name, description, active').eq('id', id).single();
        expect(row!.description).toBe(`新說明-${s}`);
        expect(row!.name).toBe(`只改說明-${s}`);
        // 停用狀態不可因為「只是編輯了說明」就被打開
        expect(row!.active).toBe(false);
      } finally {
        await admin.from(table).delete().eq('id', id);
      }
    });

    it('說明清空（改成空字串）是有效的更新，不是「沒帶」', async () => {
      const s = suffix();
      const id = await create({ name: `清空說明-${s}`, description: `待清除-${s}`, active: true });
      try {
        // 使用者把說明欄刪光按儲存：這是真的要清掉，不是「不動」
        const res = await ownerA.put(`/api/${endpoint}/${id}`, { description: '' });
        expect(res.status).toBe(200);
        const { data: row } = await admin
          .from(table).select('description, active').eq('id', id).single();
        expect(row!.description).toBe('');
        expect(row!.active).toBe(true);
      } finally {
        await admin.from(table).delete().eq('id', id);
      }
    });

    it('modal 的儲存不動 sortOrder（排序走 reorder 端點，不開第二條寫入路徑）', async () => {
      const s = suffix();
      const id = await create({ name: `排序不歸 modal 管-${s}`, description: `說明-${s}` });
      try {
        const { data: before } = await admin
          .from(table).select('sort_order').eq('id', id).single();

        const res = await ownerA.put(`/api/${endpoint}/${id}`, {
          name: `改名-${s}`, description: `改說明-${s}`, active: false,
        });
        expect(res.status).toBe(200);

        const { data: after } = await admin
          .from(table).select('sort_order, name').eq('id', id).single();
        expect(after!.sort_order).toBe(before!.sort_order);
        expect(after!.name).toBe(`改名-${s}`);
      } finally {
        await admin.from(table).delete().eq('id', id);
      }
    });
  });
}

suite(
  '服務分類編輯 modal（PUT /api/service-categories/:id）',
  'service-categories',
  'service_categories',
);

suite(
  '商品分類編輯 modal（PUT /api/product-categories/:id）',
  'product-categories',
  'product_categories',
);
