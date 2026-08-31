import { createAdminSupabase } from '@/server/supabase';
import {
  buildHealthDigest,
  immediateAlertCodes,
  syntheticTransportProbeFromLedger,
  type HealthDelivery,
  type HealthDigest,
} from './health';

type Admin = ReturnType<typeof createAdminSupabase>;

type DbDelivery = {
  tenant_id: string | null; channel: 'EMAIL' | 'TELEGRAM' | 'LINE'; status: HealthDelivery['status'];
  created_at: string; last_error_code: string | null;
};

type DbProbeDelivery = Pick<DbDelivery, 'channel' | 'status' | 'last_error_code'>;

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
  const periodEnd = end.toISOString();
  const periodStart = new Date(end.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const [{ data: deliveries, error: deliveryError }, { data: pending, error: pendingError }, { count: logicalEvents, error: eventsError }, { data: probeRows, error: probeError }] = await Promise.all([
    admin.from('notification_deliveries')
      .select('tenant_id, channel, status, created_at, last_error_code')
      .gte('created_at', periodStart).lt('created_at', periodEnd),
    admin.from('notification_deliveries')
      .select('tenant_id, channel, status, created_at, last_error_code')
      .in('status', ['PENDING', 'PROCESSING', 'RETRY']).lt('created_at', periodEnd),
    admin.from('notification_outbox')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', periodStart).lt('created_at', periodEnd),
    admin.from('notification_deliveries')
      .select('channel, status, last_error_code, notification_outbox!inner(event_name)')
      .eq('notification_outbox.event_name', 'PLATFORM_NOTIFICATION_HEALTH')
      .in('channel', ['EMAIL', 'TELEGRAM'])
      .gte('created_at', periodStart).lt('created_at', periodEnd),
  ]);
  if (deliveryError) throw deliveryError;
  if (pendingError) throw pendingError;
  if (eventsError) throw eventsError;
  if (probeError) throw probeError;
  const mapDelivery = (row: DbDelivery): HealthDelivery => ({
    tenantId: row.tenant_id,
    channel: row.channel,
    status: row.status,
    createdAt: row.created_at,
    lastErrorCode: row.last_error_code,
  });
  const mapProbeDelivery = (row: DbProbeDelivery) => ({
    channel: row.channel,
    status: row.status,
    lastErrorCode: row.last_error_code,
  });
  const digest = buildHealthDigest(((deliveries ?? []) as DbDelivery[]).map(mapDelivery), end, logicalEvents ?? 0,
    ((pending ?? []) as DbDelivery[]).map(mapDelivery), syntheticTransportProbeFromLedger(
      ((probeRows ?? []) as unknown as DbProbeDelivery[]).map(mapProbeDelivery),
    ));

  const { data: report, error: reportError } = await admin.from('notification_health_reports')
    .upsert({ period_start: periodStart, period_end: periodEnd, summary: digest }, { onConflict: 'period_start,period_end' })
    .select('id').single();
  if (reportError) throw reportError;

  await createPlatformNotificationEvent(admin, {
    eventName: 'PLATFORM_NOTIFICATION_HEALTH', reportId: report.id, idempotencyKey: `daily-health:${periodStart}`,
  });
  for (const alertCode of immediateAlertCodes(digest)) {
    await createPlatformNotificationEvent(admin, {
      eventName: 'PLATFORM_NOTIFICATION_ALERT', reportId: report.id,
      idempotencyKey: `health-alert:${periodStart}:${alertCode}`, alertCode,
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
    }, { onConflict: 'tenant_id,event_name,aggregate_type,aggregate_id,idempotency_key' })
    .select('id').single();
  if (outboxError) throw outboxError;
  const { error: recipientError } = await admin.from('notification_deliveries').upsert([
    { outbox_id: outbox.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'EMAIL', destination_ref: 'PLATFORM_OWNER_EMAIL' },
    { outbox_id: outbox.id, tenant_id: null, recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'TELEGRAM', destination_ref: 'PLATFORM_OWNER_TELEGRAM' },
  ], { onConflict: 'outbox_id,recipient_type,recipient_ref,channel', ignoreDuplicates: true });
  if (recipientError) throw recipientError;
}
