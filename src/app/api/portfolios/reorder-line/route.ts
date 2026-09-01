import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/** POST /api/portfolios/reorder-line — LINE 作品排序，寫 line_sort_order。 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const { ids } = bodySchema.parse(await req.json());

  for (let i = 0; i < ids.length; i++) {
    const { error } = await t.supabase
      .from('portfolios')
      .update({ line_sort_order: i })
      .eq('id', ids[i])
      .eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
