import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0037_notification_outbox_delivery.sql', 'utf8');
const bookingRoute = readFileSync('src/app/api/bookings/route.ts', 'utf8');
const bookingCancelRoute = readFileSync('src/app/api/bookings/[id]/cancel/route.ts', 'utf8');
const settingsPage = readFileSync('src/app/tenant/settings/page.tsx', 'utf8');
const emailNotify = readFileSync('src/server/email/notify.ts', 'utf8');

describe('notification outbox schema contract (#40, 17 §1–4)', () => {
  it('has separate idempotent event, per-recipient delivery, health, binding, and webhook-ledger tables', () => {
    for (const table of [
      'notification_outbox', 'notification_deliveries', 'notification_health_reports',
      'telegram_bindings', 'telegram_bind_codes', 'telegram_webhook_updates',
    ]) expect(migration).toMatch(new RegExp(`create table ${table}`, 'i'));
    expect(migration).toMatch(/unique index notification_outbox_idempotency/i);
    expect(migration).toMatch(/unique \(outbox_id, recipient_type, recipient_ref, channel\)/i);
    expect(migration).toMatch(/status in \('PENDING', 'PROCESSING', 'ACCEPTED', 'DELIVERED', 'RETRY', 'DEAD', 'SKIPPED'\)/i);
  });

  it('uses a transactional booking trigger and SKIP LOCKED claim rather than a best-effort direct provider call', () => {
    expect(migration).toMatch(/after insert or update of status on bookings/i);
    expect(migration).toMatch(/enqueue_notification_event/i);
    expect(migration).toMatch(/for update skip locked/i);
    expect(migration).toMatch(/processing_started_at < now\(\) - interval '10 minutes'/i);
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
    expect((migration.match(/revoke execute on function public\./gi) ?? []).length).toBeGreaterThanOrEqual(4);
    expect(migration).toMatch(/code_hash\s+bytea/i);
    expect(migration).toMatch(/primary key \(bot_id, update_id\)/i);
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
