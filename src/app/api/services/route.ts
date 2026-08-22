import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapService } from '@/server/mappers';

/**
 * GET /api/services — services join service_categories(name) → category_name。
 * 全量不分頁，sort_order asc。
 */
export const GET = handle(async () => {
  const t = await requireTenant();

  const { data, error } = await t.supabase
    .from('services')
    .select('*, service_categories(name)')
    .eq('tenant_id', t.tenantId)
    .order('sort_order', { ascending: true });
  if (error) throw error;

  return ok(
    data.map((r: any) =>
      mapService({ ...r, category_name: r.service_categories?.name ?? null }),
    ),
  );
});
