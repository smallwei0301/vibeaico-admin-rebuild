import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { catalogReorderBodySchema, reorderCatalogItems } from '@/server/catalog-reorder';

/**
 * POST /api/services/reorder-line — `{ids:[]}` 依序寫 line_sort_order。
 * 公開頁排序仍由 /api/services/reorder 寫 sort_order；兩套順序不能互相覆蓋。
 */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { ids } = catalogReorderBodySchema.parse(await req.json());
  await reorderCatalogItems(t.supabase, t.tenantId, 'services', 'line', ids);

  return ok();
});
