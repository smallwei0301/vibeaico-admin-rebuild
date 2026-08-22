import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapProduct } from '@/server/mappers';

/**
 * GET /api/products — products join product_categories(name) → category_name。
 * 全量不分頁，sort_order asc（同 services 模式）。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('products')
    .select('*, product_categories(name)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapProduct({ ...r, category_name: r.product_categories?.name ?? null }),
    ),
  );
});
