import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0034_tour_staff_availability_and_addon_performance.sql', 'utf8');
const atomicMigration = readFileSync('supabase/migrations/0035_issue_37_atomic_write_boundaries.sql', 'utf8');
const departureRoute = readFileSync('src/app/api/trips/[id]/departures/route.ts', 'utf8');
const departureUpdateRoute = readFileSync('src/app/api/trip-departures/[id]/route.ts', 'utf8');
const batchRoute = readFileSync('src/app/api/trips/[id]/departures/batch/route.ts', 'utf8');
const bookingRoute = readFileSync('src/app/api/bookings/route.ts', 'utf8');
const bookingUpdateRoute = readFileSync('src/app/api/bookings/[id]/route.ts', 'utf8');
const completionRoute = readFileSync('src/app/api/tour-orders/[id]/complete/route.ts', 'utf8');

describe('issue #37 source migration contract', () => {
  it('adds tenant-scoped assignments, C+ snapshots, and no SOLO/TEAM mode', () => {
    expect(migration).toMatch(/create table trip_departure_staff/i);
    expect(migration).toMatch(/one_primary_staff_per_departure/i);
    expect(migration).toMatch(/foreign key \(tenant_id, departure_id\)/i);
    expect(migration).toMatch(/create table tour_order_addons/i);
    expect(migration).toMatch(/unit_price\s+numeric not null check \(unit_price >= 0\)/i);
    expect(migration).toMatch(/performance_mode.*PRIMARY.*SPECIFIC_STAFF.*NONE/is);
    expect(migration).toMatch(/availability_policy.*DEFAULT_AVAILABLE.*EXPLICIT_ONLY/is);
    expect(migration).not.toMatch(/guide_mode|solo\s*\|\s*team|tenant\.availability_policy/i);
  });

  it('uses a column-targeted SET NULL composite FK with a pre-17 fallback', () => {
    expect(migration).toMatch(/on delete set null \(specific_staff_id\)/i);
    expect(migration).toMatch(/on delete set null \(performance_staff_id\)/i);
    expect(migration).toMatch(/foreign key \(performance_staff_id\) references staff \(id\) on delete set null/i);
    expect(migration).toMatch(/foreign key \(tenant_id, performance_staff_id\).*on delete no action/is);
  });

  it('defines transaction RPCs for every availability-sensitive write and immutable completion', () => {
    expect(atomicMigration).toMatch(/create or replace function public\.lock_staff_availability/i);
    expect(atomicMigration).toMatch(/pg_advisory_xact_lock/i);
    expect(atomicMigration).toMatch(/create or replace function public\.assert_staff_available/i);
    expect(atomicMigration).toMatch(/create or replace function public\.save_trip_departure_with_staff/i);
    expect(atomicMigration).toMatch(/create or replace function public\.create_trip_departures_batch_with_staff/i);
    expect(atomicMigration).toMatch(/create or replace function public\.create_booking_with_availability/i);
    expect(atomicMigration).toMatch(/create or replace function public\.update_booking_with_availability/i);
    expect(atomicMigration).toMatch(/create or replace function public\.complete_tour_order_with_performance/i);
    expect(atomicMigration).toMatch(/status = 'COMPLETED'.*status = 'CONFIRMED'/is);
    expect(atomicMigration).toMatch(/performance_frozen_at = now\(\)/i);
  });

  it('wires each public write path to its atomic RPC rather than a split write', () => {
    expect(departureRoute).toMatch(/rpc\('save_trip_departure_with_staff'/);
    expect(departureUpdateRoute).toMatch(/rpc\('save_trip_departure_with_staff'/);
    expect(batchRoute).toMatch(/rpc\('create_trip_departures_batch_with_staff'/);
    expect(bookingRoute).toMatch(/rpc\('create_booking_with_availability'/);
    expect(bookingUpdateRoute).toMatch(/rpc\('update_booking_with_availability'/);
    expect(completionRoute).toMatch(/rpc\('complete_tour_order_with_performance'/);
  });
});
