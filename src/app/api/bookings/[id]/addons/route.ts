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
  /** Stable across a client retry; the RPC binds it to this booking mutation. */
  idempotencyKey: z.string().uuid(),
});

type AddonNotifyOutcome = import('@/lib/types').BookingAddonNotifyOutcome;

function throwPendingNotification(): never {
  throw new ApiHttpError(
    409,
    '加購已新增，但 LINE 通知狀態不明；為避免重複推播，未重送通知，請聯絡管理者確認',
    ERR.CONFLICT,
    { persisted: true, notificationPending: true },
  );
}

function throwNotificationStateFailure(
  phase: 'claim' | 'marker', tenantId: string, bookingId: string, addonId: string, error: unknown,
): never {
  // Keep the provider/DB error in server logs, but do not expose it to the
  // tenant.  The persisted flag tells the UI not to submit a new key.
  console.error(`[api] booking-addon notification ${phase} failed`, tenantId, bookingId, addonId, error);
  throw new ApiHttpError(
    500,
    '加購已建立，但 LINE 通知狀態無法安全確認；為避免重複推播，未重送通知，請聯絡管理者確認',
    ERR.INTERNAL,
    { persisted: true, notificationPending: true },
  );
}

function throwMarkerFailure(tenantId: string, bookingId: string, addonId: string, error: unknown): never {
  return throwNotificationStateFailure('marker', tenantId, bookingId, addonId, error);
}

function rpcError(error: any): never {
  const message = String(error?.message ?? '');
  if (error?.code === '23P01')
    throw new ApiHttpError(409, '加購後時段與既有預約重疊，資料未變更', ERR.CONFLICT);
  if (message.includes('FORBIDDEN')) throw new ApiHttpError(403, '權限不足', ERR.FORBIDDEN);
  if (message.includes('NOT_FOUND')) throw new ApiHttpError(404, '找不到預約或加購資源', ERR.NOT_FOUND);
  if (message.includes('IDEMPOTENCY_CONFLICT'))
    throw new ApiHttpError(409, '相同的重試鍵已對應其他加購內容，資料未變更', ERR.CONFLICT);
  if (message.includes('IDEMPOTENCY_RETIRED'))
    throw new ApiHttpError(409, '相同的重試鍵已對應已刪除的加購，未重新建立項目', ERR.CONFLICT, { idempotencyRetired: true });
  if (message.includes('STATUS_CONFLICT')) throw new ApiHttpError(409, '此預約目前不可加購', ERR.CONFLICT);
  if (message.includes('INVALID')) throw new ApiHttpError(400, '加購資料不合法', ERR.VALIDATION);
  throw error;
}

const settledOutcomes = new Set<AddonNotifyOutcome>([
  'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED',
]);

function claimRowOrPending(value: unknown, tenantId: string, bookingId: string, addonId: string) {
  if (!Array.isArray(value) || value.length !== 1) {
    console.error('[api] booking-addon notification claim cardinality is ambiguous', {
      tenantId, bookingId, addonId, rows: Array.isArray(value) ? value.length : 'non-array',
    });
    throwPendingNotification();
  }
  const row = value[0] as { claimed?: unknown; notified?: unknown };
  if (typeof row.claimed !== 'boolean' || typeof row.notified !== 'string') {
    console.error('[api] booking-addon notification claim shape is ambiguous', {
      tenantId, bookingId, addonId, row,
    });
    throwPendingNotification();
  }
  const notified = row.notified as AddonNotifyOutcome;
  if (notified !== 'PENDING' && notified !== 'NONE' && !settledOutcomes.has(notified)) {
    console.error('[api] booking-addon notification claim outcome is ambiguous', {
      tenantId, bookingId, addonId, row,
    });
    throwPendingNotification();
  }
  if (row.claimed && notified !== 'PENDING') {
    console.error('[api] booking-addon notification claim transition is ambiguous', {
      tenantId, bookingId, addonId, row,
    });
    throwPendingNotification();
  }
  return { claimed: row.claimed, notified };
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
    p_duration_minutes: b.durationMinutes, p_idempotency_key: b.idempotencyKey,
    p_staff_id: b.staffId ?? null, p_no_personal_credit: b.noPersonalCredit,
    p_notify: b.notify,
  });
  if (error) rpcError(error);
  if (!Array.isArray(result) || result.length !== 1)
    throw new ApiHttpError(500, '加購交易回傳狀態不明，資料未安全確認', ERR.INTERNAL, { persisted: false });
  const rpcResult = result[0];
  const addonId = rpcResult?.addon_id;
  if (!addonId) throw new ApiHttpError(500, '加購交易未回傳項目', ERR.INTERNAL);
  const { data: addon, error: addonError } = await t.supabase.from('booking_addons')
    .select('id, service_id, name, price, quantity, duration_minutes, staff_id, applied_amount, applied_minutes, notified, performance_mode, performance_staff_id, created_at, staff:staff_id(name)')
    .eq('tenant_id', t.tenantId).eq('booking_id', id).eq('id', addonId).maybeSingle();
  if (addonError) throw addonError;
  if (!addon) throw new ApiHttpError(500, '加購交易結果無法讀取', ERR.INTERNAL);
  let notified: AddonNotifyOutcome = (rpcResult.notified ?? 'NONE') as AddonNotifyOutcome;
  if (b.notify) {
    if (notified === 'PENDING') throwPendingNotification();
    if (notified === 'NONE') {
      const admin = createAdminSupabase();
      const { data: claimResult, error: claimError } = await admin.rpc('claim_booking_addon_notification_17', {
        p_tenant_id: t.tenantId, p_booking_id: id, p_addon_id: addonId,
      });
      if (claimError) throwNotificationStateFailure('claim', t.tenantId, id, addonId, claimError);
      const claim = claimRowOrPending(claimResult, t.tenantId, id, addonId);
      if (!claim.claimed) {
        notified = claim.notified as AddonNotifyOutcome;
        if (notified === 'PENDING' || notified === 'NONE') throwPendingNotification();
      } else {
        const appliedAmount = b.price * b.quantity;
        const notification = await notifyBookingAddonReceipt(t.tenantId, {
          bookingId: id, item: { name: b.name, quantity: b.quantity, price: b.price },
          addonTotal: appliedAmount, bookingTotal: Number(rpcResult.final_price),
        });
        if (!notification || typeof notification.outcome !== 'string') {
          console.error('[api] booking-addon notification result is ambiguous', t.tenantId, id, addonId, notification);
          throwPendingNotification();
        }
        notified = notification.outcome;
        if (notified === 'PENDING') throwPendingNotification();
        if (!settledOutcomes.has(notified)) {
          console.error('[api] booking-addon notification outcome is unsupported', t.tenantId, id, addonId, notification);
          throwPendingNotification();
        }
        const { error: notificationError } = await admin.rpc('mark_booking_addon_notification_17', {
          p_tenant_id: t.tenantId, p_booking_id: id, p_addon_id: addonId, p_notified: notified,
        });
        if (notificationError) throwMarkerFailure(t.tenantId, id, addonId, notificationError);
      }
    }
  }
  const responseAddon = mapBookingAddon({ ...addon, notified });
  if (notified === 'PENDING') throwPendingNotification();
  if (notified === 'QUOTA_EXCEEDED')
    throw new ApiHttpError(409, '加購已新增，但本月推播額度已用完，未送出消費明細', ERR.CONFLICT, { persisted: true });
  return ok({ addon: responseAddon, finalPrice: Number(rpcResult.final_price),
    durationMinutes: Number(rpcResult.duration_minutes), endAt: rpcResult.end_at, notified });
});
