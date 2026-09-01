import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripPlan } from '@/server/mappers';
import { planCreateSchema, planRow } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

async function requireTrip(t: Awaited<ReturnType<typeof requireTenant>>, id: string) {
  const { data, error } = await t.supabase.from('trips').select('id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  return true;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  if (!await requireTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_plans').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id).order('sort_order', { ascending: true });
  if (error) throw error;
  return ok((data ?? []).map(mapTripPlan));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  const body = planCreateSchema.parse(await req.json());
  if (!await requireTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { count, error: countError } = await t.supabase.from('trip_plans')
    .select('id', { count: 'exact', head: true }).eq('tenant_id', t.tenantId).eq('trip_id', id);
  if (countError) throw countError;
  const { data, error } = await t.supabase.from('trip_plans')
    .insert(planRow(body, t.tenantId, id, count ?? 0)).select('*').single();
  if (error) throw error;
  return ok(mapTripPlan(data));
});
