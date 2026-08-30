/**
 * Notification outbox gateway (17 §1–4).
 *
 * Domain writes do not import a provider. PostgreSQL triggers create the
 * durable logical event in the same transaction; after commit this gateway
 * fans out and dispatches it best-effort. The daily cron runs the identical
 * path as recovery, so a lost serverless after-hook cannot lose the event.
 */
import { createHash } from 'node:crypto';
import { bookingHtml, verificationHtml } from '@/server/email/templates';
import { APP_URL } from '@/config/env';
import { notifySettingsSchema } from '@/config/tenant-settings';
import { consumePushQuota, getLineCredentials, linePush } from '@/server/line';
import { createAdminSupabase } from '@/server/supabase';
import { deliveryTransition, type DeliveryStatus, type NotificationChannel, type TransportOutcome } from './delivery';
import { formatHealthDigest, type HealthDigest } from './health';
import { sendEmailWithResend, sendTelegramTransport } from './transports';
import { hashRecipientEmail } from './resend-webhook';

type Admin = ReturnType<typeof createAdminSupabase>;

type OutboxRow = {
  id: string; tenant_id: string | null; event_name: string;
  aggregate_id: string; payload: Record<string, unknown>;
};
export type ClaimedDelivery = {
  id: string; outbox_id: string; tenant_id: string | null; recipient_type: string; recipient_ref: string;
  channel: NotificationChannel; destination_ref: string; attempt_count: number; claim_token: string;
};
export type DeliverySender = (delivery: ClaimedDelivery) => Promise<TransportOutcome>;

type BookingRow = {
  id: string; tenant_id: string; customer_id: string; staff_id: string | null; start_at: string;
  customers: { name: string } | null; services: { name: string } | null;
  staff: { name: string; email: string } | null; tenants: { name: string } | null;
};

const mailFrom = () => process.env.MAIL_FROM ?? 'onboarding@resend.dev';

const LINE_EVENT_KIND = {
  BOOKING_LINE_CONFIRMED: 'CONFIRMED', BOOKING_LINE_COMPLETED: 'COMPLETED',
  BOOKING_LINE_CANCELLED: 'CANCELLED', BOOKING_LINE_MODIFIED: 'MODIFIED',
  BOOKING_LINE_NO_SHOW: 'NO_SHOW', BOOKING_LINE_REMINDER: 'REMINDER',
} as const;

type LineBookingKind = typeof LINE_EVENT_KIND[keyof typeof LINE_EVENT_KIND];
type NotifySettings = ReturnType<typeof notifySettingsSchema.parse>;
const LINE_SWITCH_KEY: Record<LineBookingKind, keyof NotifySettings> = {
  CONFIRMED: 'notifyBookingConfirmed', COMPLETED: 'notifyBookingCompleted',
  CANCELLED: 'notifyBookingCancelled', MODIFIED: 'notifyBookingModified',
  NO_SHOW: 'notifyBookingNoShow', REMINDER: 'notifyBookingReminder',
};

function ownerEventEnabled(event: string, notify: NotifySettings): boolean {
  return event === 'BOOKING_CREATED' ? notify.notifyNewBooking : notify.notifyBookingCancel;
}

function lineEventEnabled(kind: LineBookingKind, notify: NotifySettings): boolean {
  return notify[LINE_SWITCH_KEY[kind]] as boolean;
}

function asBooking(row: unknown): BookingRow | null {
  return row as BookingRow | null;
}

