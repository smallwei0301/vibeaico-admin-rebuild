import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0116_issue_18_owner_notify.sql', 'utf8');

describe('owner-notify canonical migration compatibility', () => {
  it('reconciles the historical recipient table before the fail-closed shape check', () => {
    const repair = migration.indexOf('alter table public.owner_notify_recipients');
    const assertion = migration.indexOf('existing table has an incompatible shape');

    expect(repair).toBeGreaterThanOrEqual(0);
    expect(migration.slice(repair, assertion)).toContain(
      'add column if not exists notify_new_booking boolean not null default true',
    );
    expect(migration.slice(repair, assertion)).toContain(
      'add column if not exists notify_cancel boolean not null default true',
    );
    expect(assertion).toBeGreaterThan(repair);
  });
});
