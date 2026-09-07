import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { departureUpdateSchema, timeValue } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureUpdateSchema.parse(await req.json());
  const { data: current, error: readError } = await t.supabase.from('trip_departures').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (body.capacity !== undefined && body.capacity < current.seats_booked) {
    return fail(409, `名額不得少於已報名人數（${current.seats_booked} 人）`, ERR.CONFLICT);
  }
  if (body.planId !== undefined) {
    const { data: plan, error } = await t.supabase.from('trip_plans').select('id, trip_id')
      .eq('tenant_id', t.tenantId).eq('id', body.planId).maybeSingle();
    if (error) throw error;
    if (!plan || plan.trip_id !== current.trip_id) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  }
  const patch: Record<string, unknown> = {};
  if (body.planId !== undefined) patch.plan_id = body.planId;
  if (body.departsOn !== undefined) patch.departs_on = body.departsOn;
  if (body.startTime !== undefined) patch.start_time = timeValue(body.startTime);
  if (body.capacity !== undefined) patch.capacity = body.capacity;
  if (body.status !== undefined) patch.status = body.status;
  if (body.note !== undefined) patch.note = body.note;
  const { data, error } = await t.supabase.from('trip_departures').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id).select('*, trip_plans(name)').maybeSingle();
  if (error?.code === '23505') return fail(409, '相同方案、日期與時間的團次已存在', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  return ok(mapTripDeparture(data));
});

/**
 * 團次刪除。
 *
 * 這支端點原本刻意留白（註解寫著「order-aware departure deletion belongs to #8-B」），
 * 但頁面上的刪除鍵並沒有跟著停用——它只是 `setDepartures(filter)` 再報「團次已刪除」，
 * 店家重新整理團次就回來了。留著一顆假成功比缺一支端點更糟，所以這一輪把它補上。
 *
 * 它**不需要** `tour_orders`：`seats_booked` 是 `reserve_seats` 維護的權威計數器，
 * 同一支路由的 PUT 早就拿它當不變量用（`body.capacity < current.seats_booked` → 409）。
 * 這裡沿用同一個判準——已經有人報名的團次不得刪除，回 409 而不是靜默把名額吃掉。
 * `tour_orders` 落地後（#8-B）可以在此之上再加「連帶處理已存在訂單」的規則，
 * 但那是擴充，不是推翻：seats_booked > 0 不能刪，兩個階段都成立。
 */
export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data: current, error: readError } = await t.supabase.from('trip_departures')
    .select('id, seats_booked').eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  if (current.seats_booked > 0) {
    return fail(409, `已有 ${current.seats_booked} 人報名，無法刪除此團次`, ERR.CONFLICT);
  }
  const { data, error } = await t.supabase.from('trip_departures').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此團次', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
