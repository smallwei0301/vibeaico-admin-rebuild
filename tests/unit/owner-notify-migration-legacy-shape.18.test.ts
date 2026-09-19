import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0064_issue_18_owner_notify_legacy_shape.sql', 'utf8');

describe('owner-notify canonical migration compatibility', () => {
  it('reconciles the historical recipient table before the fail-closed shape check', () => {
    expect(migration).toContain('alter table if exists public.owner_notify_recipients');
    expect(migration).toContain(
      'add column if not exists notify_new_booking boolean not null default true',
    );
    expect(migration).toContain(
      'add column if not exists notify_cancel boolean not null default true',
    );
  });
});
