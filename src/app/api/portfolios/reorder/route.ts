import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { catalogReorderBodySchema, reorderCatalogItems } from '@/server/catalog-reorder';

/**
 * POST /api/portfolios/reorder — `{ids:[]}` 以完整本租戶集合原子替換 sort_order。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const { ids } = catalogReorderBodySchema.parse(await req.json());
  await reorderCatalogItems(t.supabase, t.tenantId, 'portfolios', 'public', ids);

  return ok();
});
