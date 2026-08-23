import { ApiHttpError, ERR, handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/portfolios/:id/toggle-line-featured — 切換 line_featured 布林
 * （同 services 模式 ⚙M；0005 portfolios 的兩個 toggle 欄位之一）。
 * 寫入端點 requireFeature('PORTFOLIO_SHOWCASE')（09 分冊 §5）。
 */
export const POST = handle(async (_req, { params }) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const { id } = await params;

  const { data: row, error: e0 } = await t.supabase
    .from('portfolios')
    .select('id, line_featured')
    .eq('id', id).eq('tenant_id', t.tenantId)
    .maybeSingle();
  if (e0) throw e0;
  if (!row) throw new ApiHttpError(404, '找不到此作品', ERR.NOT_FOUND);

  const next = !row.line_featured;
  const { error } = await t.supabase
    .from('portfolios').update({ line_featured: next })
    .eq('id', id).eq('tenant_id', t.tenantId);
  if (error) throw error;

  return ok({ lineFeatured: next });
});
