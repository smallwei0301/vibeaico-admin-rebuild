import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  buildProductionDbReleasePlan,
  inferMigrationRiskTier,
  selectedProductionMigrations,
  verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { normalizeProductionDbImpactManifest } from '../../scripts/agents/production-db-impact-manifest.mjs';

const REPO_FILE = '0131_issue_37_atomic_departure_staff';
const MAIN = 'a'.repeat(40);
const PLANNED_AT = '2026-09-29T12:30:00Z';
const RPC = 'public.replace_trip_departure_staff(p_tenant uuid, p_departure uuid, p_primary uuid, p_assistants uuid[])';

const scopedAliasMap = () => ({
  schemaVersion: 1,
  entries: [
    { repoFile: '0066_issue_8_tour_domain_core', ledgerNames: ['0066_issue_8_tour_domain_core'], classification: 'EXACT', evidence: 'x' },
    { repoFile: REPO_FILE, ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: '0131 canonical source is pending G3' },
    { repoFile: '0133_issue_680_booking_addons_composite_fk_expand', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'unrelated pending migration' },
  ],
});

const canonicalSql = readFileSync(`supabase/migrations/${REPO_FILE}.sql`, 'utf8');

describe('#37 / 0131 bounded G3 release selector', () => {
  it('selects only the atomic departure-staff RPC and rejects a missing pending root', () => {
    expect(selectedProductionMigrations(scopedAliasMap(), 'ISSUE_37_0131')).toEqual({
      migrationScope: 'ISSUE_37_0131',
      migrations: [REPO_FILE],
    });

    const withoutRoot = scopedAliasMap();
    withoutRoot.entries = withoutRoot.entries.filter((entry) => entry.repoFile !== REPO_FILE);
    expect(() => selectedProductionMigrations(withoutRoot, 'ISSUE_37_0131'))
      .toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING/);
  });

  it('binds the exact one-migration AUTHZ plan to its canonical bytes', () => {
    expect(inferMigrationRiskTier(canonicalSql, REPO_FILE)).toBe('AUTHZ');
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260929-370131',
      mainSha: MAIN,
      plannedAt: PLANNED_AT,
      migrationScope: 'ISSUE_37_0131',
      aliasMap: scopedAliasMap(),
      readCanonicalSql: () => canonicalSql,
    });

    expect(plan).toMatchObject({
      migrationScope: 'ISSUE_37_0131', riskTier: 'AUTHZ', migrations: [{ repoFile: REPO_FILE }],
    });
    expect(verifyProductionDbReleasePlan({
      plan, aliasMap: scopedAliasMap(), readCanonicalSql: () => canonicalSql,
    })).toMatchObject({ status: 'PLAN_VERIFIED', migrationCount: 1 });
  });

  it('declares the routine body and service-role ACL as the complete G2 impact closure', () => {
    const manifest = normalizeProductionDbImpactManifest(JSON.parse(
      readFileSync('supabase/production-db-impact-manifest.json', 'utf8'),
    ));
    const entry = manifest.entries.find((item: { repoFile: string }) => item.repoFile === REPO_FILE);
    expect(entry?.impacts).toEqual([
      { surface: 'routines', objectKey: RPC },
      { surface: 'acl', objectKey: `function:${RPC}` },
    ]);
  });
});
