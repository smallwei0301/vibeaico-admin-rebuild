import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTourOrder } from '@/server/mappers';
import { throwAvailabilityRpcError } from '@/server/availability-rpc';

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/tour-orders/[id]/complete — 出團後結案 ⚙M（10 分冊 §3 狀態機）。
 *
 * `CONFIRMED → COMPLETED` 是唯一合法的轉移：
 * - PENDING（尚未確認收款）直接結案會讓一筆未收款的訂單變成已完成，
 *   月營收統計就會少一筆卻看不出來 → 409，請先確認收款。
 * - CANCELLED 已釋放名額 → 409。
 * - 已 COMPLETED 重複按 → 409（不是靜默成功）。
 *
 * **不釋放名額**：團出過了，那個名額就是被用掉的，不該回到可售數量。
 */
export const POST = handle(async (_req, ctx: Ctx) => {
  const { id } = await ctx.params;
  const t = await requireTenant('MANAGER');

  const { data: completedId, error: rpcError } = await t.supabase.rpc('complete_tour_order_with_performance', {
    p_tenant: t.tenantId, p_order_id: id,
  });
  if (rpcError) throwAvailabilityRpcError(rpcError);

  const { data, error } = await t.supabase.from('tour_orders')
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .eq('tenant_id', t.tenantId).eq('id', completedId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  return ok(mapTourOrder(data));
});
