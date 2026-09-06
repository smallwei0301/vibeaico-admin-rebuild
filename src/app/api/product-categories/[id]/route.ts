import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/product-categories/:id — 更新分類 metadata ⚙MANAGER（排序也可明確更新）。
 */
const bodySchema = z.object({
  name: z.string().trim().min(1, '請輸入分類名稱').max(100).optional(),
  description: z.string().trim().max(500).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
}).refine((body) => Object.keys(body).length > 0, {
  message: '至少提供一個要更新的欄位',
});

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());
  const updates: Record<string, string | number | boolean> = {};

  if (b.name !== undefined) updates.name = b.name;
  if (b.description !== undefined) updates.description = b.description;
  if (b.active !== undefined) updates.active = b.active;
  if (b.sortOrder !== undefined) updates.sort_order = b.sortOrder;

  const { data, error } = await t.supabase
    .from('product_categories')
    .update(updates)
    .eq('id', id).eq('tenant_id', t.tenantId)
    .select('id, description, active, sort_order')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new ApiHttpError(404, '找不到此分類', ERR.NOT_FOUND);

  return ok({
    id: data.id,
    description: data.description ?? '',
    active: data.active ?? true,
    sortOrder: data.sort_order,
  });
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
