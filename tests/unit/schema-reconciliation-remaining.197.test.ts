import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0082_reconcile_booking_addon_notify_fields.sql'),
  'utf8',
);

describe('Issue #197 remaining verified live-schema reconciliation', () => {
  it('canonicalizes the seven remaining verified drift columns', () => {
    for (const expected of [
      "attachment_path text not null default ''",
      'applied_amount numeric not null default 0',
      'applied_minutes integer not null default 0',
      "notified text not null default 'NONE'",
      'coupon_discount numeric',
      'points_redeemed integer',
      'owner_notify_max_recipients integer not null default 3',
    ]) {
      expect(migration).toContain(expected);
    }
  });

  it('uses idempotent column additions and preserves the two live checks', () => {
    expect(migration.match(/add column if not exists/g)?.length).toBe(7);
    expect(migration).toContain("conname = 'booking_addons_notified_check'");
    expect(migration).toContain("'QUOTA_EXCEEDED'::text");
    expect(migration).toContain("'FAILED'::text");
    expect(migration).toContain("conname = 'tenants_owner_notify_max_recipients_check'");
    expect(migration).toContain('owner_notify_max_recipients >= 1');
    expect(migration).toContain('owner_notify_max_recipients <= 20');
  });

  it('does not invent data repair, destructive DDL, or Production execution', () => {
    expect(migration).not.toMatch(/\bdelete\s+from\b/i);
    expect(migration).not.toMatch(/\bupdate\s+public\./i);
    expect(migration).not.toMatch(/\bdrop\s+(?:table|column)\b/i);
    expect(migration).not.toMatch(/\btruncate\b/i);
    expect(migration).not.toContain('apply_migration');
  });
});
