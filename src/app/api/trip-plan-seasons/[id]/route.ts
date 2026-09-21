import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripPlanSeason } from '@/server/mappers';
import { seasonUpdateSchema } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = seasonUpdateSchema.parse(await req.json());
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.startMonth !== undefined) patch.start_month = body.startMonth;
  if (body.startDay !== undefined) patch.start_day = body.startDay;
  if (body.endMonth !== undefined) patch.end_month = body.endMonth;
  if (body.endDay !== undefined) patch.end_day = body.endDay;
  if (body.priceOverride !== undefined) patch.price_override = body.priceOverride;
  if (body.active !== undefined) patch.active = body.active;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
  if (Object.keys(patch).length === 0) {
    const { data, error } = await t.supabase.from('trip_plan_seasons').select('*')
      .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(404, '找不到此季節', ERR.NOT_FOUND);
    return ok(mapTripPlanSeason(data));
  }
  const { data, error } = await t.supabase.from('trip_plan_seasons').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此季節', ERR.NOT_FOUND);
  return ok(mapTripPlanSeason(data));
});

export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data, error } = await t.supabase.from('trip_plan_seasons').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此季節', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
