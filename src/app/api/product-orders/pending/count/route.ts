// GET /api/product-orders/pending/count — `{count}`（Topbar 徽章，B-3）。
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

export const GET = handle(async () => {
  const t = await requireTenant();
  const { count, error } = await t.supabase
    .from('product_orders')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', t.tenantId)
    .eq('status', 'PENDING');
  if (error) throw error;
  return ok({ count: count ?? 0 });
});
