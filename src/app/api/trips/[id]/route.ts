import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTrip, mapTripPlan } from '@/server/mappers';
import { tripUpdateSchema } from '@/server/tour-domain';
import { taipeiTodayDateString } from '@/server/tz';

type Context = { params: Promise<{ id: string }> };

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data: trip, error } = await t.supabase.from('trips').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!trip) return fail(404, '找不到此行程', ERR.NOT_FOUND);

  const [{ data: plans, error: planError }, { count: upcoming, error: departureError }] = await Promise.all([
    t.supabase.from('trip_plans').select('*').eq('tenant_id', t.tenantId).eq('trip_id', id)
      .order('sort_order', { ascending: true }),
    t.supabase.from('trip_departures').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('trip_id', id).eq('status', 'OPEN')
      .gte('departs_on', taipeiTodayDateString()),
  ]);
  if (planError) throw planError;
  if (departureError) throw departureError;
  const rows = plans ?? [];
  const prices = rows.filter((p: any) => p.active).map((p: any) => Number(p.price_per_person));
  return ok({
    trip: mapTrip(trip, {
      planCount: rows.length,
      minPrice: prices.length ? Math.min(...prices) : 0,
      upcomingDepartureCount: upcoming ?? 0,
    }),
    plans: rows.map(mapTripPlan),
  });
});

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = tripUpdateSchema.parse(await req.json());
  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = body.title;
  if (body.slug !== undefined) patch.slug = body.slug;
  if (body.summary !== undefined) patch.summary = body.summary;
  if (body.description !== undefined) patch.description = body.description;
  if (body.coverImageUrl !== undefined) patch.cover_image_url = body.coverImageUrl;
  if (body.gallery !== undefined) patch.gallery = body.gallery;
  if (body.location !== undefined) patch.location = body.location;
  if (body.durationHours !== undefined) patch.duration_hours = body.durationHours;
  if (body.meetingPoint !== undefined) patch.meeting_point = body.meetingPoint;
  if (body.includes !== undefined) patch.includes = body.includes;
  if (body.notes !== undefined) patch.notes = body.notes;
  if (Object.keys(patch).length === 0) {
    const { data, error } = await t.supabase.from('trips').select('*')
      .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);
    return ok(mapTrip(data));
  }

  const { data, error } = await t.supabase.from('trips').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error?.code === '23505') return fail(409, '此行程代碼已被使用', ERR.CONFLICT);
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  return ok(mapTrip(data));
});

export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data, error } = await t.supabase.from('trips').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
