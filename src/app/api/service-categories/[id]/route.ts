import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/service-categories/:id — 更新分類 ⚙M（排序走 reorder 端點，這裡不收 sortOrder）。
 *
 * 修改前只收 `{ name }`。migration 0018 讓 description / active 變成真欄位之後
 * （issue #28 第 ⑨ 筆），分類管理 modal 的「編輯」鈕切了 active 卻無處可送——
 * 它只改本地 state 就顯示「分類已更新」，重新整理全部還原（issue #28 第 ⑭ 筆）。
 *
 * 三個欄位都是 optional＝**只更新有帶的欄位**；沒帶的維持 DB 現值，不是重設為預設。
 * 所以只送 `{ name }` 的舊呼叫端行為完全不變。全部沒帶則視為無效請求（400），
 * 免得回一個什麼都沒做的 200 讓頁面顯示「已更新」。
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
    .from('service_categories').update(patch)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  return ok();
});

/**
 * DELETE /api/service-categories/:id — 真刪 ⚙M。
 * services.category_id 為 on delete set null（0004），分類刪除後服務自動變未分類。
 */
export const DELETE = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data, error } = await t.supabase
    .from('service_categories').delete()
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id').maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  return ok();
});
