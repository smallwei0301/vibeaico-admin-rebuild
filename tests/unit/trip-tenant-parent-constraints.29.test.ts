/**
 * Source lock for issue #8's tenant/parent database boundary.
 *
 * The integration companion proves PostgreSQL rejects invalid rows.  This file
 * locks the migration's public schema contract so a later edit cannot quietly
 * remove one edge from the tenant → trip → plan → departure graph.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const migration = readFileSync(
  resolve(ROOT, 'supabase/migrations/0029_trip_tenant_parent_constraints.sql'),
  'utf8',
).toLowerCase();
const integration = readFileSync(
  resolve(ROOT, 'tests/integration/db/trip-tenant-parent-constraints.29.test.ts'),
  'utf8',
);

function normalized(pattern: RegExp) {
  return expect(migration.replace(/\s+/g, ' ')).toMatch(pattern);
}

describe('0029 tenant/parent constraints', () => {
  it('preflights every legacy graph edge before the first ALTER TABLE mutation', () => {
    const preflightStart = migration.indexOf('do $$');
    const firstAlter = migration.indexOf('alter table');
    const preflight = migration.slice(preflightStart, firstAlter);
    const normalizedPreflight = preflight.replace(/\s+/g, ' ');

    expect(preflightStart).toBeGreaterThanOrEqual(0);
    expect(firstAlter).toBeGreaterThan(preflightStart);
    expect(preflight).toMatch(/raise exception using[\s\S]+no schema changes were applied/);

    for (const [relation, query] of [
      ['trip_plans.trip_id -> trips.id', 'v_trip_plans_trip_mismatches from trip_plans child join trips parent'],
      ['trip_addons.trip_id -> trips.id', 'v_trip_addons_trip_mismatches from trip_addons child join trips parent'],
      ['trip_departures.trip_id -> trips.id', 'v_trip_departures_trip_mismatches from trip_departures child join trips parent'],
      ['trip_departures.(tenant_id, trip_id, plan_id) -> trip_plans.(tenant_id, trip_id, id)', 'v_trip_departures_trip_plan_mismatches from trip_departures child join trip_plans parent'],
      ['tour_orders.trip_id -> trips.id', 'v_tour_orders_trip_mismatches from tour_orders child join trips parent'],
      ['tour_orders.(tenant_id, trip_id, plan_id) -> trip_plans.(tenant_id, trip_id, id)', 'v_tour_orders_trip_plan_mismatches from tour_orders child join trip_plans parent'],
      ['tour_orders.(tenant_id, trip_id, plan_id, departure_id) -> trip_departures.(tenant_id, trip_id, plan_id, id)', 'v_tour_orders_trip_plan_departure_mismatches from tour_orders child join trip_departures parent'],
      ['tour_orders.customer_id -> customers.id (optional)', 'v_tour_orders_customer_mismatches from tour_orders child join customers parent'],
    ]) {
      expect(preflight).toContain(relation);
      expect(normalizedPreflight).toContain(query);
    }
  });

  it('gives every tenant-scoped tour table a composite tenant/id unique key', () => {
    for (const table of ['trips', 'customers', 'trip_plans', 'trip_addons', 'trip_departures', 'tour_orders']) {
      normalized(new RegExp(`alter table ${table} add constraint ${table}_tenant_id_id_key unique \\(tenant_id, id\\)`));
    }
  });

  it('uses composite foreign keys for every parent edge and preserves delete intent', () => {
    normalized(/trip_plans_tenant_trip_fkey foreign key \(tenant_id, trip_id\) references trips \(tenant_id, id\) on delete cascade/);
    normalized(/trip_addons_tenant_trip_fkey foreign key \(tenant_id, trip_id\) references trips \(tenant_id, id\) on delete cascade/);
    normalized(/trip_departures_tenant_trip_fkey foreign key \(tenant_id, trip_id\) references trips \(tenant_id, id\) on delete cascade/);
    normalized(/trip_departures_tenant_trip_plan_fkey foreign key \(tenant_id, trip_id, plan_id\) references trip_plans \(tenant_id, trip_id, id\) on delete cascade/);
    normalized(/tour_orders_tenant_trip_fkey foreign key \(tenant_id, trip_id\) references trips \(tenant_id, id\) on delete restrict/);
    normalized(/tour_orders_tenant_trip_plan_fkey foreign key \(tenant_id, trip_id, plan_id\) references trip_plans \(tenant_id, trip_id, id\) on delete restrict/);
    normalized(/tour_orders_tenant_trip_plan_departure_fkey foreign key \(tenant_id, trip_id, plan_id, departure_id\) references trip_departures \(tenant_id, trip_id, plan_id, id\) on delete restrict/);
  });

  it('keeps customer deletion as customer_id-only SET NULL on PostgreSQL 17+, with a pre-17 compatible fallback', () => {
    expect(migration).toMatch(/server_version_num[^\n]+170000/);
    normalized(/tour_orders_tenant_customer_fkey foreign key \(tenant_id, customer_id\) references customers \(tenant_id, id\) on delete set null \(customer_id\)/);
    normalized(/tour_orders_customer_id_fkey foreign key \(customer_id\) references customers \(id\) on delete set null/);
    normalized(/tour_orders_tenant_customer_fkey foreign key \(tenant_id, customer_id\) references customers \(tenant_id, id\) on delete no action/);
  });

  it('bounds and labels every real-DB operation so a stalled test identifies its exact step', () => {
    expect(integration).toMatch(/const DB_TIMEOUT_MS = 20_000/);
    expect(integration).toMatch(/function dbQuery[\s\S]+AbortSignal\.timeout\(DB_TIMEOUT_MS\)/);
    expect(integration).toMatch(/setup tripA1/);
    expect(integration).toMatch(/cleanup tour_orders/);
    expect(integration).toMatch(/residual query tour_orders/);
  });
});
