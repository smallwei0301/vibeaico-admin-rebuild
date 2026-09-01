import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripDeparture } from '@/server/mappers';
import { departureUpdateSchema, timeValue } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
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

// DELETE is intentionally absent: order-aware departure deletion belongs to #8-B.
