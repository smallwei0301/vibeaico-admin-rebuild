import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/** PUT /api/service-categories/:id — 更新分類 metadata ⚙M（排序走 reorder 端點）。 */
const bodySchema = z.object({
  name: z.string().trim().min(1, '請輸入分類名稱').max(100).optional(),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: '至少提供一個要更新的欄位',
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());
  const updates: Record<string, string | boolean> = {};

  if (b.name !== undefined) updates.name = b.name;
  if (b.description !== undefined) updates.description = b.description;
  if (b.active !== undefined) updates.active = b.active;

  const { data, error } = await t.supabase
    .from('service_categories')
    .update(updates)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id, description, active')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  return ok({
    id: data.id,
    description: data.description ?? '',
    active: data.active ?? true,
  });
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
