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
  'supabase/migrations/0109_assertions.sql': 'create table if not exists public.y(id uuid primary key);',
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

  it('classifies authorization/backfill risk and rejects destructive v1 SQL', () => {
    expect(inferMigrationRiskTier('create policy p on public.t for select using (true);')).toBe('AUTHZ');
    expect(inferMigrationRiskTier('update public.t set x=1 where id=1;')).toBe('BACKFILL');
    expect(inferMigrationRiskTier('create table public.t(id int);')).toBe('ADDITIVE');
    expect(() => inferMigrationRiskTier('drop table public.t;')).toThrow(/DESTRUCTIVE_SQL_NOT_ADMITTED/);
  });
});
