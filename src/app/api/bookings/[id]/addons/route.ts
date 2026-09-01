import { z } from 'zod';
import { handle, ok, ApiHttpError, ERR } from '@/server/http';
import { requireTenant } from '@/server/tenant';
import { mapBookingAddon } from '@/server/mappers';
import { notifyBookingAddonReceipt } from '@/server/booking-addon-notify';
import { createAdminSupabase } from '@/server/supabase';

const bodySchema = z.object({
  serviceId: z.string().uuid().optional(),
  name: z.string().trim().min(1).max(160),
  price: z.number().finite().min(0),
  quantity: z.number().int().min(1).max(100),
  durationMinutes: z.number().int().min(0).max(1440),
  staffId: z.string().uuid().optional(),
  noPersonalCredit: z.boolean().default(false),
  notify: z.boolean().default(false),
});

function rpcError(error: any): never {
  const message = String(error?.message ?? '');
  if (error?.code === '23P01')
    throw new ApiHttpError(409, '加購後時段與既有預約重疊，資料未變更', ERR.CONFLICT);
  if (message.includes('FORBIDDEN')) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  if (message.includes('NOT_FOUND')) throw new ApiHttpError(404, '找不到預約或加購資源', ERR.NOT_FOUND);
  if (message.includes('STATUS_CONFLICT')) throw new ApiHttpError(409, '此預約目前不可加購', ERR.CONFLICT);
  if (message.includes('INVALID')) throw new ApiHttpError(400, '加購資料不合法', ERR.VALIDATION);
  throw error;
}

export const GET = handle(async (_req, { params }) => {
  const t = await requireTenant();
  const { id } = await params;
  const { data: booking, error: bookingError } = await t.supabase.from('bookings')
    .select('id').eq('id', id).eq('tenant_id', t.tenantId).maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking) throw new ApiHttpError(404, '找不到此預約', ERR.NOT_FOUND);
  const { data, error } = await t.supabase.from('booking_addons')
    .select('id, service_id, name, price, quantity, duration_minutes, staff_id, applied_amount, applied_minutes, notified, performance_mode, performance_staff_id, created_at, staff:staff_id(name)')
    .eq('tenant_id', t.tenantId).eq('booking_id', id).order('created_at');
  if (error) throw error;
  return ok((data ?? []).map(mapBookingAddon));
});

export const POST = handle(async (req, { params }) => {
  const t = await requireTenant('MANAGER');
  const { id } = await params;
  const b = bodySchema.parse(await req.json());
  const { data: result, error } = await t.supabase.rpc('add_booking_addon_17', {
    p_tenant_id: t.tenantId, p_booking_id: id, p_service_id: b.serviceId ?? null,
    p_name: b.name, p_price: b.price, p_quantity: b.quantity,
    p_duration_minutes: b.durationMinutes, p_staff_id: b.staffId ?? null,
    p_no_personal_credit: b.noPersonalCredit,
  });
  if (error) rpcError(error);
  const addonId = result?.[0]?.addon_id;
  if (!addonId) throw new ApiHttpError(500, '加購交易未回傳項目', ERR.INTERNAL);
  const { data: addon, error: addonError } = await t.supabase.from('booking_addons')
    .select('id, service_id, name, price, quantity, duration_minutes, staff_id, applied_amount, applied_minutes, notified, performance_mode, performance_staff_id, created_at, staff:staff_id(name)')
    .eq('tenant_id', t.tenantId).eq('booking_id', id).eq('id', addonId).maybeSingle();
  if (addonError) throw addonError;
  if (!addon) throw new ApiHttpError(500, '加購交易結果無法讀取', ERR.INTERNAL);
  let notified: import('@/lib/types').BookingAddonNotifyOutcome = 'NONE';
  if (b.notify) {
    const appliedAmount = b.price * b.quantity;
    notified = await notifyBookingAddonReceipt(t.tenantId, {
      bookingId: id, item: { name: b.name, quantity: b.quantity, price: b.price },
      addonTotal: appliedAmount, bookingTotal: Number(result[0].final_price),
    });
    const { error: notificationError } = await createAdminSupabase().rpc('mark_booking_addon_notification_17', {
      p_tenant_id: t.tenantId, p_booking_id: id, p_addon_id: addonId, p_notified: notified,
    });
    if (notificationError) throw notificationError;
  }
  const responseAddon = mapBookingAddon({ ...addon, notified });
  if (notified === 'QUOTA_EXCEEDED')
    throw new ApiHttpError(409, '加購已新增，但本月推播額度已用完，未送出消費明細', ERR.CONFLICT, { persisted: true });
  return ok({ addon: responseAddon, finalPrice: Number(result[0].final_price),
    durationMinutes: Number(result[0].duration_minutes), endAt: result[0].end_at, notified });
});
