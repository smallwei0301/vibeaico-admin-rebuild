import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0038_notification_outbox_delivery.sql', 'utf8');
const bookingRoute = readFileSync('src/app/api/bookings/route.ts', 'utf8');
const bookingCancelRoute = readFileSync('src/app/api/bookings/[id]/cancel/route.ts', 'utf8');
const settingsPage = readFileSync('src/app/tenant/settings/page.tsx', 'utf8');
const emailNotify = readFileSync('src/server/email/notify.ts', 'utf8');
const resetDb = readFileSync('scripts/test/reset-db.mjs', 'utf8');

describe('notification outbox schema contract (#40, 17 §1–4)', () => {
  it('has separate idempotent event, per-recipient delivery, health, binding, and webhook-ledger tables', () => {
    for (const table of [
      'notification_outbox', 'notification_deliveries', 'notification_health_reports',
      'telegram_bindings', 'telegram_bind_codes', 'telegram_webhook_updates',
      'notification_provider_webhook_events', 'email_recipient_health',
    ]) expect(migration).toMatch(new RegExp(`create table ${table}`, 'i'));
    expect(migration).toMatch(/unique index notification_outbox_idempotency/i);
    expect(migration).toMatch(/unique \(outbox_id, recipient_type, recipient_ref, channel\)/i);
    expect(migration).toMatch(/status in \('PENDING', 'PROCESSING', 'ACCEPTED', 'DELIVERED', 'RETRY', 'DEAD', 'SKIPPED'\)/i);
    expect(migration).toMatch(/next_attempt_at\s+timestamptz\s+default now\(\)/i);
    expect(migration).not.toMatch(/next_attempt_at\s+timestamptz\s+not null/i);
    expect(migration).toMatch(/unique index notification_deliveries_email_provider_id/i);
  });

  it('uses a transactional booking trigger and SKIP LOCKED claim rather than a best-effort direct provider call', () => {
    expect(migration).toMatch(/after insert or update of status on bookings/i);
    expect(migration).toMatch(/enqueue_notification_event/i);
    expect(migration).toMatch(/for update skip locked/i);
    expect(migration).toMatch(/processing_started_at < pg_catalog\.now\(\) - interval '10 minutes'/i);
  });

  it('treats provider ACCEPTED as terminal for the logical event while retaining its precise delivery status', () => {
    expect(migration).toContain("status in ('PENDING', 'PROCESSING', 'RETRY')) then 'OPEN'");
    expect(migration).not.toContain("status in ('PENDING', 'PROCESSING', 'RETRY', 'ACCEPTED')) then 'OPEN'");
  });

  it('looks up a delivery booking within the outbox tenant boundary', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toContain(".eq('id', bookingId).eq('tenant_id', outbox.tenant_id).maybeSingle()");
  });

  it('creates an immediate platform alert event when a non-platform delivery becomes DEAD', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toContain("event_name: 'PLATFORM_NOTIFICATION_ALERT'");
    expect(outbox).toContain("idempotency_key: `delivery-dead:${delivery.id}`");
    expect(outbox).toContain("if (transition.status === 'DEAD') await enqueueImmediateDeadAlert(admin, delivery)");
  });

  it('keeps ledger and privileged RPCs unavailable to browser roles', () => {
    expect(migration).toMatch(/alter table notification_outbox enable row level security/i);
    expect(migration).toMatch(/revoke all on table notification_outbox,[\s\S]*?from anon, authenticated/i);
    expect((migration.match(/revoke execute on function public\./gi) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(migration).toMatch(/code_hash\s+bytea/i);
    expect(migration).toMatch(/primary key \(bot_id, update_id\)/i);
  });

  it('allows only the server service role to call privileged notification RPCs', () => {
    for (const fn of [
      'claim_notification_deliveries', 'refresh_notification_outbox_status',
      'apply_resend_delivery_event', 'consume_telegram_bind_code',
    ]) {
      expect(migration).toMatch(new RegExp(`revoke execute on function public\\.${fn}\\([^;]+\\) from public, anon, authenticated`, 'i'));
      expect(migration).toMatch(new RegExp(`grant execute on function public\\.${fn}\\([^;]+\\) to service_role`, 'i'));
    }
    expect(migration).not.toMatch(/grant execute on function public\.enqueue_notification_event\([^;]+\) to service_role/i);
  });

  it('pins every SECURITY DEFINER notification function to an empty path and schema-qualifies its objects', () => {
    const functions = [
      'enqueue_notification_event', 'enqueue_booking_notification_event',
      'claim_notification_deliveries', 'refresh_notification_outbox_status',
      'apply_resend_delivery_event', 'consume_telegram_bind_code',
    ];
    for (const fn of functions) {
      const start = migration.search(new RegExp(`create or replace function public\\.${fn}\\(`, 'i'));
      expect(start).toBeGreaterThanOrEqual(0);
      const end = migration.indexOf('$$;', start);
      const body = migration.slice(start, end);
      expect(body).toContain("set search_path = ''");
      expect(body).not.toMatch(/set search_path\s*=\s*public|pg_temp/i);
    }
    expect(migration).toContain('insert into public.notification_outbox');
    expect(migration).toContain('from public.notification_deliveries');
    expect(migration).toContain('perform public.refresh_notification_outbox_status');
    expect(migration).toContain('public.telegram_bind_codes%rowtype');
    expect(migration).toContain('pg_catalog.gen_random_uuid()');
    expect(migration).toContain('pg_catalog.jsonb_build_object');
  });

  it('keeps Telegram bindings tenant-scoped for lookup, invalidation, and rebinding', () => {
    expect(migration).toMatch(/unique nulls not distinct \(tenant_id, subject_type, subject_ref\)/i);
    expect(migration).toMatch(/unique nulls not distinct \(tenant_id, chat_id\)/i);
    expect(migration).toMatch(/on conflict \(tenant_id, subject_type, subject_ref\) do update/i);
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toMatch(/from\('telegram_bindings'\)\.select\('chat_id'\)[\s\S]*?\.eq\('tenant_id', delivery\.tenant_id\)/);
    expect(outbox).toMatch(/from\('telegram_bindings'\)\.update[\s\S]*?\.eq\('tenant_id', delivery\.tenant_id\)/);
  });

  it('uses a dedicated stable key for recipient health and records activity timestamps for the daily digest', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    const resendRoute = readFileSync('src/app/api/webhooks/resend/route.ts', 'utf8');
    const healthReport = readFileSync('src/server/notifications/health-report.ts', 'utf8');
    const envExample = readFileSync('.env.example', 'utf8');
    expect(outbox).toContain('RESEND_RECIPIENT_HEALTH_KEY');
    expect(resendRoute).toContain('RESEND_RECIPIENT_HEALTH_KEY');
    expect(envExample).toContain('RESEND_RECIPIENT_HEALTH_KEY=');
    expect(healthReport).toContain('last_attempt_at');
    expect(healthReport).toContain('updated_at');
    expect(healthReport).toContain('.or(activityWindow)');
    expect(healthReport).toContain('daily-health:${period.bucket}');
    expect(readFileSync('vercel.json', 'utf8')).toContain('"path": "/api/cron/notification-health", "schedule": "0 2 * * *"');
  });

  it('only triggers secondary effects after the claimed delivery row was actually updated', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toMatch(/\.eq\('id', delivery\.id\)\.eq\('claim_token', delivery\.claim_token\)\.select\('id'\)\.maybeSingle\(\)/);
    expect(outbox).toContain('if (!updatedDelivery) return false;');
    expect(outbox).toContain('idempotencyKey: `notification-delivery:${delivery.id}`');
  });

  it('applies Resend delivery evidence idempotently without storing webhook bodies', () => {
    expect(migration).toMatch(/create or replace function public\.apply_resend_delivery_event/i);
    expect(migration).toMatch(/insert into public\.notification_provider_webhook_events/i);
    expect(migration).toMatch(/on conflict do nothing/i);
    expect(migration).toMatch(/where provider_message_id = p_provider_message_id/i);
    expect(migration).toMatch(/if affected_outbox is null then return 'NOT_FOUND'/i);
    expect(migration).toMatch(/if affected_status = 'DEAD' and p_status = 'DELIVERED' then return 'IGNORED'/i);
    expect(migration).toMatch(/'PLATFORM_NOTIFICATION_ALERT'/i);
    expect(migration).toMatch(/'CRITICAL_DELIVERY_DEAD'/i);
    expect(migration).toMatch(/insert into public\.email_recipient_health/i);
    expect(resetDb).toContain("table: 'notification_provider_webhook_events'");
    expect(resetDb).toContain("table: 'email_recipient_health'");
  });

  it('uses the one post-commit outbox gateway instead of firing booking Email sends from routes', () => {
    for (const route of [bookingRoute, bookingCancelRoute]) {
      expect(route).toContain("dispatchAfterCommit()");
      expect(route).not.toMatch(/notifyBookingEvent\(/);
      expect(route).not.toMatch(/sendBookingNotifyEmail\(/);
    }
  });

  it('does not leave the basic booking Email path behind the paid feature gate', () => {
    expect(settingsPage).toContain('emailBaseline');
    expect(settingsPage).not.toContain('emailLockedCta');
    expect(emailNotify).not.toMatch(/isFeatureActive\([^)]*EMAIL_NOTIFICATION/);
  });
});
