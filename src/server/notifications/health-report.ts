import { createAdminSupabase } from '@/server/supabase';
import { buildHealthDigest, immediateAlertCodes, type HealthDelivery, type HealthDigest } from './health';

type Admin = ReturnType<typeof createAdminSupabase>;

type DbDelivery = {
  tenant_id: string | null; channel: 'EMAIL' | 'TELEGRAM' | 'LINE'; status: HealthDelivery['status'];
  created_at: string; last_attempt_at: string | null; updated_at: string; last_error_code: string | null;
};

const TAIPEI_DAILY_CUTOFF_UTC_HOUR = 1; // 09:00 Asia/Taipei (UTC+08, no DST)

export type DailyHealthReportPeriod = { bucket: string; periodStart: string; periodEnd: string };

function taipeiCalendarParts(date: Date): { year: number; month: number; day: number } {
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(date);
  const part = (type: 'year' | 'month' | 'day') => Number(values.find((value) => value.type === type)?.value);
  return { year: part('year'), month: part('month'), day: part('day') };
}

/**
 * The cron may be delayed (or invoked early) on Vercel Hobby. Bucket reports
 * by the latest completed 09:00 Asia/Taipei cutoff, not wall-clock runtime.
 * Thus retried invocations upsert one report and one logical digest event.
 */
export function dailyHealthReportPeriod(now = new Date()): DailyHealthReportPeriod {
  const local = taipeiCalendarParts(now);
  const todayCutoff = Date.UTC(local.year, local.month - 1, local.day, TAIPEI_DAILY_CUTOFF_UTC_HOUR);
  const periodEnd = new Date(now.getTime() < todayCutoff ? todayCutoff - 24 * 60 * 60 * 1000 : todayCutoff);
  const endLocal = taipeiCalendarParts(periodEnd);
  return {
    bucket: `${endLocal.year}-${String(endLocal.month).padStart(2, '0')}-${String(endLocal.day).padStart(2, '0')}`,
    periodStart: new Date(periodEnd.getTime() - 24 * 60 * 60 * 1000).toISOString(),
    periodEnd: periodEnd.toISOString(),
  };
}

/**
 * Persist the daily health report and its two platform-owner ledger rows.
 * This intentionally creates the report even for a zero-failure period; the
 * dispatcher uses logical environment references and therefore never stores
 * platform addresses or chat ids in the report payload.
 */
export async function createDailyHealthReport(
  admin: Admin = createAdminSupabase(),
  end = new Date(),
): Promise<HealthDigest> {
  const period = dailyHealthReportPeriod(end);
  const activityWindow = [
    `and(created_at.gte.${period.periodStart},created_at.lt.${period.periodEnd})`,
    `and(last_attempt_at.gte.${period.periodStart},last_attempt_at.lt.${period.periodEnd})`,
    `and(updated_at.gte.${period.periodStart},updated_at.lt.${period.periodEnd})`,
  ].join(',');
  const [{ data: deliveries, error: deliveryError }, { data: pending, error: pendingError }, { count: logicalEvents, error: eventsError }] = await Promise.all([
    admin.from('notification_deliveries')
      .select('tenant_id, channel, status, created_at, last_attempt_at, updated_at, last_error_code')
      .or(activityWindow),
    admin.from('notification_deliveries')
      .select('tenant_id, channel, status, created_at, last_attempt_at, updated_at, last_error_code')
      .in('status', ['PENDING', 'PROCESSING', 'RETRY']).lt('created_at', period.periodEnd),
    admin.from('notification_outbox')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', period.periodStart).lt('created_at', period.periodEnd),
  ]);
  if (deliveryError) throw deliveryError;
  if (pendingError) throw pendingError;
  if (eventsError) throw eventsError;
  const mapDelivery = (row: DbDelivery): HealthDelivery => ({
    tenantId: row.tenant_id,
    channel: row.channel,
    status: row.status,
    createdAt: row.created_at,
    lastErrorCode: row.last_error_code,
  });
  const digest = buildHealthDigest(((deliveries ?? []) as DbDelivery[]).map(mapDelivery), new Date(period.periodEnd), logicalEvents ?? 0,
    ((pending ?? []) as DbDelivery[]).map(mapDelivery));

  const { data: report, error: reportError } = await admin.from('notification_health_reports')
    .upsert({ period_start: period.periodStart, period_end: period.periodEnd, summary: digest }, { onConflict: 'period_start,period_end' })
    .select('id').single();
  if (reportError) throw reportError;

  await createPlatformNotificationEvent(admin, {
    eventName: 'PLATFORM_NOTIFICATION_HEALTH', reportId: report.id, idempotencyKey: `daily-health:${period.bucket}`,
  });
  for (const alertCode of immediateAlertCodes(digest)) {
    await createPlatformNotificationEvent(admin, {
      eventName: 'PLATFORM_NOTIFICATION_ALERT', reportId: report.id,
      idempotencyKey: `health-alert:${period.bucket}:${alertCode}`, alertCode,
    });
  }
  return digest;
}

async function createPlatformNotificationEvent(
  admin: Admin,
  input: { eventName: 'PLATFORM_NOTIFICATION_HEALTH' | 'PLATFORM_NOTIFICATION_ALERT'; reportId: string; idempotencyKey: string; alertCode?: string },
): Promise<void> {
  const { data: outbox, error: outboxError } = await admin.from('notification_outbox')
    .upsert({
      tenant_id: null, event_name: input.eventName, aggregate_type: 'NOTIFICATION_HEALTH_REPORT',
      aggregate_id: input.reportId, idempotency_key: input.idempotencyKey,
      payload: { reportId: input.reportId, ...(input.alertCode ? { alertCode: input.alertCode } : {}) },
    }, { onConflict: 'event_name,aggregate_type,aggregate_id,idempotency_key' })
    .select('id').single();
  if (outboxError) throw outboxError;
  const { error: recipientError } = await admin.from('notification_deliveries').upsert([
    { outbox_id: outbox.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'EMAIL', destination_ref: 'PLATFORM_OWNER_EMAIL' },
    { outbox_id: outbox.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'TELEGRAM', destination_ref: 'PLATFORM_OWNER_TELEGRAM' },
  ], { onConflict: 'outbox_id,recipient_type,recipient_ref,channel', ignoreDuplicates: true });
  if (recipientError) throw recipientError;
}