/** Idempotently expand the first migrated domain event into recipient × channel rows. */
async function fanOutBookingEvent(admin: Admin, event: OutboxRow): Promise<void> {
  if (!event.tenant_id) return;
  const bookingId = typeof event.payload.bookingId === 'string' ? event.payload.bookingId : event.aggregate_id;
  const [{ data: bookingRaw, error: bookingError }, { data: settingsRaw, error: settingsError }] = await Promise.all([
    admin.from('bookings').select('id, tenant_id, customer_id, staff_id, start_at, customers(name), services(name), staff(name, email), tenants(name)')
      .eq('id', bookingId).eq('tenant_id', event.tenant_id).maybeSingle(),
    admin.from('tenant_settings').select('basic, notify').eq('tenant_id', event.tenant_id).maybeSingle(),
  ]);
  if (bookingError) throw bookingError;
  if (settingsError) throw settingsError;
  const booking = asBooking(bookingRaw);
  if (!booking) return;
  const basic = (settingsRaw?.basic ?? {}) as { tenantEmail?: unknown };
  const notify = notifySettingsSchema.parse(settingsRaw?.notify ?? {});
  const lineKind = LINE_EVENT_KIND[event.event_name as keyof typeof LINE_EVENT_KIND];
  const enabled = ownerEventEnabled(event.event_name, notify);
  const tenantEmail = typeof basic.tenantEmail === 'string' ? basic.tenantEmail.trim() : '';
  const rows: Array<Record<string, unknown>> = [];
  if (!lineKind) rows.push({
      outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'TENANT_OWNER', recipient_ref: event.tenant_id,
      channel: 'EMAIL', destination_ref: 'TENANT_SETTINGS_BASIC_EMAIL',
      status: enabled && tenantEmail ? 'PENDING' : 'SKIPPED',
      last_error_code: enabled ? (tenantEmail ? null : 'NO_RECIPIENT') : 'MATRIX_DISABLED',
      next_attempt_at: new Date().toISOString(),
    });

  if (!lineKind && event.event_name === 'BOOKING_CREATED' && booking.staff_id) {
    const staffEmail = booking.staff?.email?.trim() ?? '';
    const staffEnabled = notify.notifyStaffBooking === true;
    rows.push({
      outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'STAFF', recipient_ref: booking.staff_id,
      channel: 'EMAIL', destination_ref: 'STAFF_EMAIL',
      status: staffEnabled && staffEmail ? 'PENDING' : 'SKIPPED',
      last_error_code: staffEnabled ? (staffEmail ? null : 'NO_RECIPIENT') : 'MATRIX_DISABLED',
      next_attempt_at: new Date().toISOString(),
    });
  }

  // Telegram is free baseline. Every owner can bind independently; an absent
  // binding becomes an auditable SKIPPED result at dispatch, not a failure.
  const { data: owners, error: ownerError } = await admin.from('tenant_users').select('user_id')
    .eq('tenant_id', event.tenant_id).eq('role', 'OWNER');
  if (ownerError) throw ownerError;
  for (const owner of lineKind ? [] : owners ?? []) {
    rows.push({
      outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'TENANT_OWNER', recipient_ref: owner.user_id,
      channel: 'TELEGRAM', destination_ref: 'TELEGRAM_BINDING',
      status: enabled ? 'PENDING' : 'SKIPPED', last_error_code: enabled ? null : 'MATRIX_DISABLED',
      next_attempt_at: new Date().toISOString(),
    });
  }

  if (lineKind) {
    const { data: customer, error: customerError } = await admin.from('customers')
      .select('line_user_id').eq('id', booking.customer_id).eq('tenant_id', event.tenant_id).maybeSingle();
    if (customerError) throw customerError;
    const lineUserId = customer?.line_user_id?.trim() ?? '';
    const lineEnabled = lineEventEnabled(lineKind, notify);
    rows.push({
      outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'TRAVELER', recipient_ref: booking.customer_id,
      channel: 'LINE', destination_ref: 'CUSTOMER_LINE_USER',
      status: lineEnabled && lineUserId ? 'PENDING' : 'SKIPPED',
      last_error_code: lineEnabled ? (lineUserId ? null : 'NOT_CONFIGURED') : 'MATRIX_DISABLED',
      next_attempt_at: new Date().toISOString(),
    });
  }

  const { error } = await admin.from('notification_deliveries').upsert(rows, {
    onConflict: 'outbox_id,recipient_type,recipient_ref,channel', ignoreDuplicates: true,
  });
  if (error) throw error;
  // An event whose matrix resolves entirely to SKIPPED (disabled/no recipient)
  // has reached a terminal audit state without ever entering the claim queue.
  const { error: refreshError } = await admin.rpc('refresh_notification_outbox_status', { p_outbox_id: event.id });
  if (refreshError) throw refreshError;
}

