import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0127_issue_589_authz_constraint_reconciliation.sql', 'utf8');

describe('#589 authz and notified constraint reconciliation candidate', () => {
  it('fails closed on unknown policies and on legacy PENDING data before changing the check', () => {
    expect(migration).toContain('The G3/G6 runner provides the single outer transaction');
    expect(migration).not.toMatch(/^begin;$/im);
    expect(migration).not.toMatch(/^commit;$/im);
    expect(migration).toContain('lock table public.booking_addons, public.owner_notify_recipients in access exclusive mode;');
    expect(migration).toContain('alter table public.booking_addons enable row level security;');
    expect(migration).toContain('alter table public.owner_notify_recipients enable row level security;');
    expect(migration).toContain('a.attacl is not null');
    expect(migration).toContain("aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))");
    expect(migration).toContain("not in ('PUBLIC', 'anon', 'authenticated', 'service_role')");
    expect(migration).toContain("tablename = 'booking_addons'");
    expect(migration).toContain("tablename = 'owner_notify_recipients'");
    expect(migration).toContain("raise exception 'booking_addons has unknown policy names: %'");
    expect(migration).toContain("raise exception 'owner_notify_recipients has unknown policy names: %'");
    expect(migration).toContain("notified not in ('NONE', 'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED')");
    expect(migration).toContain("a.attname = 'notified' and a.attnum > 0 and not a.attisdropped;");
    expect(migration).toContain("v_type is distinct from 'text' or v_not_null is not true or v_default is distinct from '''NONE''::text'");
    expect(migration).toContain("raise exception 'booking_addons.notified contains non-canonical values: %'");
    expect(migration).not.toContain("'PENDING'::text");
    expect(migration).not.toMatch(/update\s+public\.booking_addons/i);
    expect(migration).not.toMatch(/delete\s+from\s+public\.booking_addons/i);
  });

  it('removes only legacy public CRUD policies and states the intended grants explicitly', () => {
    for (const operation of ['i', 'u', 'd']) {
      expect(migration).toContain(`drop policy if exists p_booking_addons_${operation} on public.booking_addons;`);
    }
    expect(migration).toContain('create policy p_booking_addons_s on public.booking_addons\n  for select to authenticated');
    expect(migration).toContain('revoke all on table public.booking_addons from public, anon, authenticated;');
    expect(migration).toContain('grant select on table public.booking_addons to authenticated;');
    expect(migration).toContain('grant all on table public.booking_addons to service_role;');
    for (const operation of ['s', 'i', 'u', 'd']) {
      expect(migration).toContain(`drop policy if exists p_owner_notify_recipients_${operation} on public.owner_notify_recipients;`);
    }
    expect(migration).toContain('create policy p_owner_notify_recipients_all on public.owner_notify_recipients\n  for all to authenticated');
    expect(migration).toContain('revoke all on table public.owner_notify_recipients from public, anon, authenticated;');
    expect(migration).toContain('grant select, insert, update, delete on table public.owner_notify_recipients to authenticated;');
    expect(migration).toContain('grant all on table public.owner_notify_recipients to service_role;');
  });
});
