import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_23_0113, ISSUE_37_0131_0134, ISSUE_46_0110_0136_CLOSURE, ISSUE_749_0137, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence, sourceCatalog } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { RELEASE_CATALOG_SQL } from '../../scripts/agents/schema-drift-watch.mjs';

const M0131 = '0131_issue_37_atomic_departure_staff';
const M0134 = '0134_issue_37_rpc_invoker_owner_compat';
const RPC = 'public.replace_trip_departure_staff';
// 0131／0134 套用 Production 後，此 bounded scope 的歷史測試改讀釋出前 fixture。
const FIXTURE = 'tests/fixtures/ledger-alias-map.pre-755-s0131-0134.json';
const aliasMap = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0131-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync(FIXTURE));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);

describe('#755 ISSUE_37_0131_0134 bounded release scope', () => {
  it('selects exactly 0131 then 0134 in order', () => {
    expect(selectedProductionMigrations(aliasMap(), ISSUE_37_0131_0134)).toEqual({ migrationScope: ISSUE_37_0131_0134, migrations: [M0131, M0134] });
  });

  it('builds a two-file plan that verifies against the canonical SQL', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'issue755-0131-0134-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_37_0131_0134, readCanonicalSql,
    });
    expect(plan.migrationScope).toBe(ISSUE_37_0131_0134);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual([M0131, M0134]);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each(['0066_issue_8_tour_domain_core', '0092_trip_departure_staff'])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_37_0131_0134)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it.each([M0131, M0134])('rejects the scope once %s is no longer pending', (repoFile) => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === repoFile);
    entry.classification = 'EXACT'; entry.ledgerNames = [repoFile]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_37_0131_0134)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('pins the capture table: no applied-source override, no create_tour_order family; other scopes unchanged', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_37_0131_0134]).toEqual({ migrationCount: 2, routinesRequired: true, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_46_0110_0136_CLOSURE]).toEqual({ migrationCount: 8, routinesRequired: true, createTourOrderFamily: true });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_23_0113]).toEqual({ migrationCount: 1, routinesRequired: false, createTourOrderFamily: false });
    expect(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES)).toEqual([ISSUE_46_0110_0136_CLOSURE, ISSUE_23_0113, ISSUE_749_0137, ISSUE_37_0131_0134, 'ISSUE_25_0117_0118']);
  });

  it('impact manifest declares the routine and ACL 0134 finalises', () => {
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const keys = manifest.entries.find((entry: any) => entry.repoFile === M0134).impacts.map((i: any) => `${i.surface}:${i.objectKey}`);
    expect(keys).toHaveLength(2);
    expect(keys.some((key: string) => key.startsWith(`routines:${RPC}(`))).toBe(true);
    expect(keys.some((key: string) => key.startsWith(`acl:function:${RPC}(`))).toBe(true);
  });

  it('release catalog allowlist captures replace_trip_departure_staff', () => {
    expect(RELEASE_CATALOG_SQL).toContain("'replace_trip_departure_staff'");
  });
});

describe('#755 ISSUE_37_0131_0134 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: ISSUE_37_0131_0134,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? M0131 : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
  const run = (p: any) => buildProductionConsistencyEvidence({ report, plan: p, impactManifest: { schemaVersion: 1, entries: [] }, mainSha: SHA, planDigest: 'b'.repeat(64) });

  it('routes the scope through the scoped path despite a DRIFT_BLOCKED raw observer report', () => {
    const real = buildProductionDbReleasePlan({ releaseId: 'issue755-0131-0134-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_37_0131_0134, readCanonicalSql });
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const call = (impactManifest: any) => buildProductionConsistencyEvidence({ repoRoot: preReleaseRepoRoot(), report, plan: real, impactManifest, mainSha: SHA, planDigest: real.planDigest });
    expect(() => call({ schemaVersion: 1, entries: [] })).toThrow(/RELEASE_MANIFEST_SOURCE_MISMATCH/);
    expect(() => call(manifest)).toThrow(/RELEASE_G3_BINDING_REQUIRED/);
  });
  it('rejects wrong migration counts for the scope', () => {
    expect(() => run(plan(1))).toThrow(/RELEASE_SCOPE_MISMATCH/);
    expect(() => run(plan(3))).toThrow(/RELEASE_SCOPE_MISMATCH/);
  });
});

describe('#755 ISSUE_37_0131_0134 workflow wiring', () => {
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  it('orchestrator downloads catalogs for the scope', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_37_0131_0134'");
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_37_0131_0134');
  });
});

describe('#755 ISSUE_37_0131_0134 source model', () => {
  const find = (map: Map<string, any>, name: string) => { const hits = [...map.values()].filter((r: any) => r.name === name); expect(hits).toHaveLength(1); return hits[0]; };
  const { before, after } = sourceCatalog({
    plan: { migrations: [M0131, M0134].map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })) },
    repoRoot: process.cwd(), readCanonicalSql,
    appliedSourceFiles: (SCOPED_RELEASE_CAPTURE_SCOPES as any)[ISSUE_37_0131_0134].appliedSourceFiles });

  it('replace_trip_departure_staff is new in 0131, finalised as security invoker by 0134', () => {
    expect([...before.values()].some((r: any) => r.name === RPC)).toBe(false);
    const routine = find(after, RPC);
    expect(routine.source.path).toContain(M0131);
    expect(routine.securityDefiner).toBe(false);
    expect(routine.alterSource.path).toContain(M0134);
  });
});
