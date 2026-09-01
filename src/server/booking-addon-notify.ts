import { createAdminSupabase } from './supabase';
import { getLineCredentials, linePush, consumePushQuota } from './line';
import { ApiHttpError, ERR } from './http';
import type { BookingAddonNotifyOutcome } from '@/lib/types';

/** Awaited receipt path: every result names what actually happened. */
export async function notifyBookingAddonReceipt(tenantId: string, params: {
  bookingId: string; item: { name: string; quantity: number; price: number };
  addonTotal: number; bookingTotal: number;
}): Promise<BookingAddonNotifyOutcome> {
  try {
    const admin = createAdminSupabase();
    const { data: booking } = await admin.from('bookings').select('booking_no, customer_id')
      .eq('id', params.bookingId).eq('tenant_id', tenantId).maybeSingle();
    if (!booking) return 'FAILED';
    const [{ data: customer }, { data: tenant }] = await Promise.all([
      admin.from('customers').select('line_user_id').eq('id', booking.customer_id)
        .eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (!customer?.line_user_id) return 'NO_LINE';
    let token: string;
    try { ({ token } = await getLineCredentials(tenantId)); }
    catch (e) {
      if (e instanceof ApiHttpError && e.code === ERR.LINE_NOT_CONFIGURED) return 'NOT_CONFIGURED';
      throw e;
    }
    if (!(await consumePushQuota(tenantId, 1))) return 'QUOTA_EXCEEDED';
    const itemTotal = params.item.price * params.item.quantity;
    const text = `【${tenant?.name ?? ''}】已為您登記加購項目\n預約編號：${booking.booking_no}\n` +
      `・${params.item.name} ×${params.item.quantity}　NT$ ${itemTotal.toLocaleString()}\n` +
      `本次加購：NT$ ${params.addonTotal.toLocaleString()}\n預約金額：NT$ ${params.bookingTotal.toLocaleString()}`;
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
    return 'LINE';
  } catch (e) {
    console.error('[booking-addon-notify] receipt failed', tenantId, params.bookingId, e);
    return 'FAILED';
  }
}
