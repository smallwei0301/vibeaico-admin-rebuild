import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant, requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripPlanSeason } from '@/server/mappers';
import { seasonCreateSchema } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

async function ownsPlan(t: Awaited<ReturnType<typeof requireTenant>>, planId: string) {
  const { data, error } = await t.supabase.from('trip_plans').select('id')
    .eq('tenant_id', t.tenantId).eq('id', planId).maybeSingle();
  if (error) throw error;
  return !!data;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  if (!await ownsPlan(t, id)) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_plan_seasons').select('*')
    .eq('tenant_id', t.tenantId).eq('plan_id', id).order('sort_order', { ascending: true });
  if (error) throw error;
  return ok((data ?? []).map(mapTripPlanSeason));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = seasonCreateSchema.parse(await req.json());
  if (!await ownsPlan(t, id)) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const { count, error } = await t.supabase.from('trip_plan_seasons')
      .select('id', { count: 'exact', head: true }).eq('tenant_id', t.tenantId).eq('plan_id', id);
    if (error) throw error;
    sortOrder = count ?? 0;
  }
  const { data, error } = await t.supabase.from('trip_plan_seasons').insert({
    tenant_id: t.tenantId,
    plan_id: id,
    name: body.name,
    start_month: body.startMonth,
    start_day: body.startDay,
    end_month: body.endMonth,
    end_day: body.endDay,
    price_override: body.priceOverride ?? null,
    active: body.active ?? true,
    sort_order: sortOrder,
  }).select('*').single();
  if (error) throw error;
  return ok(mapTripPlanSeason(data));
});
