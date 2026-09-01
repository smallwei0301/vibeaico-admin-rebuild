import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant, requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripAddon } from '@/server/mappers';
import { addonCreateSchema } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

async function ownsTrip(t: Awaited<ReturnType<typeof requireTenant>>, id: string) {
  const { data, error } = await t.supabase.from('trips').select('id')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (error) throw error;
  return !!data;
}

export const GET = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant();
  if (!await ownsTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('trip_addons').select('*')
    .eq('tenant_id', t.tenantId).eq('trip_id', id).order('sort_order', { ascending: true });
  if (error) throw error;
  return ok((data ?? []).map(mapTripAddon));
});

export const POST = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = addonCreateSchema.parse(await req.json());
  if (!await ownsTrip(t, id)) return fail(404, '找不到此行程', ERR.NOT_FOUND);
  let sortOrder = body.sortOrder;
  if (sortOrder === undefined) {
    const { count, error } = await t.supabase.from('trip_addons').select('id', { count: 'exact', head: true })
      .eq('tenant_id', t.tenantId).eq('trip_id', id);
    if (error) throw error;
    sortOrder = count ?? 0;
  }
  const { data, error } = await t.supabase.from('trip_addons').insert({
    tenant_id: t.tenantId, trip_id: id, name: body.name, price: body.price ?? 0,
    unit: body.unit ?? 'PER_PERSON', stock: body.stock ?? null, active: body.active ?? true,
    sort_order: sortOrder,
  }).select('*').single();
  if (error) throw error;
  return ok(mapTripAddon(data));
});