/** Materialize all open booking events before workers race to claim deliveries. */
export async function fanOutPendingNotifications(admin: Admin = createAdminSupabase(), limit = 100): Promise<void> {
  const { data, error } = await admin.from('notification_outbox')
    .select('id, tenant_id, event_name, aggregate_id, payload')
    .eq('status', 'OPEN').in('event_name', ['BOOKING_CREATED', 'BOOKING_CANCELLED', ...Object.keys(LINE_EVENT_KIND)])
    .order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  for (const row of data ?? []) await fanOutBookingEvent(admin, row as unknown as OutboxRow);
}

async function bookingForDelivery(admin: Admin, outbox: OutboxRow): Promise<BookingRow | null> {
  if (!outbox.tenant_id) return null;
  const bookingId = typeof outbox.payload.bookingId === 'string' ? outbox.payload.bookingId : outbox.aggregate_id;
  const { data, error } = await admin.from('bookings')
    .select('id, tenant_id, customer_id, staff_id, start_at, customers(name), services(name), staff(name, email), tenants(name)')
    .eq('id', bookingId).eq('tenant_id', outbox.tenant_id).maybeSingle();
  if (error) throw error;
  return asBooking(data);
}

async function resolveEmailDestination(admin: Admin, delivery: ClaimedDelivery): Promise<string | null> {
  if (delivery.destination_ref === 'TENANT_SETTINGS_BASIC_EMAIL') {
    const { data, error } = await admin.from('tenant_settings').select('basic').eq('tenant_id', delivery.tenant_id!).maybeSingle();
    if (error) throw error;
    const email = (data?.basic as { tenantEmail?: unknown } | null)?.tenantEmail;
    return typeof email === 'string' && email.trim() ? email.trim() : null;
  }
  if (delivery.destination_ref === 'STAFF_EMAIL') {
    const { data, error } = await admin.from('staff').select('email').eq('id', delivery.recipient_ref).maybeSingle();
    if (error) throw error;
    return data?.email?.trim() || null;
  }
  if (delivery.destination_ref === 'PLATFORM_OWNER_EMAIL') return process.env.PLATFORM_OWNER_EMAIL?.trim() || null;
  return null;
}

async function resolveTelegramDestination(admin: Admin, delivery: ClaimedDelivery): Promise<string | null> {
  if (delivery.destination_ref === 'PLATFORM_OWNER_TELEGRAM') return process.env.PLATFORM_TELEGRAM_CHAT_ID?.trim() || null;
  const subjectType = delivery.recipient_type === 'STAFF' ? 'STAFF' : 'TENANT_USER';
  const { data, error } = await admin.from('telegram_bindings').select('chat_id')
    .eq('tenant_id', delivery.tenant_id).eq('subject_type', subjectType)
    .eq('subject_ref', delivery.recipient_ref).eq('active', true).maybeSingle();
  if (error) throw error;
  return data?.chat_id === undefined || data?.chat_id === null ? null : String(data.chat_id);
}

/**
 * Recipient-health hashes are only comparable when the dedicated key is set.
 * Fail closed (retryable) rather than treating an uncheckable recipient as
 * healthy and bypassing a known bounce/complaint suppression record.
 */
export async function emailRecipientGate(admin: Admin, email: string): Promise<TransportOutcome | null> {
  const healthKey = process.env.RESEND_RECIPIENT_HEALTH_KEY;
  if (!healthKey) return { kind: 'retryable', code: 'RECIPIENT_HEALTH_KEY_MISSING' };
  const { data, error } = await admin.from('email_recipient_health').select('healthy')
    .eq('recipient_hash', hashRecipientEmail(email, healthKey)).maybeSingle();
  if (error) throw error;
  return data?.healthy === false ? { kind: 'skipped', code: 'EMAIL_UNHEALTHY' } : null;
}

function bookingMessage(outbox: OutboxRow, booking: BookingRow): { subject: string; html: string; telegram: string } {
  const title = outbox.event_name === 'BOOKING_CREATED' ? '新預約通知' : '預約取消通知';
  const shopName = booking.tenants?.name ?? 'VibeAI';
  const customerName = booking.customers?.name ?? '';
  const serviceName = booking.services?.name ?? '';
  return {
    subject: `【${shopName}】${title} — ${customerName} ${serviceName}`,
    html: bookingHtml(title, { shopName, customerName, serviceName, startAt: booking.start_at, staffName: booking.staff?.name ?? null }),
    telegram: `【${shopName}】${title}\n服務：${serviceName}\n時間：${booking.start_at}`,
  };
}

