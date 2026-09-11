import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { reorderPortfolios } from '@/server/product-position';

/**
 * POST /api/portfolios/reorder-line — `{ids:[]}` 依序寫 line_sort_order=index
 * （LINE 作品瀏覽選單的獨立排序，0075 補上的 line_sort_order 欄位）。
 * 純應用層 UPDATE，逐一比照 /api/portfolios/reorder 的寫法，不建立任何
 * function/RPC/trigger。不在 ids 裡的列不動；.eq('tenant_id') 保證動不到
 * 別店資料。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const b = bodySchema.parse(await req.json());

  // issue #238：同上，但改的是 LINE lane（line_sort_order）。
  await reorderPortfolios(t.supabase, t.tenantId, b.ids, 'line');

  return ok();
});
