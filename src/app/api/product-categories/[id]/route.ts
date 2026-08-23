import { z } from 'zod';
import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * PUT /api/product-categories/:id — 改名 ⚙MANAGER（同 service-categories 模式）。
 */
const bodySchema = z.object({ name: z.string().min(1, '請輸入分類名稱') });

export const PUT = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());

  const { data, error } = await t.supabase
    .from('product_categories')
    .update({ name: b.name })
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
