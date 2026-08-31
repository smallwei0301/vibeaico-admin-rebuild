/**
 * Atomic trip import contract — issue #8.
 *
 * These are intentionally split between the public payload-normalisation seam
 * and source locks for the security/transaction boundary that cannot be
 * exercised without the TEST Supabase project.
 */
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseAtomicTripImport } from '@/server/trip-import';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const source = (relative: string) => readFileSync(new URL(`../../${relative}`, import.meta.url), 'utf8');

describe('parseAtomicTripImport', () => {
  it('accepts a single object, raw array, and { trips }, with stable readable slugs', () => {
    const samples: unknown[] = [
      { title: '花蓮 賞鯨', activityPlans: [{ name: '上午團' }] },
      [{ title: '宜蘭獨木舟', activityPlans: [{ name: '雙人組' }] }],
      { trips: [{ title: '台東星空', activityPlans: [{ name: '夜間團' }] }] },
    ];

    for (const input of samples) {
      const [trip] = parseAtomicTripImport(input, 'tenant-a');
      expect(trip.slug).toMatch(/\S/);
      expect(trip.slug).not.toMatch(/^trip-\d+/);
      expect(trip.activityPlans[0].slug).toMatch(/\S/);
      expect(trip.activityPlans[0].slug).not.toMatch(/^plan-\d+/);
    }
  });

  it('rejects the complete batch before calling the RPC when a later item is invalid', () => {
    expect(() => parseAtomicTripImport([
      { title: '有效行程', activityPlans: [{ name: '有效方案' }] },
      { title: ' ', activityPlans: [{ name: '不應留下任何資料' }] },
    ], 'tenant-a')).toThrow(/title/);
  });

  it('rejects over 100 trips, over 100 plans, duplicate plan slugs, and unreadable slugs', () => {
    expect(() => parseAtomicTripImport(
      Array.from({ length: 101 }, (_, n) => ({ title: `行程-${n}` })), 'tenant-a',
    )).toThrow(/100/);
    expect(() => parseAtomicTripImport({
      title: '太多方案', activityPlans: Array.from({ length: 101 }, (_, n) => ({ name: `方案-${n}` })),
    }, 'tenant-a')).toThrow(/100/);
    expect(() => parseAtomicTripImport({
      title: '重複方案 slug', activityPlans: [{ name: '甲', slug: 'same' }, { name: '乙', slug: 'same' }],
    }, 'tenant-a')).toThrow(/duplicate/i);
    expect(parseAtomicTripImport({ title: '可回退的行程', slug: '!!!' }, 'tenant-a')[0].slug)
      .toBe('可回退的行程');
    expect(parseAtomicTripImport({
      title: '可回退的方案', activityPlans: [{ name: '標準方案', slug: '!!!' }],
    }, 'tenant-a')[0].activityPlans[0].slug).toBe('標準方案');
    expect(() => parseAtomicTripImport({ title: '!!!', slug: '???' }, 'tenant-a')).toThrow(/slug/i);
    expect(() => parseAtomicTripImport({
      title: '壞日期', activityPlans: [{ name: '方案', earliestDeparture: '2026-02-30' }],
    }, 'tenant-a')).toThrow(/日期/);
  });
});