function lineBookingMessage(kind: LineBookingKind, booking: BookingRow): string {
  const copy: Record<LineBookingKind, { title: string; footer: string }> = {
    CONFIRMED: { title: '您的預約已確認 ✅', footer: '期待您的光臨！' },
    COMPLETED: { title: '感謝您今日的光臨 💛', footer: '期待下次再為您服務！' },
    CANCELLED: { title: '您的預約已取消', footer: '如需重新預約，歡迎隨時與我們聯繫。' },
    MODIFIED: { title: '您的預約內容已變更', footer: '若有疑問，歡迎與我們聯繫確認。' },
    NO_SHOW: { title: '我們今日未能等到您 🙏', footer: '如需改約，歡迎與我們聯繫重新安排。' },
    REMINDER: { title: '預約提醒 🔔', footer: '若無法如期前來，請提前與我們聯繫改期。' },
  };
  const date = new Date(new Date(booking.start_at).getTime() + 8 * 60 * 60 * 1000);
  const two = (value: number) => String(value).padStart(2, '0');
  const time = `${date.getUTCFullYear()}/${two(date.getUTCMonth() + 1)}/${two(date.getUTCDate())} ${two(date.getUTCHours())}:${two(date.getUTCMinutes())}`;
  const item = copy[kind];
  return `【${booking.tenants?.name ?? ''}】${item.title}\n服務項目：${booking.services?.name ?? ''}\n預約時間：${time}\n${item.footer}`;
}

async function sendLineBookingDelivery(
  admin: Admin,
  delivery: ClaimedDelivery,
  booking: BookingRow,
  kind: LineBookingKind,
): Promise<TransportOutcome> {
  const { data: customer, error } = await admin.from('customers').select('line_user_id')
    .eq('id', booking.customer_id).eq('tenant_id', booking.tenant_id).maybeSingle();
  if (error) throw error;
  const lineUserId = customer?.line_user_id?.trim();
  if (!lineUserId) return { kind: 'skipped', code: 'NOT_CONFIGURED' };
  try {
    const { token } = await getLineCredentials(booking.tenant_id);
    if (!(await consumePushQuota(booking.tenant_id, 1))) return { kind: 'skipped', code: 'QUOTA_SKIPPED' };
    await linePush(token, lineUserId, [{ type: 'text', text: lineBookingMessage(kind, booking) }]);
    // LINE's push response has no message id. The ledger id is a stable audit
    // correlation value, not a claim that LINE supplied a provider id.
    return { kind: 'accepted', providerMessageId: `line:${delivery.id}` };
  } catch {
    return { kind: 'retryable', code: 'LINE_TRANSPORT_ERROR' };
  }
}

function healthMessage(payload: Record<string, unknown>): { subject: string; html: string; telegram: string } {
  const summary = payload.summary as HealthDigest | undefined;
  const text = [
    summary ? formatHealthDigest(summary) : 'VibeAI notification health (summary unavailable)',
    ...(typeof payload.alertCode === 'string' ? [`Alert: ${payload.alertCode}`] : []),
  ].join('\n');
  return { subject: '【VibeAI】通知送達健康報告', html: `<pre>${text}</pre>`, telegram: text };
}

