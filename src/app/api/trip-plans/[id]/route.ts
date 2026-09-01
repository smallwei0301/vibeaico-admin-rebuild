import { handle, ok, fail, ERR } from '@/server/http';
import { requireTenantManager } from '@/server/tenant';
import { requireFeature } from '@/server/features';
import { mapTripPlan } from '@/server/mappers';
import { planPaymentError, planUpdateSchema } from '@/server/tour-domain';

type Context = { params: Promise<{ id: string }> };

export const PUT = handle(async (req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const body = planUpdateSchema.parse(await req.json());
  const { data: current, error: readError } = await t.supabase.from('trip_plans').select('*')
    .eq('tenant_id', t.tenantId).eq('id', id).maybeSingle();
  if (readError) throw readError;
  if (!current) return fail(404, '找不到此方案', ERR.NOT_FOUND);

  const minParty = body.minParty ?? current.min_party;
  const maxParty = body.maxParty ?? current.max_party;
  if (minParty > maxParty) return fail(400, '最高人數不得小於最低人數', ERR.VALIDATION);

  const paymentError = planPaymentError({
    pricePerPerson: body.pricePerPerson ?? Number(current.price_per_person),
    depositMode: body.depositMode ?? current.deposit_mode ?? 'FULL',
    depositValue: body.depositValue ?? Number(current.deposit_value ?? 0),
  });
  if (paymentError) return fail(400, paymentError, ERR.VALIDATION);

  const patch: Record<string, unknown> = {};
  if (body.name !== undefined) patch.name = body.name;
  if (body.description !== undefined) patch.description = body.description;
  if (body.pricePerPerson !== undefined) patch.price_per_person = body.pricePerPerson;
  if (body.childPrice !== undefined) patch.child_price = body.childPrice;
  if (body.minParty !== undefined) patch.min_party = body.minParty;
  if (body.maxParty !== undefined) patch.max_party = body.maxParty;
  if (body.depositMode !== undefined) patch.deposit_mode = body.depositMode;
  if (body.depositValue !== undefined) patch.deposit_value = body.depositValue;
  if (body.sortOrder !== undefined) patch.sort_order = body.sortOrder;
  if (body.active !== undefined) patch.active = body.active;
  if (Object.keys(patch).length === 0) return ok(mapTripPlan(current));

  const { data, error } = await t.supabase.from('trip_plans').update(patch)
    .eq('tenant_id', t.tenantId).eq('id', id).select('*').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  return ok(mapTripPlan(data));
});

export const DELETE = handle(async (_req, { params }: Context) => {
  const { id } = await params;
  const t = await requireTenantManager();
  await requireFeature(t.tenantId, 'TOUR_MODULE');
  const { data, error } = await t.supabase.from('trip_plans').delete()
    .eq('tenant_id', t.tenantId).eq('id', id).select('id').maybeSingle();
  if (error) throw error;
  if (!data) return fail(404, '找不到此方案', ERR.NOT_FOUND);
  return ok({ deleted: true });
});
