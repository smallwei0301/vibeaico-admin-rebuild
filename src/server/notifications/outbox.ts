/**
 * Notification outbox gateway (17 §1–4).
 *
 * Domain writes do not import a provider. PostgreSQL triggers create the
 * durable logical event in the same transaction; after commit this gateway
 * fans out and dispatches it best-effort. The daily cron runs the identical
 * path as recovery, so a lost serverless after-hook cannot lose the event.
 */
import { bookingHtml } from '@/server/email/templates';
import { createAdminSupabase } from '@/server/supabase';
import { deliveryTransition, type DeliveryStatus, type NotificationChannel, type TransportOutcome } from './delivery';
import { sendEmailWithResend, sendTelegramTransport } from './transports';
import { hashRecipientEmail } from './resend-webhook';

type Admin = ReturnType<typeof createAdminSupabase>;

type OutboxRow = {
  id: string; tenant_id: string | null; event_name: string;
  aggregate_id: string; payload: Record<string, unknown>;
};
type ClaimedDelivery = {
  id: string; outbox_id: string; tenant_id: string | null; recipient_type: string; recipient_ref: string;
  channel: NotificationChannel; destination_ref: string; attempt_count: number; claim_token: string;
};

type BookingRow = {
  id: string; tenant_id: string; staff_id: string | null; start_at: string;
  customers: { name: string } | null; services: { name: string } | null;
  staff: { name: string; email: string } | null; tenants: { name: string } | null;
};

const mailFrom = () => process.env.MAIL_FROM ?? 'onboarding@resend.dev';

function eventEnabled(event: string, notify: Record<string, unknown>): boolean {
  return event === 'BOOKING_CREATED' ? notify.notifyNewBooking !== false : notify.notifyBookingCancel !== false;
}

function asBooking(row: unknown): BookingRow | null {
  return row as BookingRow | null;
}

