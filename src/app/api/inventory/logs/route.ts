import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { pageRange, toPaged } from '@/server/paging';
import { mapInventoryLog } from '@/server/inventory-log';

const querySchema = z.object({
  page: z.coerce.number().int().min(0).default(0),
  size: z.coerce.number().int().min(1).max(100).default(20),
  productId: z.string().uuid().optional(),
});

export const GET = handle(async (req) => {
  const tenant = await requireTenant();
  await requireFeature(tenant.tenantId, 'INVENTORY');
  const queryParams = querySchema.parse(Object.fromEntries(new URL(req.url).searchParams));
  const { from, to, page, size } = pageRange(queryParams.page, queryParams.size);

  let query = tenant.supabase
    .from('inventory_logs')
    .select('*, products(name)', { count: 'exact' })
    .eq('tenant_id', tenant.tenantId)
    .order('created_at', { ascending: false })
    .range(from, to);
  if (queryParams.productId) query = query.eq('product_id', queryParams.productId);

  const { data, count, error } = await query;
  if (error) throw error;

  return ok(toPaged((data ?? []).map(mapInventoryLog), count, page, size));
});
