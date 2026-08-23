import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/product-categories/reorder — `{ids:[]}` 依序寫 sort_order = index
 * ⚙MANAGER（同 service-categories / products reorder 模式）。
 */
const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '請提供排序清單'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('product_categories').update({ sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
