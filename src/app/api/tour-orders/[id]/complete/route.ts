import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTourOrder } from '@/server/mappers';

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

  const { data: cur, error: rerr } = await t.supabase
    .from('tour_orders').select('status, departure_id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (rerr) throw rerr;
  if (!cur) return fail(404, '找不到此訂單', ERR.NOT_FOUND);
  if (cur.status === 'COMPLETED') return fail(409, '此訂單已結案', ERR.CONFLICT);
  if (cur.status === 'CANCELLED') return fail(409, '已取消的訂單無法結案', ERR.CONFLICT);
  if (cur.status !== 'CONFIRMED')
    return fail(409, '請先確認收款，再將訂單結案', ERR.CONFLICT);

  // C+ snapshot freezes at completion. Later reassignment of the departure must
  // never rewrite historical personal performance.
  const [{ data: addons, error: addonError }, { data: primary, error: primaryError }] = await Promise.all([
    t.supabase.from('tour_order_addons')
      .select('id, performance_mode, specific_staff_id, applied_amount')
      .eq('tenant_id', t.tenantId).eq('order_id', id),
    t.supabase.from('trip_departure_staff').select('staff_id')
      .eq('tenant_id', t.tenantId).eq('departure_id', cur.departure_id).eq('role', 'PRIMARY').maybeSingle(),
  ]);
  if (addonError) throw addonError;
  if (primaryError) throw primaryError;
  for (const addon of addons ?? []) {
    const performanceStaffId = addon.performance_mode === 'PRIMARY'
      ? primary?.staff_id ?? null
      : addon.performance_mode === 'SPECIFIC_STAFF' ? addon.specific_staff_id : null;
    const { error } = await t.supabase.from('tour_order_addons').update({
      performance_staff_id: performanceStaffId,
      performance_amount: performanceStaffId ? addon.applied_amount : null,
    }).eq('tenant_id', t.tenantId).eq('id', addon.id);
    if (error) throw error;
  }

  const { data, error } = await t.supabase.from('tour_orders')
    .update({ status: 'COMPLETED', updated_at: new Date().toISOString() })
    .eq('tenant_id', t.tenantId).eq('id', id)
    .select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此訂單', ERR.NOT_FOUND);

  return ok(mapTourOrder(data));
});
