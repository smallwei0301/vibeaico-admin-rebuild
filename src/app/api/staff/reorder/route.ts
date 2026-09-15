import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/staff/reorder — 04 §B-2。`{ids:[]}` 依序寫 sort_order=index。
 * 同 `service-categories/reorder` 的簡單模式（逐筆 update），不是
 * `services/reorder` 用的 `reorder_catalog_items` RPC —— staff 沒有
 * public/line 兩條 lane，不需要原子重排。`staff.sort_order` 欄位由既有
 * migration（0078 檔頭記載的原站欄位）提供，本端點不需新 migration。
 * 呼叫端必須送完整的目前排序清單（不支援部分 id）。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('staff').update({ sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
