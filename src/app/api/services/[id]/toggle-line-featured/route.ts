import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/services/:id/toggle-line-featured — 切換 line_featured 布林
 * （04 分冊 §B-2）。⚙M（比照 §B-3 products「同 services 模式 ⚙M」的整組寫入權限）。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;

  const { data: row, error: e0 } = await t.supabase
    .from('services')
    .select('id, line_featured')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此服務', ERR.NOT_FOUND);

  const next = !row.line_featured;
  const { error } = await t.supabase
    .from('services').update({ line_featured: next })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok({ lineFeatured: next });
});
