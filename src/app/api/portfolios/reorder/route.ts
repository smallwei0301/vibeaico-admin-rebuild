import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/portfolios/reorder — `{ids:[]}` 依序寫 sort_order=index
 * （同 services/reorder 模式 ⚙M；requireFeature('PORTFOLIO_SHOWCASE')）。
 * 不在 ids 裡的列不動；.eq('tenant_id') 保證動不到別店資料。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('portfolios').update({ sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