async function sendClaimedDelivery(admin: Admin, delivery: ClaimedDelivery): Promise<TransportOutcome> {
  const { data, error } = await admin.from('notification_outbox')
    .select('id, tenant_id, event_name, aggregate_id, payload').eq('id', delivery.outbox_id).maybeSingle();
  if (error) throw error;
  const outbox = data as unknown as OutboxRow | null;
  if (!outbox) return { kind: 'permanent', code: 'OUTBOX_MISSING' };

  if (outbox.event_name === 'PLATFORM_NOTIFICATION_HEALTH' || outbox.event_name === 'PLATFORM_NOTIFICATION_ALERT') {
    // A daily report carries a report id. A DEAD-letter alert is intentionally
    // emitted immediately, before the next daily aggregate exists, and carries
    // only its fixed alert code (no tenant, recipient, or provider body).
    let payload = outbox.payload;
    const reportId = typeof outbox.payload.reportId === 'string' ? outbox.payload.reportId : null;
    if (reportId) {
      const { data: report, error: reportError } = await admin.from('notification_health_reports')
        .select('summary').eq('id', reportId).maybeSingle();
      if (reportError) throw reportError;
      if (!report) return { kind: 'permanent', code: 'AGGREGATE_MISSING' };
      payload = { ...payload, summary: report.summary };
    }
    const message = healthMessage(payload);
    if (delivery.channel === 'EMAIL') {
      const destination = await resolveEmailDestination(admin, delivery);
      if (!destination) return { kind: 'skipped', code: 'NOT_CONFIGURED' };
      const recipientGate = await emailRecipientGate(admin, destination);
      if (recipientGate) return recipientGate;
      return sendEmailWithResend({ apiKey: process.env.RESEND_API_KEY, from: mailFrom(), to: destination, subject: message.subject, html: message.html });
    }
    if (delivery.channel === 'TELEGRAM') {
      const destination = await resolveTelegramDestination(admin, delivery);
      return destination
        ? sendTelegramTransport({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: destination, text: message.telegram })
        : { kind: 'skipped', code: 'NOT_CONFIGURED' };
    }
  }

  if (outbox.event_name === 'BOOKING_CREATED' || outbox.event_name === 'BOOKING_CANCELLED') {
    const booking = await bookingForDelivery(admin, outbox);
    if (!booking) return { kind: 'permanent', code: 'AGGREGATE_MISSING' };
    const message = bookingMessage(outbox, booking);
    if (delivery.channel === 'EMAIL') {
      const destination = await resolveEmailDestination(admin, delivery);
      if (!destination) return { kind: 'skipped', code: 'NO_RECIPIENT' };
      const recipientGate = await emailRecipientGate(admin, destination);
      if (recipientGate) return recipientGate;
      return sendEmailWithResend({ apiKey: process.env.RESEND_API_KEY, from: mailFrom(), to: destination, subject: message.subject, html: message.html });
    }
    if (delivery.channel === 'TELEGRAM') {
      const destination = await resolveTelegramDestination(admin, delivery);
      return destination
        ? sendTelegramTransport({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: destination, text: message.telegram })
        : { kind: 'skipped', code: 'NOT_CONFIGURED' };
    }
  }
  const lineKind = LINE_EVENT_KIND[outbox.event_name as keyof typeof LINE_EVENT_KIND];
  if (lineKind && delivery.channel === 'LINE') {
    const booking = await bookingForDelivery(admin, outbox);
    return booking
      ? sendLineBookingDelivery(admin, delivery, booking, lineKind)
      : { kind: 'permanent', code: 'AGGREGATE_MISSING' };
  }
  return { kind: 'skipped', code: 'UNSUPPORTED_CHANNEL' };
}

/**
 * An alert event is durable before the daily report exists. Failures here
 * must not overwrite the already-final delivery result; the daily report
 * remains a second, auditable alert path.
 */
async function enqueueImmediateDeadAlert(admin: Admin, delivery: ClaimedDelivery): Promise<void> {
  if (delivery.recipient_type === 'PLATFORM_OWNER') return;
  try {
    const { data: alert, error: alertError } = await admin.from('notification_outbox').upsert({
      tenant_id: null,
      event_name: 'PLATFORM_NOTIFICATION_ALERT',
      aggregate_type: 'NOTIFICATION_DELIVERY',
      aggregate_id: delivery.id,
      idempotency_key: `delivery-dead:${delivery.id}`,
      payload: { alertCode: 'CRITICAL_DELIVERY_DEAD' },
    }, { onConflict: 'tenant_id,event_name,aggregate_type,aggregate_id,idempotency_key' }).select('id').single();
    if (alertError) throw alertError;
    const { error: recipientsError } = await admin.from('notification_deliveries').upsert([
      { outbox_id: alert.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'EMAIL', destination_ref: 'PLATFORM_OWNER_EMAIL' },
      { outbox_id: alert.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'TELEGRAM', destination_ref: 'PLATFORM_OWNER_TELEGRAM' },
    ], { onConflict: 'outbox_id,recipient_type,recipient_ref,channel', ignoreDuplicates: true });
    if (recipientsError) throw recipientsError;
  } catch (error) {
    console.error('[notifications] unable to enqueue immediate DEAD alert', error instanceof Error ? error.message : 'unknown');
  }
}

