import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const appliedMigration = readFileSync('supabase/migrations/0038_notification_outbox_delivery.sql', 'utf8');
const appliedRestrictionMigration = readFileSync('supabase/migrations/0038a_restrict_internal_notification_functions.sql', 'utf8');
const bookingModificationMigration = readFileSync('supabase/migrations/0042_notification_booking_modification_revision.sql', 'utf8');
const securityAlignmentMigration = readFileSync('supabase/migrations/0043_notification_delivery_security_alignment.sql', 'utf8');
const targetedClaimMigration = readFileSync('supabase/migrations/0044_notification_targeted_claim.sql', 'utf8');
const migration = `${appliedMigration}\n${appliedRestrictionMigration}\n${bookingModificationMigration}\n${securityAlignmentMigration}`;
const bookingRoute = readFileSync('src/app/api/bookings/route.ts', 'utf8');
const bookingCancelRoute = readFileSync('src/app/api/bookings/[id]/cancel/route.ts', 'utf8');
const settingsPage = readFileSync('src/app/tenant/settings/page.tsx', 'utf8');
const emailNotify = readFileSync('src/server/email/notify.ts', 'utf8');
const authSendCode = readFileSync('src/server/send-code.ts', 'utf8');
const lineNotify = readFileSync('src/server/line-notify.ts', 'utf8');
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

  it('isolates idempotency by tenant while treating NULL as one platform scope', () => {
    expect(securityAlignmentMigration).toMatch(/drop index if exists public\.notification_outbox_idempotency/i);
    expect(securityAlignmentMigration).toMatch(
      /create unique index notification_outbox_tenant_idempotency\s+on public\.notification_outbox \(tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key\) nulls not distinct/i,
    );
    expect(securityAlignmentMigration).toMatch(/group by event_name, aggregate_type, aggregate_id, idempotency_key\s+having count\(\*\) > 1/i);
    expect(securityAlignmentMigration).toMatch(/on conflict \(tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key\)/i);
    expect(readFileSync('src/server/notifications/health-report.ts', 'utf8'))
      .toContain("onConflict: 'tenant_id,event_name,aggregate_type,aggregate_id,idempotency_key'");
    expect(readFileSync('src/server/notifications/outbox.ts', 'utf8'))
      .toContain("onConflict: 'tenant_id,event_name,aggregate_type,aggregate_id,idempotency_key'");
  });

  it('uses #40 forward migration prefixes after #41-owned 0040 and 0041', () => {
    const migrations = readdirSync('supabase/migrations');
    expect(migrations).toContain('0042_notification_booking_modification_revision.sql');
    expect(migrations).toContain('0043_notification_delivery_security_alignment.sql');
    expect(migrations).not.toContain('0040_notification_booking_modification_revision.sql');
    expect(migrations).not.toContain('0041_notification_delivery_security_alignment.sql');
    expect(bookingModificationMigration).toContain('Prefixes 0040 and 0041 belong to the independently applied #41 formation');
    expect(securityAlignmentMigration).toContain('Prefixes 0040 and 0041 are already owned by #41 formation migrations.');
  });

  it('uses a transactional booking trigger and SKIP LOCKED claim rather than a best-effort direct provider call', () => {
    expect(migration).toMatch(/after insert or update of [^\n]+ on bookings/i);
    expect(migration).toMatch(/enqueue_notification_event/i);
    expect(migration).toMatch(/for update skip locked/i);
    expect(migration).toMatch(/processing_started_at < pg_catalog\.now\(\) - interval '10 minutes'/i);
  });

  it('treats provider ACCEPTED as terminal while retaining its precise delivery status', () => {
    expect(appliedMigration).toContain("status in ('PENDING', 'PROCESSING', 'RETRY')) then 'OPEN'");
    expect(appliedMigration).not.toContain("status in ('PENDING', 'PROCESSING', 'RETRY', 'ACCEPTED')) then 'OPEN'");
  });

  it('targeted outbox claims never reclaim non-reclaimable auth audit rows', () => {
    expect(targetedClaimMigration).toMatch(/d\\.status = 'PROCESSING'\\s+and d\\.reclaimable\\s+and d\\.processing_started_at < pg_catalog\\.now\\(\\) - interval '10 minutes'/i);
    expect(targetedClaimMigration).toMatch(/set search_path = ''/i);
    expect(targetedClaimMigration).toMatch(/revoke execute on function public\\.claim_notification_delivery_for_outbox\\(uuid\\) from public, anon, authenticated/i);
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

  it('does not run stale-worker side effects after a delivery claim lease was lost', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toMatch(/\.eq\('claim_token', delivery\.claim_token\)[\s\S]{0,80}\.select\('id'\)\.maybeSingle\(\)/);
    expect(outbox).toMatch(/if \(!persisted\) return;/);
    expect(outbox.indexOf('if (!persisted) return;')).toBeLessThan(outbox.indexOf('if (transition.bindingInvalid)'));
  });

  it('keeps ledger and privileged RPCs unavailable to browser roles', () => {
    expect(migration).toMatch(/alter table notification_outbox enable row level security/i);
    expect(migration).toMatch(/revoke all on table notification_outbox,[\s\S]*?from anon, authenticated/i);
    expect((migration.match(/revoke execute on function public\./gi) ?? []).length).toBeGreaterThanOrEqual(5);
    expect(migration).toMatch(/code_hash\s+bytea/i);
    expect(migration).toMatch(/primary key \(bot_id, update_id\)/i);
  });

  it('keeps trigger-internal RPCs unavailable even to service role while granting worker RPCs only there', () => {
    expect(appliedRestrictionMigration).toMatch(/revoke execute on function public\.enqueue_notification_event\([^;]+\)\s+from service_role/i);
    expect(appliedRestrictionMigration).toMatch(/revoke execute on function public\.enqueue_booking_notification_event\(\)\s+from service_role/i);
    for (const signature of [
      'claim_notification_deliveries(integer)',
      'refresh_notification_outbox_status(uuid)',
      'apply_resend_delivery_event(text, text, text, text, bytea)',
      'consume_telegram_bind_code(text, bigint, bytea, bigint)',
    ]) {
      expect(migration).toContain(`grant execute on function public.${signature} to service_role;`);
    }
    expect(migration).not.toContain('grant execute on function public.enqueue_notification_event(uuid, text, text, text, text, jsonb) to service_role;');
    expect(migration).not.toContain('grant execute on function public.enqueue_booking_notification_event() to service_role;');
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

  it('routes booking-status LINE messages through the delivery ledger instead of direct provider sends', () => {
    expect(migration).toContain("'BOOKING_LINE_CONFIRMED'");
    expect(lineNotify).toContain("admin.rpc('enqueue_booking_line_reminder'");
    expect(lineNotify).not.toContain("admin.rpc('enqueue_notification_event'");
    for (const route of [
      readFileSync('src/app/api/bookings/[id]/confirm/route.ts', 'utf8'),
      readFileSync('src/app/api/bookings/[id]/complete/route.ts', 'utf8'),
      readFileSync('src/app/api/bookings/[id]/no-show/route.ts', 'utf8'),
    ]) expect(route).not.toContain('notifyBookingStatus');
  });

  it('writes BOOKING_LINE_MODIFIED in the booking update transaction and wakes dispatch only after commit', () => {
    const bookingUpdateRoute = readFileSync('src/app/api/bookings/[id]/route.ts', 'utf8');
    expect(migration).toContain("'BOOKING_LINE_MODIFIED'");
    expect(migration).toMatch(/after insert or update of status, start_at, staff_id on bookings/i);
    expect(migration).toMatch(/new\.start_at is distinct from old\.start_at[\s\S]*?BOOKING_LINE_MODIFIED/i);
    expect(bookingUpdateRoute).toContain('dispatchAfterCommit()');
  });

  it('gives each distinct schedule or staff edit a durable modified-event key without retry randomness', () => {
    expect(appliedMigration).toMatch(/after insert or update of status on bookings/i);
    expect(appliedMigration).not.toContain('notification_revision');
    expect(bookingModificationMigration).toMatch(/add column if not exists notification_revision bigint not null default 0/i);
    expect(bookingModificationMigration).toMatch(/new\.notification_revision := old\.notification_revision \+ 1/i);
    expect(bookingModificationMigration).toMatch(/after insert or update of status, start_at, staff_id on bookings/i);
    expect(bookingModificationMigration).toContain("'booking-line-modified:' || new.id::text || ':v' || new.notification_revision::text");
    expect(bookingModificationMigration).toMatch(/revoke execute on function public\.enqueue_booking_notification_event\(\) from public, anon, authenticated/i);
  });

  it('uses 0043 only for forward auth, tenant binding, and trigger security alignment', () => {
    expect(appliedMigration).not.toContain('reclaimable');
    expect(appliedMigration).toMatch(/unique nulls not distinct \(tenant_id, subject_type, subject_ref\)/i);
    expect(bookingModificationMigration).toContain("set search_path = public, pg_temp");
    expect(securityAlignmentMigration).toMatch(/add column if not exists reclaimable boolean not null default true/i);
    expect(securityAlignmentMigration).toMatch(/create or replace function public\.enqueue_auth_verification_delivery/i);
    expect(securityAlignmentMigration).toMatch(/create or replace function public\.issue_tenant_telegram_bind_code/i);
    expect(securityAlignmentMigration).toMatch(/set search_path = ''/i);
    expect(securityAlignmentMigration).toMatch(/revoke execute on function public\.enqueue_booking_notification_event\(\) from service_role/i);
    expect(securityAlignmentMigration).toMatch(/telegram_bind_codes_tenant_id_idx/i);
  });

  it('passes the six-argument enqueue contract for every 0043 booking event', () => {
    const calls = [...securityAlignmentMigration.matchAll(/perform public\.enqueue_notification_event\(([\s\S]*?)\n\s*\);/g)];
    expect(calls).toHaveLength(7);
    for (const [, args] of calls) {
      expect(args).toMatch(/pg_catalog\.jsonb_build_object\('bookingId', new\.id::text\)/);
    }
  });

  it('keeps tenant binding lookup and invalidation scoped while preserving the platform-owner null branch', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toContain("if (delivery.destination_ref === 'PLATFORM_OWNER_TELEGRAM') return process.env.PLATFORM_TELEGRAM_CHAT_ID?.trim() || null;");
    expect(outbox).toMatch(/from\('telegram_bindings'\)\.select\('chat_id'\)[\s\S]*?\.eq\('tenant_id', delivery\.tenant_id\)/);
    expect(outbox).toMatch(/from\('telegram_bindings'\)\.update[\s\S]*?\.eq\('tenant_id', delivery\.tenant_id\)/);
  });

  it('does not treat a missing recipient-health key as a healthy Email recipient', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).not.toContain('if (!healthKey) return true;');
    expect(outbox).toContain("return { kind: 'retryable', code: 'RECIPIENT_HEALTH_KEY_MISSING' };");
    expect(outbox).toContain("code: 'EMAIL_UNHEALTHY'");
    expect((outbox.match(/const recipientGate = await emailRecipientGate\(admin, destination\);\s*if \(recipientGate\) return recipientGate;\s*return sendEmailWithResend/g) ?? []).length).toBe(2);
  });

  it('uses a service-only, booking-scoped reminder writer instead of the generic internal enqueue RPC', () => {
    const lineNotify = readFileSync('src/server/line-notify.ts', 'utf8');
    expect(lineNotify).not.toContain("admin.rpc('enqueue_notification_event'");
    expect(lineNotify).toContain("admin.rpc('enqueue_booking_line_reminder'");
    expect(securityAlignmentMigration).toMatch(/create or replace function public\.enqueue_booking_line_reminder/i);
    expect(securityAlignmentMigration).toMatch(/from public\.bookings b[\s\S]*?b\.id = p_booking_id[\s\S]*?b\.tenant_id = p_tenant_id/i);
    expect(securityAlignmentMigration).toMatch(/grant execute on function public\.enqueue_booking_line_reminder\(uuid, uuid\) to service_role/i);
    expect(securityAlignmentMigration).not.toMatch(/grant execute on function public\.enqueue_notification_event\([^;]+\) to service_role/i);
    const reminderCron = readFileSync('src/app/api/cron/booking-reminders/route.ts', 'utf8');
    expect(reminderCron.indexOf("await notifyBookingStatus(tenantId, b.id as string, 'REMINDER');")).toBeLessThan(reminderCron.indexOf('reminded++;'));
  });

  it('records interactive auth Email attempts in the delivery ledger before using Resend', () => {
    expect(authSendCode).toContain('dispatchAuthVerificationEmail');
    expect(authSendCode).not.toContain('sendVerificationCodeEmail');
    expect(migration).toContain('enqueue_auth_verification_delivery');
  });

  it('does not reclaim an address-less auth delivery after an inline sender crash', () => {
    expect(migration).toMatch(/reclaimable\s+boolean\s+not null default true/i);
    expect(migration).toMatch(/'AUTH_VERIFICATION_EMAIL'[\s\S]*?'PROCESSING', false/i);
    expect(migration).toMatch(/d\.status = 'PROCESSING' and d\.reclaimable\s+and/i);
  });

  it('keeps the normal booking route on its tenant-scoped client', () => {
    expect(bookingRoute).not.toContain('createAdminSupabase');
  });

  it('parses notify settings and dispatches provider, stale-pending, and DEAD alerts without waiting for daily cron', () => {
    const outbox = readFileSync('src/server/notifications/outbox.ts', 'utf8');
    expect(outbox).toContain('notifySettingsSchema.parse(settingsRaw?.notify ?? {})');
    expect(outbox).toContain('enqueueLiveProviderAlert');
    expect(outbox).toContain('enqueueStalePendingAlert');
    expect(outbox).toContain('dispatchPendingNotifications(admin, limit, false, sender)');
  });

  it('does not leave the basic booking Email path behind the paid feature gate', () => {
    expect(settingsPage).toContain('emailBaseline');
    expect(settingsPage).not.toContain('emailLockedCta');
    expect(emailNotify).not.toMatch(/isFeatureActive\([^)]*EMAIL_NOTIFICATION/);
  });
});
