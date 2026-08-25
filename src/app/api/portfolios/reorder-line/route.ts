import { z } from 'zod';
import { handle, ok } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';

/**
 * POST /api/portfolios/reorder-line — `{ids:[]}` 依序寫 line_sort_order=index
 * ⚙M（requireFeature('PORTFOLIO_SHOWCASE')，同 /api/portfolios/reorder）。
 * 與 /api/services/reorder-line 同模式、同理由（見該檔註解）：
 * sort_order → 公開頁（/reorder）；line_sort_order → LINE 作品瀏覽（本支）。
 */
const bodySchema = z.object({ ids: z.array(z.string().uuid()).min(1, '請提供排序清單') });

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'PORTFOLIO_SHOWCASE');
  const b = bodySchema.parse(await req.json());

  for (let i = 0; i < b.ids.length; i++) {
    const { error } = await t.supabase
      .from('portfolios').update({ line_sort_order: i })
      .eq('id', b.ids[i]).eq('tenant_id', t.tenantId);
    if (error) throw error;
  }

  return ok();
});
