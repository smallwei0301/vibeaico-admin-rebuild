import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/products/reorder — `{ids:[]}` 依序寫 sort_order = index ⚙MANAGER
 * （B-3：同 services 模式）。不在 ids 裡或不屬於本租戶的 id 靜默跳過
 * （update 帶 tenant 過濾，匹配不到列即無效果）。
 */
const bodySchema = z.object({
  ids: z.array(z.string().uuid()).min(1, '請提供排序清單'),
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PRODUCT_SALES');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('products').update({ sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
