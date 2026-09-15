import { describe, expect, it } from 'vitest';

import {
  buildProductionDbReleasePlan,
  inferMigrationRiskTier,
  pendingProductionMigrations,
  releasePlanDigestOf,
  verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';

const MAIN = 'a'.repeat(40);
const PLANNED_AT = '2026-09-14T12:30:00Z';

function aliasMap() {
  return {
    schemaVersion: 1,
    entries: [
      { repoFile: '0001_base', ledgerNames: ['0001_base'], classification: 'EXACT', evidence: 'x' },
      { repoFile: '0105_authz', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      { repoFile: '0099_never_apply', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'VERIFIED_NOT_APPLIED', evidence: 'x' },
    ],
  };
}

const sqlByPath: Record<string, string> = {
  'supabase/migrations/0105_authz.sql': 'alter table public.x enable row level security; grant select on public.x to authenticated;',
  'supabase/migrations/0109_assertions.sql': 'grant select on public.y to authenticated;',
};
const readCanonicalSql = (path: string) => sqlByPath[path];

describe('Production DB release plan #447', () => {
  it('uses only PENDING_APPLY entries and excludes VERIFIED_NOT_APPLIED', () => {
    expect(pendingProductionMigrations(aliasMap())).toEqual(['0105_authz', '0109_assertions']);
  });

  it('builds one immutable plan from exact main bytes and fixes ledger versions at G0', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    expect(plan.migrations.map((entry: any) => entry.repoFile)).toEqual(['0105_authz', '0109_assertions']);
    expect(plan.migrations.map((entry: any) => entry.ledgerVersion)).toEqual(['20260914123000', '20260914123001']);
    expect(plan.riskTier).toBe('AUTHZ');
    expect(plan.planDigest).toBe(releasePlanDigestOf(plan));
    expect(verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).toMatchObject({
      status: 'PLAN_VERIFIED', riskTier: 'AUTHZ', migrationCount: 2, databaseMutationAuthorized: false,
    });
  });

  it('fails closed if alias-map pending set changes after review', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    const changed = aliasMap();
    changed.entries.push({ repoFile: '0110_new', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'new' });
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: changed, readCanonicalSql })).toThrow(/PENDING_SET_MISMATCH/);
  });

  it('fails closed if reviewed migration bytes or ledger identity are changed', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql,
    });
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql: (path: string) => `${readCanonicalSql(path)}\nselect 1;` })).toThrow(/MIGRATION_BYTES_MISMATCH/);
    const forged = structuredClone(plan);
    forged.migrations[0].ledgerVersion = '20260101000000';
    expect(() => verifyProductionDbReleasePlan({ plan: forged, aliasMap: aliasMap(), readCanonicalSql })).toThrow(/PLAN_DIGEST_MISMATCH/);
  });

  it('distinguishes additive, schema repair, authorization and backfill risk', () => {
    expect(inferMigrationRiskTier('create table public.t(id int);')).toBe('ADDITIVE');
    expect(inferMigrationRiskTier('alter table public.t drop constraint old_ck; alter table public.t alter column x type bigint using x::bigint;')).toBe('SCHEMA_REPAIR');
    expect(inferMigrationRiskTier('create policy p on public.t for select using (true);')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('update public.t set x=1 where id=1;')).toBe('BACKFILL');
  });

  it('does not mistake runtime DML inside a stored RPC for migration-time backfill', () => {
    const rpc = `
      create or replace function public.accept_request(p_id uuid) returns void as $$
      begin
        update public.tour_orders set status = 'CONFIRMED' where id = p_id;
      end;
      $$ language plpgsql security definer set search_path = public;
      revoke execute on function public.accept_request(uuid) from anon, authenticated;
    `;
    expect(inferMigrationRiskTier(rpc)).toBe('AUTHZ');

    const immediateDoBlock = `
      do $$ begin
        update public.tour_orders set status = 'CONFIRMED' where false;
      end $$;
    `;
    expect(inferMigrationRiskTier(immediateDoBlock)).toBe('BACKFILL');
  });

  it('rejects destructive and mixed-specialized-risk v1 SQL instead of silently dropping one evidence class', () => {
    expect(() => inferMigrationRiskTier('drop table public.t;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('truncate public.t;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('alter table public.t drop x;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
    expect(inferMigrationRiskTier('alter table public.t disable row level security;')).toBe('AUTHZ');
    expect(() => inferMigrationRiskTier('drop view public.t;')).toThrow(/UNCLASSIFIED_DROP_NOT_ADMITTED/);
    expect(() => inferMigrationRiskTier('grant select on public.t to authenticated; update public.t set x=1;'))
      .toThrow(/MIXED_RISK_MIGRATION_NOT_ADMITTED/);
  });

  it('rejects a release plan that mixes risk classes across migrations', () => {
    const mixed = aliasMap();
    mixed.entries.push({ repoFile: '0111_backfill', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' });
    const mixedSql: Record<string, string> = {
      ...sqlByPath,
      'supabase/migrations/0111_backfill.sql': 'update public.t set x=1 where id=1;',
    };
    expect(() => buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: mixed, readCanonicalSql: (path: string) => mixedSql[path],
    })).toThrow(/MIXED_RISK_RELEASE_NOT_ADMITTED/);
  });
});
