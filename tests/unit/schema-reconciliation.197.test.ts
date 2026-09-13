import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/0079_reconcile_category_bug_report_fields.sql'),
  'utf8',
);

const runtimeSources = [
  'src/app/api/bug-report/route.ts',
  'src/app/api/service-categories/route.ts',
  'src/app/api/product-categories/route.ts',
].map((path) => readFileSync(resolve(process.cwd(), path), 'utf8')).join('\n');

describe('Issue #197 canonical schema reconciliation slice 1', () => {
  it('recreates only the six current-main fields already present in live Production', () => {
    for (const fragment of [
      "alter table public.service_categories",
      "add column if not exists description text not null default ''",
      'add column if not exists active boolean not null default true',
      'alter table public.product_categories',
      'alter table public.bug_reports',
      "add column if not exists subject text not null default ''",
      "add column if not exists contact_email text not null default ''",
    ]) {
      expect(migration).toContain(fragment);
    }
  });

  it('does not promote unrelated TEST-only or unadopted historical branch schema', () => {
    for (const forbidden of [
      'booking_addons',
      'attachment_path',
      'availability_policy',
      'notification_outbox',
      'telegram_',
      'tenant_payment_methods',
      'tour_order_addons',
    ]) {
      expect(migration).not.toContain(forbidden);
    }
  });

  it('points current runtime comments at the canonical migration instead of branch-only 0018', () => {
    expect(runtimeSources).not.toContain('migration 0018');
    expect(runtimeSources).toContain('migration 0079');
  });
});