/** Idempotently expand the first migrated domain event into recipient × channel rows. */
async function fanOutBookingEvent(admin: Admin, event: OutboxRow): Promise<void> {
  if (!event.tenant_id) return;
  const bookingId = typeof event.payload.bookingId === 'string' ? event.payload.bookingId : event.aggregate_id;
  const [{ data: bookingRaw, error: bookingError }, { data: settingsRaw, error: settingsError }] = await Promise.all([
    admin.from('bookings').select('id, tenant_id, staff_id, start_at, customers(name), services(name), staff(name, email), tenants(name)')
      .eq('id', bookingId).eq('tenant_id', event.tenant_id).maybeSingle(),
    admin.from('tenant_settings').select('basic, notify').eq('tenant_id', event.tenant_id).maybeSingle(),
  ]);
  if (bookingError) throw bookingError;
  if (settingsError) throw settingsError;
  const booking = asBooking(bookingRaw);
  if (!booking) return;
  const basic = (settingsRaw?.basic ?? {}) as { tenantEmail?: unknown };
  const notify = (settingsRaw?.notify ?? {}) as Record<string, unknown>;
  const enabled = eventEnabled(event.event_name, notify);
  const tenantEmail = typeof basic.tenantEmail === 'string' ? basic.tenantEmail.trim() : '';
  const rows: Array<Record<string, unknown>> = [{
    outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'TENANT_OWNER', recipient_ref: event.tenant_id,
    channel: 'EMAIL', destination_ref: 'TENANT_SETTINGS_BASIC_EMAIL',
    status: enabled && tenantEmail ? 'PENDING' : 'SKIPPED',
    last_error_code: enabled ? (tenantEmail ? null : 'NO_RECIPIENT') : 'MATRIX_DISABLED',
    next_attempt_at: new Date().toISOString(),
  }];

  if (event.event_name === 'BOOKING_CREATED' && booking.staff_id) {
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
  for (const owner of owners ?? []) {
    rows.push({
      outbox_id: event.id, tenant_id: event.tenant_id, recipient_type: 'TENANT_OWNER', recipient_ref: owner.user_id,
      channel: 'TELEGRAM', destination_ref: 'TELEGRAM_BINDING',
      status: enabled ? 'PENDING' : 'SKIPPED', last_error_code: enabled ? null : 'MATRIX_DISABLED',
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
    .eq('status', 'OPEN').in('event_name', ['BOOKING_CREATED', 'BOOKING_CANCELLED'])
    .order('created_at', { ascending: true }).limit(limit);
  if (error) throw error;
  for (const row of data ?? []) await fanOutBookingEvent(admin, row as unknown as OutboxRow);
}

async function bookingForDelivery(admin: Admin, outbox: OutboxRow): Promise<BookingRow | null> {
  const bookingId = typeof outbox.payload.bookingId === 'string' ? outbox.payload.bookingId : outbox.aggregate_id;
  const { data, error } = await admin.from('bookings')
    .select('id, tenant_id, staff_id, start_at, customers(name), services(name), staff(name, email), tenants(name)')
    .eq('id', bookingId).maybeSingle();
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
    .eq('subject_type', subjectType).eq('subject_ref', delivery.recipient_ref).eq('active', true).maybeSingle();
  if (error) throw error;
  return data?.chat_id === undefined || data?.chat_id === null ? null : String(data.chat_id);
}

async function emailRecipientHealthy(admin: Admin, email: string): Promise<boolean> {
  const healthKey = process.env.RESEND_WEBHOOK_SECRET;
  if (!healthKey) return true;
  const { data, error } = await admin.from('email_recipient_health').select('healthy')
    .eq('recipient_hash', hashRecipientEmail(email, healthKey)).maybeSingle();
  if (error) throw error;
  return data?.healthy !== false;
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

function healthMessage(payload: Record<string, unknown>): { subject: string; html: string; telegram: string } {
  const summary = payload.summary as { channels?: Record<string, { accepted?: number; delivered?: number; retry?: number; dead?: number }> } | undefined;
  const email = summary?.channels?.EMAIL ?? {};
  const telegram = summary?.channels?.TELEGRAM ?? {};
  const text = [
    'VibeAI notification health (previous 24h)',
    ...(typeof payload.alertCode === 'string' ? [`Alert: ${payload.alertCode}`] : []),
    `Email accepted ${email.accepted ?? 0}; delivered ${email.delivered ?? 0}; retry ${email.retry ?? 0}; dead ${email.dead ?? 0}`,
    `Telegram accepted ${telegram.accepted ?? 0}; retry ${telegram.retry ?? 0}; dead ${telegram.dead ?? 0}`,
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
      if (!(await emailRecipientHealthy(admin, destination))) return { kind: 'skipped', code: 'EMAIL_UNHEALTHY' };
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
      if (!(await emailRecipientHealthy(admin, destination))) return { kind: 'skipped', code: 'EMAIL_UNHEALTHY' };
      return sendEmailWithResend({ apiKey: process.env.RESEND_API_KEY, from: mailFrom(), to: destination, subject: message.subject, html: message.html });
    }
    if (delivery.channel === 'TELEGRAM') {
      const destination = await resolveTelegramDestination(admin, delivery);
      return destination
        ? sendTelegramTransport({ token: process.env.TELEGRAM_BOT_TOKEN, chatId: destination, text: message.telegram })
        : { kind: 'skipped', code: 'NOT_CONFIGURED' };
    }
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
    }, { onConflict: 'event_name,aggregate_type,aggregate_id,idempotency_key' }).select('id').single();
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

async function persistOutcome(admin: Admin, delivery: ClaimedDelivery, outcome: TransportOutcome): Promise<void> {
  const transition = deliveryTransition(outcome, new Date(), delivery.attempt_count);
  const { error } = await admin.from('notification_deliveries').update({
    status: transition.status, attempt_count: transition.attemptCount, next_attempt_at: transition.nextAttemptAt,
    provider_message_id: transition.providerMessageId, last_error_code: transition.lastErrorCode,
    last_error_message: transition.lastErrorMessage, accepted_at: transition.acceptedAt,
    delivered_at: transition.deliveredAt, claim_token: null, processing_started_at: null,
  }).eq('id', delivery.id).eq('claim_token', delivery.claim_token);
  if (error) throw error;
  if (transition.bindingInvalid) {
    await admin.from('telegram_bindings').update({ active: false, invalid_reason: transition.lastErrorCode, invalidated_at: new Date().toISOString() })
      .eq('subject_type', delivery.recipient_type === 'STAFF' ? 'STAFF' : 'TENANT_USER')
      .eq('subject_ref', delivery.recipient_ref);
  }
  const { error: refreshError } = await admin.rpc('refresh_notification_outbox_status', { p_outbox_id: delivery.outbox_id });
  if (refreshError) throw refreshError;
  if (transition.status === 'DEAD') await enqueueImmediateDeadAlert(admin, delivery);
}

/** Best-effort post-commit dispatcher; it never changes the completed business response. */
export async function dispatchPendingNotifications(admin: Admin = createAdminSupabase(), limit = 20): Promise<number> {
  await fanOutPendingNotifications(admin);
  const { data, error } = await admin.rpc('claim_notification_deliveries', { p_limit: limit });
  if (error) throw error;
  let processed = 0;
  for (const row of data ?? []) {
    const delivery = row as unknown as ClaimedDelivery;
    try {
      await persistOutcome(admin, delivery, await sendClaimedDelivery(admin, delivery));
    } catch {
      await persistOutcome(admin, delivery, { kind: 'retryable', code: 'DISPATCH_ERROR' });
    }
    processed++;
  }
  return processed;
}

/** Call this only after the business write has committed. It intentionally swallows failures. */
export function dispatchAfterCommit(): void {
  void dispatchPendingNotifications().catch((error: unknown) => {
    console.error('[notifications] post-commit dispatch failed', error instanceof Error ? error.message : 'unknown');
  });
}

export type { DeliveryStatus };
