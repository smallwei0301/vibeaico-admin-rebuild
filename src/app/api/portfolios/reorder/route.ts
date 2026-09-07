import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { reorderPortfolios } from '@/server/product-position';

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

  // issue #238：逐筆 update 在有 portfolios_tenant_sort_order_uq 的資料庫上，
  // 第一次迭代就撞 23505。改走 atomic RPC（先搬到高位區間再寫回）。
  await reorderPortfolios(t.supabase, t.tenantId, b.ids, 'public');

  return ok();
});
