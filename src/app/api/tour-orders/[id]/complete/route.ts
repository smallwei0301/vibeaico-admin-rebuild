import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { canTransitionTourOrder } from '@/server/tour-domain';
import { hydrateTourOrders } from '@/server/tour-orders';

type Context = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/:id/complete — 出團後標記完成（#8-B，10 分冊 §3）。
 *
 * `CONFIRMED → COMPLETED`（終態）。**不釋放名額**：團已經出過了，那個席次
 * 本來就被消耗掉，釋放會讓已客滿的團次看起來還有空位。
 */
export const POST = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');

  const { data: current, error: readError } = await t.supabase.from('tour_orders')
    .select('id, status').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  if (!canTransitionTourOrder(current.status, 'COMPLETED')) {
    return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  }

  const { data, error } = await t.supabase.from('tour_orders')
    .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId).eq('id', id).eq('status', current.status)
    .select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(409, '此訂單狀態已變更', ERR.CONFLICT);
  const [order] = await hydrateTourOrders(t.supabase, t.tenantId, [data]);
  return ok(order);
});
