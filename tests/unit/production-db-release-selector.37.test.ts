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
const SUCCESSOR = '0134_issue_37_rpc_invoker_owner_compat';
const SCOPE = 'ISSUE_37_0131_0134';
const MAIN = 'a'.repeat(40);
const PLANNED_AT = '2026-09-29T12:30:00Z';
const RPC = 'public.replace_trip_departure_staff(p_tenant uuid, p_departure uuid, p_primary uuid, p_assistants uuid[])';

const scopedAliasMap = () => ({
  schemaVersion: 1,
  entries: [
    { repoFile: '0066_issue_8_tour_domain_core', ledgerNames: ['0066_issue_8_tour_domain_core'], classification: 'EXACT', evidence: 'x' },
    { repoFile: '0092_trip_departure_staff', ledgerNames: ['0092_trip_departure_staff'], classification: 'EXACT', evidence: 'x' },
    { repoFile: REPO_FILE, ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: '0131 canonical source is pending G3' },
    { repoFile: SUCCESSOR, ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'production-owner permission repair is pending G3' },
    { repoFile: '0133_issue_680_booking_addons_composite_fk_expand', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'unrelated pending migration' },
  ],
});

const canonicalSql = readFileSync(`supabase/migrations/${REPO_FILE}.sql`, 'utf8');
const successorSql = readFileSync(`supabase/migrations/${SUCCESSOR}.sql`, 'utf8');
const canonicalRead = (path: string) => path.endsWith(`${SUCCESSOR}.sql`) ? successorSql : canonicalSql;

describe('#37 / 0131+0134 bounded G3 release selector', () => {
  it('selects the RPC and invoker repair together, rejecting either missing dependency', () => {
    expect(selectedProductionMigrations(scopedAliasMap(), SCOPE)).toEqual({
      migrationScope: SCOPE,
      migrations: [REPO_FILE, SUCCESSOR],
    });

    for (const missingFile of [REPO_FILE, SUCCESSOR]) {
      const missing = scopedAliasMap();
      missing.entries = missing.entries.filter((entry) => entry.repoFile !== missingFile);
      expect(() => selectedProductionMigrations(missing, SCOPE))
        .toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING/);
    }
    expect(() => selectedProductionMigrations(scopedAliasMap(), 'ISSUE_37_0131'))
      .toThrow(/UNSUPPORTED_MIGRATION_SCOPE/);
  });

  it('fails closed when an already-applied table prerequisite is missing or unproven', () => {
    for (const prerequisite of ['0066_issue_8_tour_domain_core', '0092_trip_departure_staff']) {
      const missing = scopedAliasMap();
      missing.entries = missing.entries.filter((entry) => entry.repoFile !== prerequisite);
      expect(() => selectedProductionMigrations(missing, SCOPE))
        .toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);

      const unproven = scopedAliasMap();
      const entry = unproven.entries.find((item) => item.repoFile === prerequisite)!;
      entry.classification = 'NOT_APPLIED';
      expect(() => selectedProductionMigrations(unproven, SCOPE))
        .toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
    }
  });

  it('binds the exact two-migration AUTHZ plan to canonical bytes', () => {
    expect(inferMigrationRiskTier(canonicalSql, REPO_FILE)).toBe('AUTHZ');
    expect(inferMigrationRiskTier(successorSql, SUCCESSOR)).toBe('AUTHZ');
    expect(successorSql).toMatch(/alter function public\.replace_trip_departure_staff\(uuid, uuid, uuid, uuid\[\]\)\s+security invoker/i);
    const plan = buildProductionDbReleasePlan({
      releaseId: 'release-20260929-370131',
      mainSha: MAIN,
      plannedAt: PLANNED_AT,
      migrationScope: SCOPE,
      aliasMap: scopedAliasMap(),
      readCanonicalSql: canonicalRead,
    });

    expect(plan).toMatchObject({
      migrationScope: SCOPE, riskTier: 'AUTHZ', migrations: [{ repoFile: REPO_FILE }, { repoFile: SUCCESSOR }],
    });
    expect(verifyProductionDbReleasePlan({
      plan, aliasMap: scopedAliasMap(), readCanonicalSql: canonicalRead,
    })).toMatchObject({ status: 'PLAN_VERIFIED', migrationCount: 2 });
  });

  it('declares the routine body and service-role ACL as the complete G2 impact closure', () => {
    const manifest = normalizeProductionDbImpactManifest(JSON.parse(
      readFileSync('supabase/production-db-impact-manifest.json', 'utf8'),
    ));
    const entry = manifest.entries.find((item: { repoFile: string }) => item.repoFile === SUCCESSOR);
    expect(manifest.entries.find((item: { repoFile: string }) => item.repoFile === REPO_FILE)?.impacts).toEqual([]);
    expect(entry?.impacts).toEqual([
      { surface: 'routines', objectKey: RPC },
      { surface: 'acl', objectKey: `function:${RPC}` },
    ]);
  });
});
