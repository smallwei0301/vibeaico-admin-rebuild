/** Local-isolated proof only: deliberately pending on canonical TEST. */
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import postgres from 'postgres';
import { SHOP_A } from '../../fixtures';

const LOCAL_DB_URL = 'postgresql://postgres:postgres@127.0.0.1:54322/postgres';
const env = String(process.env.TEST_ENV_ID ?? process.env.LOCAL_PROJECT_ID ?? '');
const localDescribe = process.env.TEST_PROFILE === 'LOCAL_ISOLATED' && /^(local-pr-|local-schema-|vibeaico-)/.test(env)
  ? describe : describe.skip;
const migration = readFileSync('supabase/migrations/0127_issue_589_authz_constraint_reconciliation.sql', 'utf8');
let customerId = '';
let bookingId = '';

async function capture(db: ReturnType<typeof postgres>) {
  return db.unsafe(`select jsonb_build_object(
    'tables', (select jsonb_agg(jsonb_build_object('name', relname, 'rls', relrowsecurity, 'force', relforcerowsecurity, 'acl', coalesce(relacl::text, '')) order by relname) from pg_class where oid in ('public.booking_addons'::regclass, 'public.owner_notify_recipients'::regclass)),
    'policies', (select jsonb_agg(jsonb_build_object('table', tablename, 'name', policyname, 'command', cmd, 'roles', roles, 'using', qual, 'check', with_check) order by tablename, policyname) from pg_policies where schemaname = 'public' and tablename in ('booking_addons', 'owner_notify_recipients')),
    'columnAcls', (select jsonb_agg(jsonb_build_object('table', c.relname, 'column', a.attname, 'acl', a.attacl::text) order by c.relname, a.attname) from pg_attribute a join pg_class c on c.oid = a.attrelid where a.attrelid in ('public.booking_addons'::regclass, 'public.owner_notify_recipients'::regclass) and a.attnum > 0 and not a.attisdropped and a.attacl is not null),
    'constraint', (select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.booking_addons'::regclass and conname = 'booking_addons_notified_check'),
    'notifiedShape', (select jsonb_build_object('type', a.atttypid::regtype::text, 'notNull', a.attnotnull, 'default', pg_get_expr(d.adbin, d.adrelid)) from pg_attribute a left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum where a.attrelid = 'public.booking_addons'::regclass and a.attname = 'notified' and a.attnum > 0 and not a.attisdropped),
    'fixtureRows', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'notified', notified) order by id), '[]'::jsonb) from public.booking_addons where booking_id = '${bookingId}'::uuid)
  ) as snapshot`);
}

async function waitFor(predicate: () => Promise<boolean>, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return predicate();
}

