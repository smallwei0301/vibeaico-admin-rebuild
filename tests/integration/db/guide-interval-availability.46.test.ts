/** #46 SOURCE_PREPARE: native DB/ACL contract. Run only in an admitted isolated
 * or canonical lane. This predicate is read-only and is NOT a reservation proof. */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { releasePlanDigestOf } from '../../../scripts/agents/production-db-release-plan.mjs';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { SHOP_A, SHOP_B } from '../../fixtures';

const RPC = 'guide_staff_interval_available';
let sql: ReturnType<typeof postgres> | undefined;
const migration = '0135_issue_46_guide_interval_availability';
function admission() {
  const env = process.env;
  const url = new URL(env.TEST_SUPABASE_URL ?? 'http://not-admitted.invalid');
  if (env.TEST_PROFILE === 'LOCAL_ISOLATED') {
    if (!['127.0.0.1', 'localhost'].includes(url.hostname) || url.protocol !== 'http:' || url.port !== '54321'
      || !/^local-pr-[0-9]+-[a-z]+$/.test(env.TEST_ENV_ID ?? '')
      || !/^vibeaico-[0-9]+-[a-z]+$/.test(env.LOCAL_PROJECT_ID ?? '')
      || env.TEST_ENV_ID?.slice(9) !== env.LOCAL_PROJECT_ID?.slice(9)) {
      throw new Error('#46 LOCAL admission requires matching fixed local project identity and loopback API');
    }
    return { admitted: true, local: true };
  }
  if (!env.RELEASE_ID) return { admitted: false, local: false };
  if (!env.RUNNER_TEMP) throw new Error('#46 G3 requires fixed runner artifact directory');
  const plan = JSON.parse(readFileSync(join(env.RUNNER_TEMP, 'production-db-release-plan.json'), 'utf8'));
  const evidence = JSON.parse(readFileSync(join(env.RUNNER_TEMP, 'production-db-test-release-evidence.json'), 'utf8'));
  if (plan.repository !== 'smallwei0301/vibeaico-admin-rebuild' || evidence.repository !== plan.repository
    || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') || plan.mainSha !== env.GITHUB_SHA || evidence.mainSha !== plan.mainSha
    || plan.productionProjectRef !== 'egehnijjpgijmccagxac' || evidence.testProjectRef !== 'nmwhwngojosmagjuvxol'
    || url.origin !== 'https://nmwhwngojosmagjuvxol.supabase.co'
    || plan.releaseId !== env.RELEASE_ID || evidence.releaseId !== plan.releaseId
    || plan.planDigest !== releasePlanDigestOf(plan) || evidence.planDigest !== plan.planDigest
    || evidence.status !== 'TEST_RELEASE_PLAN_VERIFIED' || evidence.sourceRunId !== env.GITHUB_RUN_ID
    || evidence.sourceRunAttempt !== Number(env.GITHUB_RUN_ATTEMPT)
    || evidence.testMutationPerformed !== true || evidence.productionMutationPerformed !== false
    || evidence.databaseMutationAuthorized !== false || !Array.isArray(plan.migrations) || !Array.isArray(evidence.migrations)) {
    throw new Error('#46 G3 release artifacts do not bind this exact main/run/TEST execution');
  }
  const selected = plan.migrations.filter((row: { repoFile: string }) => row.repoFile === migration);
  const applied = evidence.migrations.filter((row: { repoFile: string }) => row.repoFile === migration);
  if (!selected.length && !applied.length) return { admitted: false, local: false };
  const path = `supabase/migrations/${migration}.sql`;
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (selected.length !== 1 || applied.length !== 1 || selected[0].path !== path
    || selected[0].sha256 !== digest || applied[0].sha256 !== digest
    || applied[0].riskTier !== selected[0].riskTier
    || !['APPLIED_VERIFIED', 'REPLAY_VERIFIED'].includes(applied[0].execution)) {
    throw new Error('#46 G3 requires unique exact 0135 bytes with verified TEST apply/replay');
  }
  return { admitted: true, local: false };
}
const lane = admission();
const isLocal = lane.local;
if (!lane.admitted) console.info('#46 POLICY_SKIP/NOT_RUN: 0135 SOURCE_PREPARE has no admitted LOCAL or exact canonical G3 release; no fixtures/auth run.');
let admin: SupabaseClient;
let anon: SupabaseClient;
let owner: SupabaseClient;
let tenant: string;
let staff: string;
const start = '2030-01-15T02:00:00Z';
const end = '2030-01-15T03:00:00Z';
function client(key: string) {
  return createClient(process.env.TEST_SUPABASE_URL!, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
async function insert(table: string, data: Record<string, unknown>) {
  const result = await admin.from(table).insert(data).select('id').single();
  expect(result.error, `${table} fixture`).toBeNull();
  return result.data!.id as string;
}
async function available(from: string | null = start, to: string | null = end, tenantId = tenant, staffId = staff) {
  const result = await admin.rpc(RPC, { p_tenant: tenantId, p_staff: staffId, p_start: from, p_end: to });
  expect(result.error, 'real DB primitive must execute').toBeNull();
  return result.data as boolean;
}
async function policy(value: string) {
  expect((await admin.from('staff').update({ availability_policy: value }).eq('tenant_id', tenant).eq('id', staff)).error).toBeNull();
}
async function timezone(value: unknown) {
  expect((await admin.from('tenant_settings').update({ basic: { timezone: value } }).eq('tenant_id', tenant)).error).toBeNull();
}
async function shift(date: string, from: string, to: string) {
  return insert('shifts', { tenant_id: tenant, staff_id: staff, work_date: date, start_time: from, end_time: to });
}
describe.runIf(lane.admitted)(lane.admitted ? 'Issue #46 admitted native availability contract' : '#46 POLICY_SKIP/NOT_RUN: SOURCE_PREPARE not admitted; no hooks/fixtures/auth', () => {
beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.TEST_SUPABASE_ANON_KEY).toBeTruthy();
  admin = client(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!);
  anon = client(process.env.TEST_SUPABASE_ANON_KEY!);
  owner = client(process.env.TEST_SUPABASE_ANON_KEY!);
  expect((await owner.auth.signInWithPassword(SHOP_A.owner)).error).toBeNull();
});
afterAll(async () => { await sql?.end({ timeout: 2 }); });
beforeEach(async () => {
  tenant = await insert('tenants', { shop_code: `g46-${randomUUID()}`, name: '#46 disposable availability', business_type: 'GUIDE' });
  staff = await insert('staff', { tenant_id: tenant, name: 'isolated guide' });
  expect((await admin.from('tenant_settings').insert({ tenant_id: tenant, basic: { timezone: 'Asia/Taipei' } })).error).toBeNull();
});
afterEach(async () => {
  if (!tenant) return;
  // bookings have restrict customer/service FKs; remove them before the owned
  // fixture tenant cascade. No shared seeded staff/settings are mutated.
  expect((await admin.from('trip_departure_staff').delete().eq('tenant_id', tenant)).error).toBeNull();
  expect((await admin.from('bookings').delete().eq('tenant_id', tenant)).error).toBeNull();
  expect((await admin.from('tenants').delete().eq('id', tenant)).error).toBeNull();
});

describe('0135 staff policy and service-only tenant interval predicate', () => {
  it('persists canonical default and two-value CHECK, refusing unknown/null policy', async () => {
    const row = await admin.from('staff').select('availability_policy').eq('tenant_id', tenant).eq('id', staff).single();
    expect(row.error).toBeNull(); expect(row.data!.availability_policy).toBe('DEFAULT_AVAILABLE');
    for (const value of ['TENANT_DEFAULT', null]) {
      const result = await admin.from('staff').update({ availability_policy: value }).eq('id', staff);
      expect(result.error?.code).toBe(value === null ? '23502' : '23514');
    }
    await policy('EXPLICIT_ONLY');
    expect((await admin.from('staff').select('availability_policy').eq('id', staff).single()).data!.availability_policy).toBe('EXPLICIT_ONLY');
  });
  it('allows default policy without shifts but excludes foreign/missing/inactive/unbookable staff', async () => {
    expect(await available()).toBe(true);
    expect(await available(start, end, SHOP_B.id)).toBe(false);
    expect(await available(start, end, tenant, randomUUID())).toBe(false);
    for (const patch of [{ active: false }, { active: true, bookable: false }]) {
      expect((await admin.from('staff').update(patch).eq('id', staff)).error).toBeNull();
      expect(await available()).toBe(false);
    }
  });
  it.each([[null, end], [start, null], [end, start], [start, start], ['-infinity', end], [start, 'infinity']])('fails closed for invalid interval %s/%s', async (from, to) => {
    expect(await available(from, to)).toBe(false);
  });
  it('revokes both authenticated and anonymous invocation while service role works', async () => {
    expect(await available()).toBe(true);
    for (const caller of [anon, owner]) {
      const result = await caller.rpc(RPC, { p_tenant: tenant, p_staff: staff, p_start: start, p_end: end });
      expect(result.error).not.toBeNull(); expect(result.data).toBeNull();
      expect(['42501', 'PGRST202']).toContain(result.error!.code);
    }
  });
  it('requires whole interval union coverage; adjacent shifts join, a gap rejects', async () => {
    await policy('EXPLICIT_ONLY'); expect(await available()).toBe(false);
    await shift('2030-01-15', '10:00', '10:30');
    const second = await shift('2030-01-15', '10:30', '11:00');
    expect(await available()).toBe(true);
    expect((await admin.from('shifts').update({ start_time: '10:31' }).eq('id', second)).error).toBeNull();
    expect(await available()).toBe(false);
    // DEFAULT_AVAILABLE does not inherit another employee's shift requirement.
    await policy('DEFAULT_AVAILABLE'); expect(await available()).toBe(true);
  });
  it('uses tenant Tokyo and New York DST calendar wall times for shifts', async () => {
    await policy('EXPLICIT_ONLY'); await timezone('Asia/Tokyo');
    await shift('2030-01-15', '00:00', '01:00');
    expect(await available('2030-01-14T15:00:00Z', '2030-01-14T16:00:00Z')).toBe(true);
    await timezone('America/New_York');
    await shift('2030-03-10', '00:00', '04:00');
    expect(await available('2030-03-10T05:00:00Z', '2030-03-10T08:00:00Z')).toBe(true);
  });
  it.each([['2030-03-10', '02:30', '04:00'], ['2030-11-03', '01:30', '03:00']])('fails closed for DST gap/fold shift %s', async (day, from, to) => {
    await timezone('America/New_York'); await policy('EXPLICIT_ONLY'); await shift(day, from, to);
    expect(await available(`${day}T07:00:00Z`, `${day}T07:30:00Z`)).toBe(false);
  });
  it.each([null, '', 'invalid/zone', 8])('fails closed for corrupt timezone %s', async zone => {
    await timezone(zone); expect(await available()).toBe(false);
  });
  it('uses default only for missing legacy settings', async () => {
    expect((await admin.from('tenant_settings').delete().eq('tenant_id', tenant)).error).toBeNull();
    expect(await available()).toBe(true);
  });
  it.each(['PENDING', 'CONFIRMED', 'CANCELLED', 'COMPLETED'])('booking %s has the canonical occupancy behavior', async status => {
    const customer = await insert('customers', { tenant_id: tenant, name: 'disposable traveler' });
    const service = await insert('services', { tenant_id: tenant, name: 'disposable service' });
    await insert('bookings', { tenant_id: tenant, booking_no: `G46-${randomUUID()}`, customer_id: customer,
      service_id: service, staff_id: staff, start_at: start, end_at: end, duration_minutes: 60, status, source: 'MANUAL' });
    expect(await available()).toBe(!['PENDING', 'CONFIRMED'].includes(status));
    expect(await available(end, '2030-01-15T04:00:00Z')).toBe(true); // half-open endpoint
  });
  it.each([null, 'personal'])('single block includes whole-tenant/personal scope %s', async scope => {
    await insert('block_times', { tenant_id: tenant, staff_id: scope ? staff : null, start_at: start, end_at: end });
    expect(await available()).toBe(false);
  });
  it('weekly block follows tenant calendar and retained duration across DST, not fixed +08', async () => {
    await timezone('America/New_York');
    await insert('block_times', { tenant_id: tenant, staff_id: staff, recurrence: 'WEEKLY', day_of_week: 0,
      start_at: '2030-03-03T15:00:00Z', end_at: '2030-03-03T16:00:00Z' });
    expect(await available('2030-03-10T14:00:00Z', '2030-03-10T15:00:00Z')).toBe(false);
    expect(await available('2030-03-10T15:00:00Z', '2030-03-10T16:00:00Z')).toBe(true);
  });
  it.each([
    ['2030-11-03T04:00:00Z', '2030-11-04T05:00:00Z', '2030-11-04T04:30:00Z'],
    ['2030-03-10T05:00:00Z', '2030-03-11T04:00:00Z', '2030-03-11T03:30:00Z'],
  ])('full-day weekly block ends at next local midnight %s', async (from, boundary, lastHalfHour) => {
    await timezone('America/New_York');
    await insert('block_times', { tenant_id: tenant, staff_id: staff, recurrence: 'WEEKLY', day_of_week: 0,
      full_day: true, start_at: '2030-01-06T05:00:00Z', end_at: '2030-01-07T05:00:00Z' });
    expect(await available(from, new Date(Date.parse(from)+30*60_000).toISOString())).toBe(false);
    expect(await available(lastHalfHour, boundary)).toBe(false);
    expect(await available(boundary, new Date(Date.parse(boundary)+30*60_000).toISOString())).toBe(true);
  });
  it('unrelated historical/future ambiguous shifts and departures do not poison a covered interval', async () => {
    await timezone('America/New_York'); await policy('EXPLICIT_ONLY');
    await shift('2030-01-15', '10:00', '11:00');
    await shift('2029-11-04', '01:30', '03:00');
    await shift('2030-11-03', '01:30', '03:00');
    const trip = await insert('trips', { tenant_id: tenant, slug: `g46-${randomUUID()}`, title: 'unrelated ambiguous departures' });
    const plan = await insert('trip_plans', { tenant_id: tenant, trip_id: trip, name: 'plan', price_per_person: 100, duration_minutes: 120 });
    for (const departs_on of ['2029-11-04', '2030-11-03']) {
      const departure = await insert('trip_departures', { tenant_id: tenant, trip_id: trip, plan_id: plan,
        departs_on, start_time: '01:30', capacity: 8, status: 'CLOSED' });
      await insert('trip_departure_staff', { tenant_id: tenant, departure_id: departure, staff_id: staff, role: 'PRIMARY' });
    }
    expect(await available('2030-01-15T15:00:00Z', '2030-01-15T16:00:00Z')).toBe(true);
    await policy('DEFAULT_AVAILABLE');
    expect(await available('2030-11-03T05:45:00Z', '2030-11-03T06:00:00Z')).toBe(false);
    // Duration extending past local midnight must remain occupied.
    expect((await admin.from('trip_plans').update({ duration_minutes: 2880 }).eq('id', plan)).error).toBeNull();
    expect(await available('2030-11-04T17:00:00Z', '2030-11-04T18:00:00Z')).toBe(false);
  });
  it('ambiguous recurring block wall time cannot report available', async () => {
    await timezone('America/New_York');
    await insert('block_times', { tenant_id: tenant, staff_id: staff, recurrence: 'WEEKLY', day_of_week: 0,
      start_at: '2030-10-27T05:30:00Z', end_at: '2030-10-27T06:30:00Z' });
    expect(await available('2030-11-03T05:45:00Z', '2030-11-03T06:00:00Z')).toBe(false);
  });
  it.each(['PRIMARY', 'ASSISTANT'])('noncancelled departure blocks %s using Plan duration; cancellation releases', async role => {
    const trip = await insert('trips', { tenant_id: tenant, slug: `g46-${randomUUID()}`, title: 'disposable trip', duration_hours: 1 });
    const plan = await insert('trip_plans', { tenant_id: tenant, trip_id: trip, name: 'disposable plan', price_per_person: 100, duration_minutes: 120 });
    const departure = await insert('trip_departures', { tenant_id: tenant, trip_id: trip, plan_id: plan,
      departs_on: '2030-01-15', start_time: '10:00', capacity: 8, status: 'CLOSED' });
    await insert('trip_departure_staff', { tenant_id: tenant, departure_id: departure, staff_id: staff, role });
    expect(await available('2030-01-15T03:30:00Z', '2030-01-15T04:00:00Z')).toBe(false);
    expect(await available('2030-01-15T04:00:00Z', '2030-01-15T05:00:00Z')).toBe(true);
    expect((await admin.from('trip_departures').update({ status: 'CANCELLED' }).eq('id', departure)).error).toBeNull();
    expect(await available()).toBe(true);
  });
  it('no-time departure occupies the tenant calendar day (23-hour DST day)', async () => {
    await timezone('America/New_York');
    const trip = await insert('trips', { tenant_id: tenant, slug: `g46-${randomUUID()}`, title: 'disposable trip' });
    const plan = await insert('trip_plans', { tenant_id: tenant, trip_id: trip, name: 'plan', price_per_person: 100 });
    const dep = await insert('trip_departures', { tenant_id: tenant, trip_id: trip, plan_id: plan, departs_on: '2030-03-10', capacity: 8 });
    await insert('trip_departure_staff', { tenant_id: tenant, departure_id: dep, staff_id: staff, role: 'PRIMARY' });
    expect(await available('2030-03-10T05:00:00Z', '2030-03-10T05:30:00Z')).toBe(false);
    expect(await available('2030-03-11T04:00:00Z', '2030-03-11T05:00:00Z')).toBe(true);
  });
  it('active external ERROR keeps cached UTC busy truth, inactive does not block', async () => {
    const calendar = await insert('external_calendars', { tenant_id: tenant, staff_id: staff, name: 'disposable calendar',
      ics_url: 'https://example.test/46.ics', active: true, last_sync_status: 'ERROR' });
    await insert('external_calendar_events', { tenant_id: tenant, external_calendar_id: calendar, uid: randomUUID(), title: 'cached busy', start_at: start, end_at: end });
    expect(await available()).toBe(false);
    expect((await admin.from('external_calendars').update({ active: false }).eq('id', calendar)).error).toBeNull();
    expect(await available()).toBe(true);
  });
  it('fails closed for a mismatched cached-event tenant instead of silently ignoring it', async () => {
    const calendar = await insert('external_calendars', { tenant_id: tenant, staff_id: staff,
      name: 'disposable mismatched cache', ics_url: 'https://example.test/46.ics' });
    // 0115 has separate tenant and subscription FKs; service-role corruption must
    // not turn a required conflict source into an empty successful lookup.
    await insert('external_calendar_events', { tenant_id: SHOP_B.id, external_calendar_id: calendar,
      uid: randomUUID(), title: 'mismatched tenant fixture', start_at: start, end_at: end });
    expect(await available()).toBe(false);
  });

  it('rejects Kwajalein 23-hour fold, while unambiguous adjacent calendar dates are covered', async () => {
    await timezone('Pacific/Kwajalein'); await policy('EXPLICIT_ONLY');
    const earlier = await shift('1969-09-29', '12:00', '13:00');
    expect(await available('1969-09-29T01:00:00Z', '1969-09-29T01:30:00Z')).toBe(true);
    expect((await admin.from('shifts').delete().eq('id', earlier)).error).toBeNull();
    const later = await shift('1969-10-01', '12:00', '13:00');
    expect(await available('1969-10-02T00:00:00Z', '1969-10-02T00:30:00Z')).toBe(true);
    expect((await admin.from('shifts').delete().eq('id', later)).error).toBeNull();
    await shift('1969-09-30', '12:00', '13:00');
    // Both UTC interpretations must be unavailable, including the second one
    // that PostgreSQL normally chooses and the old +/-180m search missed.
    expect(await available('1969-09-30T01:00:00Z', '1969-09-30T01:30:00Z')).toBe(false);
    expect(await available('1969-10-01T00:00:00Z', '1969-10-01T00:30:00Z')).toBe(false);
  });
  it.runIf(isLocal)('reads actual isolated PostgreSQL tzdata and function ACL/catalog', async () => {
    // Same admitted local transport as production-db-writer-mechanics.447;
    // never guess a remote DB URL or use Python timezone data as a PG proof.
    sql = postgres('postgresql://postgres:postgres@127.0.0.1:54322/postgres', { max: 1, prepare: false });
    const wall = await sql`
      select to_char('1969-09-30T01:00:00Z'::timestamptz at time zone 'Pacific/Kwajalein', 'YYYY-MM-DD HH24:MI') early,
        to_char('1969-10-01T00:00:00Z'::timestamptz at time zone 'Pacific/Kwajalein', 'YYYY-MM-DD HH24:MI') late`;
    expect(wall[0]).toEqual({ early: '1969-09-30 12:00', late: '1969-09-30 12:00' });
    const catalog = await sql`
      select p.prosecdef, p.provolatile, p.proconfig,
        has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
        has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
        has_function_privilege('service_role',p.oid,'EXECUTE') service_exec
      from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='guide_staff_interval_available'`;
    expect(catalog).toHaveLength(1);
    expect(catalog[0]).toMatchObject({ prosecdef: false, provolatile: 's', anon_exec: false, auth_exec: false, service_exec: true });
    expect(catalog[0].proconfig).toContain('search_path=pg_catalog, public');
  });

});

});
