import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripDeparture } from '@/server/mappers';
import { dateRange, dateRangeLength, departureBatchSchema, timeValue } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };
const MAX_DAYS = 366;

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = departureBatchSchema.parse(await req.json());
  const rangeLength = dateRangeLength(body.from, body.to);
  if (rangeLength > MAX_DAYS) return fail(400, `批次開團最多一次 ${MAX_DAYS} 天`, ERR.VALIDATION);
  const dates = dateRange(body.from, body.to);
  const { data: plan, error: planError } = await t.supabase.from('trip_plans').select('id, trip_id')
    .eq('tenant_id', t.tenantId).eq('id', body.planId).maybeSingle();
  if (planError) throw planError;
  if (!plan || plan.trip_id !== id) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const selected = dates.filter((date) => {
    const day = new Date(`${date}T00:00:00Z`).getUTCDay();
    return body.weekdays.includes(day);
  });
  const createdIds: string[] = [];
  let skipped = 0;
  for (const date of selected) {
    let existingQuery = t.supabase.from('trip_departures').select('id')
      .eq('tenant_id', t.tenantId).eq('plan_id', body.planId).eq('departs_on', date);
    existingQuery = body.startTime
      ? existingQuery.eq('start_time', timeValue(body.startTime))
      : existingQuery.is('start_time', null);
    const { data: existing, error: existingError } = await existingQuery.maybeSingle();
    if (existingError) throw existingError;
    if (existing) {
      skipped += 1;
      continue;
    }
    const { data, error } = await t.supabase.from('trip_departures').insert({
      tenant_id: t.tenantId, trip_id: id, plan_id: body.planId, departs_on: date,
      start_time: timeValue(body.startTime), capacity: body.capacity, status: 'OPEN', note: '',
    }).select('id').maybeSingle();
    if (error?.code === '23505') {
      skipped += 1;
      continue;
    }
    if (error) throw error;
    if (data) createdIds.push(data.id);
  }

  const { data: rows, error } = createdIds.length === 0
    ? { data: [], error: null }
    : await t.supabase.from('trip_departures').select('*, trip_plans(name)')
      .eq('tenant_id', t.tenantId).in('id', createdIds);
  if (error) throw error;
  return ok({
    created: createdIds.length,
    skipped,
    conflicts: [],
    departures: (rows ?? []).map(mapTripDeparture),
  });
});
