import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/services/reorder — `{ids:[]}` 依序寫 sort_order=index（04 分冊 §B-2，
 * 逐筆 update）。不在 ids 裡的列不動；.eq('tenant_id') 保證動不到別店資料。
 * ⚙M（比照 §B-3 products「同 services 模式 ⚙M」）。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('services').update({ sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