async function enqueueImmediateProviderAlert(admin: Admin, alertCode: string, aggregateId: string): Promise<void> {
  const bucket = Math.floor(Date.now() / (5 * 60_000));
  const { data: alert, error: alertError } = await admin.from('notification_outbox').upsert({
    tenant_id: null, event_name: 'PLATFORM_NOTIFICATION_ALERT',
    aggregate_type: 'NOTIFICATION_HEALTH_LIVE', aggregate_id: aggregateId,
    idempotency_key: `live-alert:${alertCode}:${aggregateId}:${bucket}`,
    payload: { alertCode },
  }, { onConflict: 'tenant_id,event_name,aggregate_type,aggregate_id,idempotency_key' }).select('id').single();
  if (alertError) throw alertError;
  const { error: recipientsError } = await admin.from('notification_deliveries').upsert([
    { outbox_id: alert.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'EMAIL', destination_ref: 'PLATFORM_OWNER_EMAIL' },
    { outbox_id: alert.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'TELEGRAM', destination_ref: 'PLATFORM_OWNER_TELEGRAM' },
  ], { onConflict: 'outbox_id,recipient_type,recipient_ref,channel', ignoreDuplicates: true });
  if (recipientsError) throw recipientsError;
}

async function enqueueLiveProviderAlert(admin: Admin, transition: ReturnType<typeof deliveryTransition>, delivery: ClaimedDelivery): Promise<boolean> {
  const code = transition.lastErrorCode;
  const alertCode = code === 'HTTP_401' || code === 'HTTP_403' ? 'PROVIDER_AUTH_FAILURE'
    : code === 'HTTP_429' ? 'PROVIDER_RATE_LIMIT_BURST'
      : code && /^HTTP_5\d\d$/.test(code) ? 'PROVIDER_5XX_BURST' : null;
  if (!alertCode) return false;
  await enqueueImmediateProviderAlert(admin, alertCode, delivery.id);
  return true;
}

async function enqueueStalePendingAlert(admin: Admin): Promise<boolean> {
  const threshold = new Date(Date.now() - 30 * 60_000).toISOString();
  const { data, error } = await admin.from('notification_deliveries').select('id')
    .in('status', ['PENDING', 'PROCESSING', 'RETRY']).lt('created_at', threshold)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  if (error) throw error;
  if (!data) return false;
  await enqueueImmediateProviderAlert(admin, 'PENDING_TOO_OLD', data.id);
  return true;
}

async function persistOutcome(admin: Admin, delivery: ClaimedDelivery, outcome: TransportOutcome): Promise<void> {
  const transition = deliveryTransition(outcome, new Date(), delivery.attempt_count);
  const { data: persisted, error } = await admin.from('notification_deliveries').update({
    status: transition.status, attempt_count: transition.attemptCount, next_attempt_at: transition.nextAttemptAt,
    provider_message_id: transition.providerMessageId, last_error_code: transition.lastErrorCode,
    last_error_message: transition.lastErrorMessage, accepted_at: transition.acceptedAt,
    delivered_at: transition.deliveredAt, claim_token: null, processing_started_at: null,
  }).eq('id', delivery.id).eq('claim_token', delivery.claim_token).select('id').maybeSingle();
  if (error) throw error;
  // A worker can finish after its 10-minute lease was reclaimed. The claim
  // token is the compare-and-swap guard: a stale result must not invalidate a
  // binding, refresh the outbox, or emit a DEAD alert owned by the new worker.
  if (!persisted) return;
  if (transition.bindingInvalid) {
    await admin.from('telegram_bindings').update({ active: false, invalid_reason: transition.lastErrorCode, invalidated_at: new Date().toISOString() })
      .eq('tenant_id', delivery.tenant_id)
      .eq('subject_type', delivery.recipient_type === 'STAFF' ? 'STAFF' : 'TENANT_USER')
      .eq('subject_ref', delivery.recipient_ref);
  }
  const { error: refreshError } = await admin.rpc('refresh_notification_outbox_status', { p_outbox_id: delivery.outbox_id });
  if (refreshError) throw refreshError;
  if (transition.status === 'DEAD') await enqueueImmediateDeadAlert(admin, delivery);
  await enqueueLiveProviderAlert(admin, transition, delivery);
}

