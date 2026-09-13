import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/** GET /api/tour-orders/:id — 單筆詳情（讀取面同樣不帶 feature 閘門，見列表路由） */
export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  const { data, error } = await t.supabase.from('tour_orders').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  // 別家店的訂單回 404 而不是 403：403 會洩漏「這個 id 存在」。
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [data]);
  return ok(order);
});
