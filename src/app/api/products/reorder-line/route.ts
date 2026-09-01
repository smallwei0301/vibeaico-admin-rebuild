import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/** POST /api/products/reorder-line — LINE 精選排序，寫 line_sort_order。 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const { ids } = bodySchema.parse(await req.json());

  for (let i = 0; i < ids.length; i++) {
    const { error } = await t.supabase
      .from('products')
      .update({ line_sort_order: i })
      .eq('id', ids[i])
      .eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
