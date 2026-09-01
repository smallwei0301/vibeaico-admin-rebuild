import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapTripAddon } from '@/server/mappers';
import { addonUpdateSchema } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  const body = addonUpdateSchema.parse(await req.json());
  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.price !== undefined) patch.price = body.price;
  if (body.unit !== undefined) patch.unit = body.unit;
  if (body.stock !== undefined) patch.stock = body.stock;
  if (body.active !== undefined) patch.active = body.active;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
  if (Object.keys(patch).length === 0) {
    const { data, error } = await t.supabase.from('trip_addons').select('*')
      .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
    if (error) throw error;
    if (!data) return fail(404, '找不到此加購項', ERR.NOT_FOUND);
    return ok(mapTripAddon(data));
  }
  const { data, error } = await t.supabase.from('trip_addons').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此加購項', ERR.NOT_FOUND);
  return ok(mapTripAddon(data));
});

export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenant('MANAGER');
  const { data, error } = await t.supabase.from('trip_addons').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此加購項', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
