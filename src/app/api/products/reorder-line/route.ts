import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/products/reorder-line — `{ids:[]}` 依序寫 line_sort_order=index ⚙MANAGER。
 * 與 /api/services/reorder-line 同模式、同理由（見該檔註解）：
 * sort_order → 公開頁（/reorder）；line_sort_order → LINE 精選（本支），兩套排序
 * 各自落在自己的欄位，改動其一不會覆蓋另一套。
 * 不在 ids 裡或不屬於本租戶的 id 靜默跳過（update 帶 tenant 過濾）。
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
      .from('products').update({ line_sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