/** Best-effort post-commit dispatcher; it never changes the completed business response. */
export async function dispatchPendingNotifications(
  admin: Admin = createAdminSupabase(), limit = 20, dispatchAlerts = true,
  sender: DeliverySender = (delivery) => sendClaimedDelivery(admin, delivery),
): Promise<number> {
  await fanOutPendingNotifications(admin);
  const { data, error } = await admin.rpc('claim_notification_deliveries', { p_limit: limit });
  if (error) throw error;
  let processed = 0;
  for (const row of data ?? []) {
    const delivery = row as unknown as ClaimedDelivery;
    try {
      await persistOutcome(admin, delivery, await sender(delivery));
    } catch {
      await persistOutcome(admin, delivery, { kind: 'retryable', code: 'DISPATCH_ERROR' });
    }
    processed++;
  }
  const hasStalePending = dispatchAlerts ? await enqueueStalePendingAlert(admin) : false;
  // The second, bounded pass means a critical alert created above is dispatched
  // now rather than only on the daily cron sweep.
  if (dispatchAlerts && (processed > 0 || hasStalePending))
    processed += await dispatchPendingNotifications(admin, limit, false, sender);
  return processed;
}

/** Call this only after the business write has committed. It intentionally swallows failures. */
export function dispatchAfterCommit(): void {
  void dispatchPendingNotifications().catch((error: unknown) => {
    console.error('[notifications] post-commit dispatch failed', error instanceof Error ? error.message : 'unknown');
  });
}

/**
 * 17 §3 allows low-latency auth Email to call Resend synchronously, provided
 * the audit event and delivery row exist first. No address, code, reset link,
 * or provider body is persisted in the outbox payload.
 */
export async function dispatchAuthVerificationEmail(input: {
  to: string; code: string; purpose: 'REGISTER' | 'RESET_PASSWORD';
}, admin: Admin = createAdminSupabase()): Promise<void> {
  const recipientRef = createHash('sha256').update(input.to.trim().toLowerCase()).digest('hex');
  const idempotencyKey = createHash('sha256')
    .update(`${input.purpose}:${recipientRef}:${input.code}`).digest('hex');
  const { data, error } = await admin.rpc('enqueue_auth_verification_delivery', {
    p_recipient_ref: recipientRef, p_idempotency_key: idempotencyKey,
  });
  if (error) throw error;
  const delivery = (Array.isArray(data) ? data[0] : data) as unknown as
    { id: string; outbox_id: string; attempt_count: number } | null;
  if (!delivery) throw new Error('auth delivery ledger was not created');
  const title = input.purpose === 'REGISTER' ? '註冊驗證碼' : '密碼重設驗證碼';
  const resetLink = input.purpose === 'RESET_PASSWORD'
    ? `${APP_URL}/tenant/reset-password?token=${input.code}&email=${encodeURIComponent(input.to)}`
    : undefined;
  const outcome = await sendEmailWithResend({
    apiKey: process.env.RESEND_API_KEY, from: mailFrom(), to: input.to,
    subject: `【VibeAI】${title}`, html: verificationHtml(title, input.code, resetLink),
  });
  const transition = deliveryTransition(outcome, new Date(), delivery.attempt_count);
  const { error: updateError } = await admin.from('notification_deliveries').update({
    status: transition.status, attempt_count: transition.attemptCount,
    next_attempt_at: transition.nextAttemptAt, provider_message_id: transition.providerMessageId,
    last_error_code: transition.lastErrorCode, last_error_message: transition.lastErrorMessage,
    accepted_at: transition.acceptedAt, delivered_at: transition.deliveredAt,
    last_attempt_at: new Date().toISOString(), processing_started_at: null,
  }).eq('id', delivery.id);
  if (updateError) throw updateError;
  const { error: refreshError } = await admin.rpc('refresh_notification_outbox_status', { p_outbox_id: delivery.outbox_id });
  if (refreshError) throw refreshError;
}

export type { DeliveryStatus };
