import { createAdminSupabase } from './supabase';
import {
  getLineCredentials,
  linePush,
  refundPushQuotaForBookingAddon,
  reservePushQuotaForBookingAddon,
} from './line';
import { ApiHttpError, ERR } from './http';
import type { BookingAddonNotifyOutcome } from '@/lib/types';

export type BookingAddonNotificationClassification =
  | 'DELIVERED'
  | 'NO_LINE'
  | 'NOT_CONFIGURED'
  | 'QUOTA_EXHAUSTED'
  | 'CONFIRMED_PROVIDER_REJECTION'
  | 'DB_UNAVAILABLE'
  | 'PROVIDER_AMBIGUOUS';

export type BookingAddonNotificationResult = {
  outcome: Exclude<BookingAddonNotifyOutcome, 'NONE'>;
  classification: BookingAddonNotificationClassification;
  /** True only when a confirmed provider rejection was successfully refunded. */
  quotaRefunded?: boolean;
};

function result(
  outcome: BookingAddonNotificationResult['outcome'],
  classification: BookingAddonNotificationClassification,
  extra: Pick<BookingAddonNotificationResult, 'quotaRefunded'> = {},
): BookingAddonNotificationResult {
  return { outcome, classification, ...extra };
}

function pending(
  tenantId: string,
  bookingId: string,
  classification: 'DB_UNAVAILABLE' | 'PROVIDER_AMBIGUOUS',
  error?: unknown,
): BookingAddonNotificationResult {
  if (error !== undefined)
    console.error('[booking-addon-notify] pending notification', tenantId, bookingId, classification, error);
  return result('PENDING', classification);
}

function isConfirmedProviderRejection(error: unknown): boolean {
  // lineFetch only assigns LINE_API_ERROR after receiving a concrete non-2xx
  // HTTP response. Fetch/network/timeout errors remain transport-ambiguous.
  return error instanceof ApiHttpError && error.code === ERR.LINE_API_ERROR;
}

/**
 * Attempt one receipt delivery after the route has atomically claimed it.
 * Database and transport uncertainty stays PENDING; only a concrete LINE
 * rejection may become FAILED, and only after its quota reservation is
 * confirmed refunded.
 */
export async function notifyBookingAddonReceipt(tenantId: string, params: {
  bookingId: string; item: { name: string; quantity: number; price: number };
  addonTotal: number; bookingTotal: number;
}): Promise<BookingAddonNotificationResult> {
  let admin: ReturnType<typeof createAdminSupabase>;
  try {
    admin = createAdminSupabase();
  } catch (error) {
    return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', error);
  }

  let booking!: { booking_no: string; customer_id: string };
  let customer!: { line_user_id: string | null };
  let tenant!: { name: string };
  try {
    const bookingQuery = await admin.from('bookings').select('booking_no, customer_id')
      .eq('id', params.bookingId).eq('tenant_id', tenantId).maybeSingle();
    if (bookingQuery.error || !bookingQuery.data)
      return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', bookingQuery.error);
    booking = bookingQuery.data as { booking_no: string; customer_id: string };

    const [customerQuery, tenantQuery] = await Promise.all([
      admin.from('customers').select('line_user_id').eq('id', booking.customer_id)
        .eq('tenant_id', tenantId).maybeSingle(),
      admin.from('tenants').select('name').eq('id', tenantId).maybeSingle(),
    ]);
    if (customerQuery.error || tenantQuery.error || !customerQuery.data || !tenantQuery.data)
      return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', customerQuery.error ?? tenantQuery.error);
    customer = customerQuery.data as { line_user_id: string | null };
    tenant = tenantQuery.data as { name: string };
  } catch (error) {
    return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', error);
  }

  if (!customer.line_user_id) return result('NO_LINE', 'NO_LINE');

  let token: string;
  try {
    ({ token } = await getLineCredentials(tenantId));
  } catch (error) {
    if (error instanceof ApiHttpError && error.code === ERR.LINE_NOT_CONFIGURED)
      return result('NOT_CONFIGURED', 'NOT_CONFIGURED');
    return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', error);
  }

  const reservation = await reservePushQuotaForBookingAddon(tenantId, 1);
  if (reservation.state === 'EXHAUSTED') return result('QUOTA_EXCEEDED', 'QUOTA_EXHAUSTED');
  if (reservation.state === 'UNKNOWN')
    return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', reservation.error);

  const itemTotal = params.item.price * params.item.quantity;
  const text = `【${tenant.name}】已為您登記加購項目\n預約編號：${booking.booking_no}\n` +
    `・${params.item.name} ×${params.item.quantity}　NT$ ${itemTotal.toLocaleString()}\n` +
    `本次加購：NT$ ${params.addonTotal.toLocaleString()}\n預約金額：NT$ ${params.bookingTotal.toLocaleString()}`;

  try {
    await linePush(token, customer.line_user_id, [{ type: 'text', text }]);
    return result('LINE', 'DELIVERED');
  } catch (error) {
    if (!isConfirmedProviderRejection(error))
      return pending(tenantId, params.bookingId, 'PROVIDER_AMBIGUOUS', error);

    // A concrete non-2xx LINE response means the provider rejected the
    // message. Refund exactly this reservation; if the refund is unknown,
    // keep the whole notification PENDING instead of settling FAILED.
    const refunded = await refundPushQuotaForBookingAddon(tenantId, reservation.month, reservation.count);
    if (!refunded)
      return pending(tenantId, params.bookingId, 'DB_UNAVAILABLE', error);
    return result('FAILED', 'CONFIRMED_PROVIDER_REJECTION', { quotaRefunded: true });
  }
}
