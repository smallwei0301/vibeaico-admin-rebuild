import { z } from 'zod';
import { fail, ERR, handle, ok } from '@/server/http';
import { mapTourOrder } from '@/server/mappers';
import { createAdminSupabase } from '@/server/supabase';
import { requireTenant } from '@/server/tenant';

const bodySchema = z.object({
  departureId: z.string().uuid(), customerName: z.string().trim().min(1), customerPhone: z.string().trim().min(1),
  partySize: z.coerce.number().int().min(1), paymentMethodId: z.string().uuid().optional(), note: z.string().max(2_000).optional(),
});

/** The client supplies no price/status; create_tour_order owns price snapshots
 * and the capacity reservation in the same transaction. */
export const POST = handle(async (req) => {
  const t = await requireTenant('MANAGER');
  const body = bodySchema.parse(await req.json());
  const admin = createAdminSupabase();
  const created = await admin.rpc('create_tour_order', {
    p_tenant: t.tenantId, p_departure: body.departureId, p_party: body.partySize,
    p_customer_name: body.customerName, p_customer_phone: body.customerPhone, p_source: 'MANUAL',
    p_note: body.note ?? '', p_payment_method: body.paymentMethodId ?? null, p_customer: null, p_hold_expires: null,
  });
  if (created.error) {
    const message = created.error.message ?? '';
    if (message.includes('SEATS_UNAVAILABLE') || message.includes('PARTY_OVER_MAX')) return fail(409, '此團次名額不足或人數不符', ERR.CONFLICT);
    if (message.includes('DEPARTURE_NOT_FOUND') || message.includes('PLAN_NOT_FOUND')) return fail(404, '找不到可用團次', ERR.NOT_FOUND);
    throw created.error;
  }
  const { data, error } = await t.supabase.from('tour_orders').select('*, trips(title), trip_plans(name), trip_departures(departs_on, start_time)')
    .eq('tenant_id', t.tenantId).eq('id', created.data as string).maybeSingle();
  if (error) throw error;
  if (!data) return fail(500, '訂單建立後讀取失敗', ERR.INTERNAL);
  return ok(mapTourOrder(data));
});