describe('atomic import security source locks', () => {
  it('TEST seed gives every trip plan a nonempty, per-trip-unique slug before 0028 adds its constraint', () => {
    const seed = source('scripts/test/seed.mjs');
    const plansStart = seed.indexOf("'trip_plans'");
    const plansEnd = seed.indexOf('\n  );', plansStart);
    expect(plansStart).toBeGreaterThan(-1);
    expect(plansEnd).toBeGreaterThan(plansStart);
    const planSection = seed.slice(plansStart, plansEnd);
    const records = [...planSection.matchAll(/\{\s*id:\s*([^,]+),([\s\S]*?)\n\s*\},?/g)];
    const keys = records.map((record) => {
      const tripId = record[2].match(/trip_id:\s*([^,\n]+)/)?.[1]?.trim();
      const slug = record[2].match(/slug:\s*'([^']*)'/)?.[1];
      expect(tripId).toBeTruthy();
      expect(slug?.trim()).toBeTruthy();
      return `${tripId}:${slug}`;
    });
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('does not hide a trip-plan schema error or continue to its dependent departures', () => {
    const assertStrictMissingTableClassifier = (path: string) => {
      const script = source(path);
      const classifierStart = script.indexOf('function isMissingSchemaError(error)');
      const classifierEnd = script.indexOf('\n}\n', classifierStart) + 2;
      const classifier = script.slice(classifierStart, classifierEnd);
      expect(classifierStart).toBeGreaterThan(-1);
      expect(classifier).toMatch(/code\s*===\s*['"]PGRST205['"]/);
      expect(classifier).not.toMatch(/PGRST204|schema cache|PGRST202|42883/i);
      return script;
    };
    const seed = assertStrictMissingTableClassifier('scripts/test/seed.mjs');
    assertStrictMissingTableClassifier('scripts/test/reset-db.mjs');

    const planWrite = seed.indexOf("'trip_plans'");
    const departureWrite = seed.indexOf("'trip_departures'", planWrite);
    const parentResult = /const tripPlansSeeded = await safeUpsert\(\s*admin,\s*'trip_plans',/m.exec(seed);
    const parentGuard = seed.indexOf('trip_plans seed is required before trip_departures', planWrite);
    const parentFailClosed = seed.indexOf('if (!tripPlansSeeded)', planWrite);
    const departureResult = seed.indexOf('const tripDeparturesSeeded = await safeUpsert(', planWrite);
    expect(planWrite).toBeGreaterThan(-1);
    expect(parentResult).not.toBeNull();
    expect(parentResult?.index ?? -1).toBeLessThan(departureWrite);
    expect(parentGuard).toBeGreaterThan(planWrite);
    expect(parentGuard).toBeLessThan(departureWrite);
    expect(parentFailClosed).toBeGreaterThan(planWrite);
    expect(seed.slice(parentFailClosed, departureWrite)).toMatch(/throw new Error\(/);
    expect(departureResult).toBeGreaterThan(parentGuard);
    expect(seed.slice(departureResult)).toMatch(/if \(!tripDeparturesSeeded\)\s*\{\s*throw new Error\(/);
  });

  it('ships a forward migration that redefines the SECURITY INVOKER RPC and globally guards every plan writer', () => {
    expect(existsSync(`${ROOT}/supabase/migrations/0030_trip_plan_global_limit.sql`)).toBe(true);
    const migration = source('supabase/migrations/0030_trip_plan_global_limit.sql');
    expect(migration).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.import_trips_atomic/i);
    expect(migration).toMatch(/security\s+invoker/i);
    expect(migration).toMatch(/auth\.uid\(\)/i);
    expect(migration).toMatch(/role\s+in\s*\('OWNER',\s*'MANAGER'\)/i);
    expect(migration).toMatch(/revoke\s+all.*from\s+public/i);
    expect(migration).toMatch(/revoke\s+all.*from\s+anon/i);
    expect(migration).toMatch(/revoke\s+all.*from\s+service_role/i);
    expect(migration).toMatch(/grant\s+execute.*to\s+authenticated/i);
    expect(migration).toMatch(/create\s+(or\s+replace\s+)?function\s+public\.enforce_trip_plan_limit/i);
    expect(migration).toMatch(/security\s+definer/i);
    expect(migration).toMatch(/count\(\*\).*trip_plans/is);
    expect(migration).toMatch(/TRIP_PLAN_LIMIT/i);
    expect(migration).toMatch(/create\s+trigger\s+trip_plan_limit_guard\s+after\s+insert\s+on\s+public\.trip_plans\s+referencing\s+new\s+table\s+as\s+new_trip_plans\s+for\s+each\s+statement/is);
    expect(migration).toMatch(/create\s+trigger\s+trip_plan_limit_guard_update\s+after\s+update\s+on\s+public\.trip_plans\s+referencing\s+new\s+table\s+as\s+new_trip_plans\s+for\s+each\s+statement/is);

    // Keep this slice inside the one CTE statement.  The function also uses
    // WITH ORDINALITY while rebuilding input-order results; ending at
    // `v_results` used to let that later occurrence make this assertion pass
    // even when the plan INSERT itself had lost its deterministic ordering.
    const rpcStart = migration.indexOf('create or replace function public.import_trips_atomic');
    const planInsertStart = migration.indexOf('with inserted as (\n      insert into public.trip_plans', rpcStart);
    const planInsertEnd = migration.indexOf('\n\n    v_results := v_results ||', planInsertStart);
    expect(rpcStart).toBeGreaterThan(-1);
    expect(planInsertStart).toBeGreaterThan(rpcStart);
    expect(planInsertEnd).toBeGreaterThan(planInsertStart);
    const planInsert = migration.slice(planInsertStart, planInsertEnd);
    expect(planInsert).toMatch(
      /on\s+conflict\s+on\s+constraint\s+trip_plans_tenant_trip_slug_key\s+do\s+nothing/i,
    );
    expect(planInsert).not.toMatch(/on\s+conflict\s*\([^)]*\btrip_id\b[^)]*\)/i);
    expect(planInsert).toMatch(/jsonb_array_elements\(v_plans\)\s+with\s+ordinality/i);
    expect(planInsert).toMatch(/returning\s+1/i);
    expect(planInsert).toMatch(/select\s+count\(\*\)\s+into\s+v_plans_added\s+from\s+inserted/i);
    expect(migration.slice(rpcStart)).not.toMatch(/for\s+v_plan\s+in\s+select\s+value\s+from\s+jsonb_array_elements\(v_plans\)/i);
    expect(migration.slice(rpcStart)).toMatch(/duplicate trip slug/i);
    const planCountQuery = migration.slice(
      migration.indexOf('select count(*) into v_existing_plan_count'),
      migration.indexOf('if v_existing_plan_count + v_new_plan_count'),
    );
    expect(planCountQuery).toContain('from public.trip_plans tp');
    expect(planCountQuery).not.toMatch(/(?<!\.)\btrip_id\s*=/);
  });

  it('installs the global guard behind a write-blocking preflight lock and keeps the statement guard FK-compatible', () => {
    const assertStatementMigration = (path: string) => {
      const migration = source(path);
      const lock = migration.indexOf('lock table public.trip_plans in share row exclusive mode');
      const preflight = migration.indexOf('select tp.trip_id, count(*)', lock);
      const guardStart = migration.indexOf('create or replace function public.enforce_trip_plan_limit');
      const guardEnd = migration.indexOf('\n$$;', guardStart);
      expect(lock, `${path} must block plan writers before preflight`).toBeGreaterThan(-1);
      expect(preflight).toBeGreaterThan(lock);
      expect(guardStart).toBeGreaterThan(preflight);
      expect(guardEnd).toBeGreaterThan(guardStart);
      const guard = migration.slice(guardStart, guardEnd);
      expect(guard).toMatch(/for\s+no\s+key\s+update/i);
      expect(guard).not.toMatch(/for\s+update/i);
      expect(guard).toMatch(/from\s+new_trip_plans/i);
      expect(guard).toMatch(/group\s+by\s+n\.tenant_id,\s*n\.trip_id,\s*t\.slug/i);
      expect(guard).toMatch(/order\s+by\s+n\.tenant_id,\s*t\.slug,\s*n\.trip_id/i);
      expect(guard).toMatch(/return\s+null/i);
      expect(guard).toMatch(/TRIP_PLAN_LIMIT/i);
      expect(migration).toMatch(/create\s+trigger\s+trip_plan_limit_guard\s+after\s+insert[\s\S]*?referencing\s+new\s+table\s+as\s+new_trip_plans[\s\S]*?for\s+each\s+statement/i);
      // PostgreSQL forbids transition tables on UPDATE OF triggers, so this
      // update guard is statement-wide and groups its NEW rows once.
      expect(migration).toMatch(/create\s+trigger\s+trip_plan_limit_guard_update\s+after\s+update\s+on\s+public\.trip_plans[\s\S]*?referencing\s+new\s+table\s+as\s+new_trip_plans[\s\S]*?for\s+each\s+statement/i);
      expect(migration).not.toMatch(/trip_plan_limit_guard_update\s+after\s+update\s+of/i);
    };

    assertStatementMigration('supabase/migrations/0030_trip_plan_global_limit.sql');
    // 0031 is immutable history already applied to TEST.  0032 must be the
    // forward live repair rather than rewriting that recorded migration.
    expect(existsSync(`${ROOT}/supabase/migrations/0031_trip_plan_limit_lock_repair.sql`)).toBe(true);
    const historical0031 = source('supabase/migrations/0031_trip_plan_limit_lock_repair.sql');
    expect(historical0031).toMatch(/for\s+no\s+key\s+update/i);
    expect(historical0031).toMatch(/return\s+new/i);
    expect(historical0031).not.toMatch(/new_trip_plans/i);
    expect(existsSync(`${ROOT}/supabase/migrations/0032_trip_plan_statement_guard.sql`)).toBe(true);
    assertStatementMigration('supabase/migrations/0032_trip_plan_statement_guard.sql');
  });

  it('keeps the clean-install 0028 plan CTE ordered without leaking into its later result-order loop', () => {
    const migration = source('supabase/migrations/0028_trip_import_atomic.sql');
    const planInsertStart = migration.indexOf('with inserted as (\n      insert into public.trip_plans');
    const planInsertEnd = migration.indexOf('\n\n    v_results := v_results ||', planInsertStart);
    expect(planInsertStart).toBeGreaterThan(-1);
    expect(planInsertEnd).toBeGreaterThan(planInsertStart);
    const planInsert = migration.slice(planInsertStart, planInsertEnd);

    // This specifically guards 0028, which remains the migration a clean
    // database executes before the forward CREATE OR REPLACE in 0030.
    expect(planInsert).toMatch(/jsonb_array_elements\(v_plans\)\s+with\s+ordinality/i);
    expect(planInsert).toMatch(/order\s+by\s+p\.ordinal/i);
    expect(planInsert).toMatch(/returning\s+1/i);
    expect(planInsert).toMatch(/select\s+count\(\*\)\s+into\s+v_plans_added\s+from\s+inserted/i);
    expect(planInsert).not.toMatch(/with\s+ordinality\s+p\(value,\s*ordinal\).*v_results/is);
  });
  it('locks and upserts overlapping trip batches by slug before any trip write, while preserving input result order', () => {
    const migration = source('supabase/migrations/0030_trip_plan_global_limit.sql');
    const firstTripWrite = migration.indexOf('insert into public.trips');
    const existingLock = migration.indexOf('perform 1\n    from public.trips t\n   where t.tenant_id = p_tenant_id');
    const orderedUpsert = migration.indexOf("order by p.value->>'slug'", existingLock);
    const inputOrderResults = migration.lastIndexOf('with ordinality p(value, ordinal)');

    expect(existingLock).toBeGreaterThan(-1);
    expect(existingLock).toBeLessThan(firstTripWrite);
    expect(migration.slice(existingLock, firstTripWrite)).toMatch(/order by t\.slug\s+for update/i);
    expect(orderedUpsert).toBeGreaterThan(existingLock);
    expect(orderedUpsert).toBeLessThan(firstTripWrite);
    expect(inputOrderResults).toBeGreaterThan(firstTripWrite);
    expect(migration.slice(inputOrderResults)).toMatch(/order by p\.ordinal/i);
    expect(migration).toContain('Storage uses slug order; the public contract returns input order.');
  });

  it('route uses one session-client RPC after requireTenant(MANAGER), never service role', () => {
    const route = source('src/app/api/trips/import/route.ts');
    expect(route).toContain("requireTenant('MANAGER')");
    expect(route).toMatch(/t\.supabase\.rpc\('import_trips_atomic'/);
    expect((route.match(/\.rpc\(/g) ?? [])).toHaveLength(1);
    expect(route).not.toMatch(/createAdminSupabase|service[_ -]?role/i);
    expect(route).not.toMatch(/\.from\('(trips|trip_plans)'\)/);
    expect(route).toMatch(/error\.code\s*===\s*['"]22023['"]/);
    expect(route).toMatch(/new ApiHttpError\(400,.*ERR\.VALIDATION/s);
    expect(route).toMatch(/results.*原本的輸入順序/s);
  });

  it('direct plan POST maps the database-wide cap to a conflict instead of trusting its stale read count', () => {
    const route = source('src/app/api/trips/[id]/plans/route.ts');
    expect(route).toMatch(/error\?\.code\s*===\s*['"]P0001['"]/);
    expect(route).toContain('TRIP_PLAN_LIMIT');
    expect(route).toMatch(/new ApiHttpError\(409,\s*'每個行程最多 100 個方案',\s*ERR\.CONFLICT\)/);
  });

  it('export keeps the stable top-level trip slug needed for idempotent re-import', () => {
    const payload = source('src/server/trip-payload.ts');
    const exportSection = payload.slice(payload.indexOf('export function toTourPlatformJson'));
    expect(exportSection).toContain('slug: trip.slug');
  });
});
