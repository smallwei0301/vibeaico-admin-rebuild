import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { departureCreateSchema, timeValue } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

async function findTripPlan(t: Awaited<ReturnType<typeof requireTenant>>, tripId: string, planId: string) {
  const { data, error } = await t.supabase.from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (error) throw error;
  return data && data.trip_id === tripId ? data : null;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  const { data: trip, error: tripError } = await t.supabase.from('trips').select('id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (tripError) throw tripError;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_departures')
    .select('*, trip_plans(name)').eq('tenant_id', t.tenantId).eq('trip_id', id)
    .order('departs_on', { ascending: true }).order('start_time', { ascending: true, nullsFirst: true });
  if (error) throw error;
  return ok((data ?? []).map(mapTripDeparture));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureCreateSchema.parse(await req.json());
  if (!await findTripPlan(t, id, body.planId)) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_departures').insert({
    tenant_id: t.tenantId,
    trip_id: id,
    plan_id: body.planId,
    departs_on: body.departsOn,
    start_time: timeValue(body.startTime),
    capacity: body.capacity,
    status: body.status ?? 'OPEN',
    note: body.note ?? '',
  }).select('*, trip_plans(name)').single();
  if (error?.code === '23505') return fail(409, '相同方案、日期與時間的團次已存在', ERR.CONFLICT);
  if (error) throw error;
  return ok(mapTripDeparture(data));
});
