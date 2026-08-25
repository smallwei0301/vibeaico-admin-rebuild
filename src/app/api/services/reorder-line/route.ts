import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';

/**
 * POST /api/services/reorder-line — `{ids:[]}` 依序寫 line_sort_order=index ⚙M。
 *
 * 為什麼是獨立一支而不是給 /reorder 加參數（修復-7 / issue #15）：
 * 服務頁上的「公開頁排序」與「LINE 精選排序」是兩套各自獨立的順序，原站也是
 * 兩支端點（reorder / reorder-line）。兩套順序必須落在兩個欄位才可能互不干擾，
 * 而欄位既然分開，端點分開就讓「路由名 = 被寫的欄位」一眼可讀，也不必在 body
 * 裡加一個會被漏帶、漏帶就默默寫錯欄位的模式參數。
 * sort_order → 公開頁（/reorder，維持原行為）；line_sort_order → LINE 精選（本支）。
 * 不在 ids 裡的列不動；.eq('tenant_id') 保證動不到別店資料。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('services').update({ line_sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
