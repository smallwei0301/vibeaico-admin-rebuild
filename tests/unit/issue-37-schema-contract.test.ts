import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0034_tour_staff_availability_and_addon_performance.sql', 'utf8');

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
});
