import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/services/reorder-line — `{ids:[]}` 依序寫 line_sort_order。
 * 公開頁排序仍由 /api/services/reorder 寫 sort_order；兩套順序不能互相覆蓋。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const { ids } = bodySchema.parse(await req.json());

  for (let i = 0; i < ids.length; i++) {
    const { error } = await t.supabase
      .from('services')
      .update({ line_sort_order: i })
      .eq('id', ids[i])
      .eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
