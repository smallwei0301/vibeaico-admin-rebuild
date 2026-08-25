import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/product-categories/:id — 更新分類 ⚙MANAGER（同 service-categories 模式）。
 *
 * 修改前只收 `{ name }`；0018 之後 description / active 是真欄位，分類管理的
 * 「編輯」鈕卻仍只切本地 state 就顯示「分類已更新」（issue #28 第 ⑭ 筆）。
 * 排序走 reorder 端點，這裡刻意不收 sortOrder，避免兩條路徑各寫各的。
 *
 * 三個欄位都是 optional＝只更新有帶的欄位；沒帶的維持現值（舊呼叫端只送 name
 * 時行為完全不變）。全部沒帶＝400，不回一個什麼都沒做的 200。
 */
const bodySchema = z.object({
  name: z.string().min(1, '請輸入分類名稱').optional(),
  description: z.string().max(500).optional(),
  active: z.boolean().optional(),
}).refine(
  (b) => b.name !== undefined || b.description !== undefined || b.active !== undefined,
  { message: '沒有要更新的欄位' },
);

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const patch: Record<string, unknown> = {};
  if (b.name !== undefined) patch.name = b.name;
  if (b.description !== undefined) patch.description = b.description;
  if (b.active !== undefined) patch.active = b.active;

  const { data, error } = await t.supabase
    .from('product_categories')
    .update(patch)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  return ok();
});

/**
 * DELETE /api/product-categories/:id — ⚙MANAGER。products.category_id 的 FK 是
 * on delete set null，直接真刪即可，底下商品自動變「未分類」。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: existing, error: e0 } = await t.supabase
    .from('product_categories')
    .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (e0) throw e0;
  if (!existing) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  const { error } = await t.supabase
    .from('product_categories').delete().eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok();
});
