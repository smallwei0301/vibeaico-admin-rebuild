import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { catalogReorderBodySchema, reorderCatalogItems } from '@/server/catalog-reorder';

/**
 * POST /api/products/reorder — `{ids:[]}` 以完整本租戶集合原子替換 sort_order。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { ids } = catalogReorderBodySchema.parse(await req.json());
  await reorderCatalogItems(t.supabase, t.tenantId, 'products', 'public', ids);

  return ok();
});
