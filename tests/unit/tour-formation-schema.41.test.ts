import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDirectory = 'supabase/migrations';
const issue41Migration = '0040_issue_41_group_formation_lifecycle.sql';
const issue41HardeningMigration = '0041_issue_41_group_formation_lifecycle_hardening.sql';
const migration = readFileSync(`${migrationDirectory}/${issue41Migration}`, 'utf8');
const normalizedMigration = migration.replace(/\s+/g, ' ');
const hardeningMigration = readFileSync(`${migrationDirectory}/${issue41HardeningMigration}`, 'utf8');
const normalizedHardeningMigration = hardeningMigration.replace(/\s+/g, ' ');

describe('#41 schema migration ordering', () => {
  it('keeps every numeric migration prefix globally unique and reserves 0040 for #41', () => {
    const migrationFiles = readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'));
    const prefixes = migrationFiles.map((file) => {
      const match = /^(\d+)_/.exec(file);
      expect(match, `${file} must start with a numeric migration prefix`).not.toBeNull();
      return match![1];
    });
    const issue41Files = migrationFiles
      .filter((file) => file.endsWith('_issue_41_group_formation_lifecycle.sql'));

    expect(new Set(prefixes).size).toBe(prefixes.length);
    expect(migrationFiles.filter((file) => file.startsWith('0040_'))).toEqual([issue41Migration]);
    expect(issue41Files).toEqual([issue41Migration]);
    expect(migrationFiles).toContain(issue41HardeningMigration);
  });

  it('backfills non-scheduled legacy plans as PRIVATE and prevents underpaid statuses', () => {
    expect(normalizedMigration).toContain("when booking_type in ('INSTANT', 'REQUEST') then 'PRIVATE'");
    expect(normalizedMigration).toMatch(/payment_status <> 'PARTIAL' or \(paid_amount > 0 and paid_amount >= upfront_required_amount\)/);
    expect(normalizedMigration).toMatch(/payment_status <> 'PAID' or paid_amount = total_amount/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_FIXED' then o\.payment_status in \('PARTIAL', 'PAID'\) and o\.paid_amount >= o\.upfront_required_amount/);
    expect(normalizedMigration).toMatch(/when 'FULL' then o\.payment_status = 'PAID' and o\.paid_amount >= o\.total_amount/);
  });

  it('keeps an accepted risk baseline and rejects a non-manager actor', () => {
    expect(normalizedMigration).toContain('formation_risk_accepted_participants');
    expect(normalizedMigration).toMatch(/v_participants < v_dep\.formation_risk_accepted_participants/);
    expect(normalizedMigration).toMatch(/formation_risk_accepted_participants = v_participants/);
    expect(normalizedMigration.match(/formation_risk_accepted_participants = v_participants/g)).toHaveLength(2);
    expect(normalizedMigration).toMatch(/from public\.tenant_users where tenant_id = p_tenant and user_id = p_actor_user and role in \('OWNER', 'MANAGER'\)/);
    expect(normalizedMigration).toContain('FORMATION_ACTOR_FORBIDDEN');
  });

  it('derives order snapshots from the same-tenant Plan and enforces future private modes', () => {
    expect(normalizedMigration).toMatch(/new\.deposit_mode_snapshot := v_plan\.deposit_mode/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_FIXED' then v_plan\.deposit_value/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_PERCENT' then pg_catalog\.round\(new\.total_amount \* v_plan\.deposit_value \/ 100, 2\)/);
    expect(normalizedMigration).toMatch(/create trigger t_trip_plans_participation_mode_41 before insert or update of booking_type, participation_mode/);
    expect(normalizedMigration).toMatch(/if new\.booking_type in \('INSTANT', 'REQUEST'\) then new\.participation_mode := 'PRIVATE'/);
  });

  it('refreshes formation whenever an order field that changes qualification, headcount, or departure changes', () => {
    expect(normalizedMigration).toMatch(
      /create trigger t_tour_orders_refresh_formation after insert or update of status, payment_status, paid_amount, refunded_amount, party_size, departure_id on tour_orders/,
    );
    expect(normalizedMigration).toMatch(/old\.departure_id is distinct from new\.departure_id/);
    expect(normalizedMigration).toMatch(/refresh_departure_formation\(old\.departure_id\)/);
    expect(normalizedMigration).toMatch(/refresh_departure_formation\(new\.departure_id\)/);
  });

  it('hardens fresh and already-applied #41 definer functions without exposing internal RPCs', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).not.toContain('set search_path = public, pg_temp');
      expect(source.match(/security definer set search_path = ''/g)).toHaveLength(8);
      expect(source).toMatch(/revoke execute on function public\.qualifying_tour_participants\(pg_catalog\.uuid\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/revoke execute on function public\.refresh_departure_formation\(pg_catalog\.uuid\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/revoke execute on function public\.refresh_tour_order_formation_trigger\(\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/grant execute on function public\.review_expired_tour_formations\(pg_catalog\.timestamptz\) to service_role/);
      expect(source).toMatch(/grant execute on function public\.decide_tour_formation\(pg_catalog\.uuid, pg_catalog\.uuid, pg_catalog\.text, pg_catalog\.uuid, pg_catalog\.timestamptz, pg_catalog\.text\) to service_role/);
    }
  });

  it('uses pg_catalog.int4 rather than the unavailable pg_catalog.integer alias', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).toContain('returns pg_catalog.int4');
      expect(source).toContain('::pg_catalog.int4');
      expect(source).not.toContain('pg_catalog.integer');
    }
  });

  it('does not schema-qualify SQL special forms', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).not.toContain('pg_catalog.coalesce');
      expect(source).not.toContain('pg_catalog.nullif');
    }
  });
});
