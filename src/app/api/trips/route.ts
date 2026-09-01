import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTrip } from '@/server/mappers';
import { tripCreateSchema, tripRow } from '@/server/tour-domain';
import { taipeiTodayDateString } from '@/server/tz';

export const GET = handle(async () => {
  const t = await requireTenant();
  const { data, error } = await t.supabase
    .from('trips')
    .select('*, trip_plans(price_per_person, active), trip_departures(departs_on, status)')
    .eq('tenant_id', t.tenantId)
    .order('updated_at', { ascending: false });
  if (error) throw error;

  const today = taipeiTodayDateString();
  return ok((data ?? []).map((row: any) => {
    const plans = Array.isArray(row.trip_plans) ? row.trip_plans : [];
    const departures = Array.isArray(row.trip_departures) ? row.trip_departures : [];
    const prices = plans.filter((p: any) => p.active).map((p: any) => Number(p.price_per_person));
    return mapTrip(row, {
      planCount: plans.length,
      minPrice: prices.length ? Math.min(...prices) : 0,
      upcomingDepartureCount: departures.filter(
        (d: any) => d.status === 'OPEN' && String(d.departs_on) >= today,
      ).length,
    });
  }));
});

export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = tripCreateSchema.parse(await req.json());
  const { data, error } = await t.supabase
    .from('trips')
    .insert(tripRow(body, t.tenantId))
    .select('*')
    .single();
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error) throw error;
  return ok(mapTrip(data));
});
