import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/products/:id/toggle-line-featured — 切換 line_featured ⚙MANAGER
 * （B-3：同 services 模式）。讀目前值取反寫回，回傳最新值。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { id } = await params;

  const { data: cur, error: rErr } = await t.supabase
    .from('products').select('line_featured')
    .eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (rErr) throw rErr;
  if (!cur) throw new ApiHttpError(404, '找不到此商品', ERR.NOT_FOUND);

  const next = !cur.line_featured;
  const { error } = await t.supabase
    .from('products').update({ line_featured: next })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok({ lineFeatured: next });
});