localDescribe('Issue #589 isolated PostgreSQL reconciliation preconditions and rollback', () => {
  let db: ReturnType<typeof postgres>;

  beforeAll(async () => {
    db = postgres(LOCAL_DB_URL, { max: 6, prepare: false });
    customerId = randomUUID();
    bookingId = randomUUID();
    const now = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    await db.unsafe('insert into public.customers (id, tenant_id, name, phone, points, active) values ($1::uuid, $2::uuid, $3, $4, 0, true)', [customerId, SHOP_A.id, 'G3 0127 local fixture', '']);
    await db.unsafe(`insert into public.bookings (id, tenant_id, booking_no, customer_id, service_id, staff_id, start_at, end_at, duration_minutes, price, final_price, status, payment_status, source)
      values ($1::uuid, $2::uuid, $3, $4::uuid, $5::uuid, null, $6::timestamptz, ($6::timestamptz + interval '1 hour'), 60, 0, 0, 'PENDING', 'UNPAID', 'MANUAL')`, [bookingId, SHOP_A.id, `G3589${bookingId.slice(0, 8)}`, customerId, SHOP_A.serviceA1, now]);
  });
  afterEach(async () => { await db.unsafe('delete from public.booking_addons where booking_id = $1::uuid', [bookingId]); });
  afterAll(async () => {
    await db.unsafe('delete from public.bookings where id = $1::uuid', [bookingId]);
    await db.unsafe('delete from public.customers where id = $1::uuid', [customerId]);
    await db.end({ timeout: 2 });
  });

  it('PENDING precheck rolls back the reconciliation transaction without persistent ACL, policy, constraint, RLS, or row changes', async () => {
    const before = await capture(db);
    await expect(db.begin(async (tx) => {
      await tx.unsafe('alter table public.booking_addons drop constraint if exists booking_addons_notified_check');
      await tx.unsafe("insert into public.booking_addons (tenant_id, booking_id, name, notified) values ($1::uuid, $2::uuid, 'g3-589-0127-pending', 'PENDING')", [SHOP_A.id, bookingId]);
      await tx.unsafe(migration);
    })).rejects.toThrow(/non-canonical values/i);
    expect(await capture(db)).toEqual(before);
  });

  it('fails closed for unknown policy, unknown grantee, column ACL, and NULL/default shape preconditions', async () => {
    const cases = [
      ["create policy g3_589_unknown on public.booking_addons for select to authenticated using (true)", /unknown policy/i],
      ['grant select on public.booking_addons to pg_monitor', /unknown grantee/i],
      ['grant select(notified) on public.booking_addons to authenticated', /column ACL/i],
      ['alter table public.booking_addons alter column notified drop default', /must be text not null default/i],
      ['alter table public.booking_addons alter column notified drop not null', /must be text not null default/i],
      ["alter table public.booking_addons alter column notified type varchar using notified::varchar", /must be text not null default/i],
    ] as const;
    for (const [setup, expected] of cases) {
      const before = await capture(db);
      await expect(db.begin(async (tx) => { await tx.unsafe(setup); await tx.unsafe(migration); })).rejects.toThrow(expected);
      expect(await capture(db)).toEqual(before);
    }
  });

  it('applies the effective ACL intent inside a rolled-back transaction: authenticated has no TRUNCATE and service_role keeps ALL', async () => {
    await db.begin(async (tx) => {
      await tx.unsafe(migration);
      const rows = await tx.unsafe(`select table_name,
        has_table_privilege('anon', table_name, 'select') as anon_select,
        has_table_privilege('authenticated', table_name, 'select') as auth_select,
        has_table_privilege('authenticated', table_name, 'truncate') as auth_truncate,
        has_table_privilege('service_role', table_name, 'truncate') as service_truncate
        from unnest(array['public.booking_addons', 'public.owner_notify_recipients']) as table_name order by table_name`);
      expect(rows).toEqual([
        { table_name: 'public.booking_addons', anon_select: false, auth_select: true, auth_truncate: false, service_truncate: true },
        { table_name: 'public.owner_notify_recipients', anon_select: false, auth_select: true, auth_truncate: false, service_truncate: true },
      ]);
      throw new Error('intentional rollback after effective ACL readback');
    }).catch((error) => expect(error.message).toContain('intentional rollback'));
  });

  it('enforces the post-migration notified constraint for every canonical and rejected value under isolated rollback', async () => {
    for (const value of ['NONE', 'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED']) {
      const before = await capture(db);
      await db.begin(async (tx) => {
        await tx.unsafe(migration);
        const inserted = await tx.unsafe('insert into public.booking_addons (tenant_id, booking_id, name, notified) values ($1::uuid, $2::uuid, $3, $4) returning id, notified', [SHOP_A.id, bookingId, `g3-589-0127-${value}`, value]);
        expect(inserted).toHaveLength(1);
        expect(inserted[0]?.notified).toBe(value);
        throw new Error('rollback accepted canonical value');
      }).catch((error) => expect(error.message).toContain('rollback accepted canonical value'));
      expect(await capture(db)).toEqual(before);
    }
    for (const [value, code] of [[null, '23502'], ['PENDING', '23514'], ['UNEXPECTED', '23514']] as const) {
      const before = await capture(db);
      await expect(db.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx.unsafe('insert into public.booking_addons (tenant_id, booking_id, name, notified) values ($1::uuid, $2::uuid, $3, $4)', [SHOP_A.id, bookingId, 'g3-589-0127-invalid', value]);
      })).rejects.toMatchObject({ code });
      expect(await capture(db)).toEqual(before);
    }
  });

  it('preserves both NO FORCE and FORCE RLS states through the reconciliation transaction and rolls them back', async () => {
    for (const table of ['booking_addons', 'owner_notify_recipients']) {
      for (const [command, expected] of [['no force row level security', false], ['force row level security', true]] as const) {
        const before = await capture(db);
        await db.begin(async (tx) => {
          await tx.unsafe(`alter table public.${table} ${command}`);
          await tx.unsafe(migration);
          const forced = await tx.unsafe(`select relforcerowsecurity from pg_class where oid = 'public.${table}'::regclass`);
          expect(forced[0]?.relforcerowsecurity).toBe(expected);
          throw new Error('rollback force state');
        }).catch((error) => expect(error.message).toContain('rollback force state'));
        expect(await capture(db)).toEqual(before);
      }
    }
  });

  it('serializes concurrent reconciliation attempts on the fixed table-lock order without persisting either attempt', async () => {
    const before = await capture(db);
    const blocker = await db.reserve();
    const contender = postgres(LOCAL_DB_URL, { max: 1, prepare: false });
    try {
      await blocker.unsafe('begin');
      await blocker.unsafe('lock table public.booking_addons, public.owner_notify_recipients in access exclusive mode');
      const waiting = contender.begin(async (tx) => {
        await tx.unsafe("set local application_name = 'g3-589-0127-lock-race'");
        await tx.unsafe(`${migration}\nselect 1 / 0;`);
      });
      const settled = waiting.then(() => ({ ok: true as const }), (error) => ({ ok: false as const, error }));
      expect(await waitFor(async () => {
        const activity = await db.unsafe("select wait_event_type from pg_stat_activity where application_name = 'g3-589-0127-lock-race'");
        return activity.some((row) => row.wait_event_type === 'Lock');
      })).toBe(true);
      await blocker.unsafe('rollback');
      const result = await settled;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toMatchObject({ code: '22012' });
      expect(await capture(db)).toEqual(before);
    } finally {
      await blocker.unsafe('rollback').catch(() => undefined);
      blocker.release();
      await contender.end({ timeout: 2 }).catch(() => undefined);
    }
  });

  it('executes as one procedural statement without a client-side outer transaction', async () => {
    await expect(db.unsafe(migration)).resolves.toBeTruthy();
  });

  it('remains atomic with the G3/G6-style outer migration-and-ledger transaction', async () => {
    const before = await capture(db);
    const outer = postgres(LOCAL_DB_URL, { max: 1, prepare: false });
    try {
      await outer.unsafe('create temporary table g3_589_ledger_probe (name text primary key)');
      await expect(outer.begin(async (tx) => {
        await tx.unsafe(migration);
        await tx.unsafe("insert into g3_589_ledger_probe(name) values ('0127_issue_589_authz_constraint_reconciliation')");
        const ledger = await tx.unsafe('select name from g3_589_ledger_probe');
        expect(ledger).toEqual([{ name: '0127_issue_589_authz_constraint_reconciliation' }]);
        throw new Error('rollback outer migration-and-ledger transaction');
      })).rejects.toThrow(/rollback outer migration-and-ledger transaction/);
      expect(await outer.unsafe('select name from g3_589_ledger_probe')).toEqual([]);
      expect(await capture(db)).toEqual(before);
    } finally {
      await outer.end({ timeout: 2 });
    }
  });
});
