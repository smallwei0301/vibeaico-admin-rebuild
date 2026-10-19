import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_23_0113, ISSUE_749_0137, ISSUE_46_0110_0136_CLOSURE, ISSUE_755_0110_0137_CLOSURE, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';

const MIGRATION = '0113_issue_23_promotion_page_view_events';
// 0113 已釋出 Production（ledger version 20261018041721）；此 bounded scope 的歷史測試改讀釋出前 fixture。
const aliasMap = () => JSON.parse(readFileSync('tests/fixtures/ledger-alias-map.pre-755-s0113.json', 'utf8'));
// consistency evidence 自行從 repoRoot 讀 alias map，所以另備一個以釋出前 fixture 取代 alias map 的 repoRoot。
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0113-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync('tests/fixtures/ledger-alias-map.pre-755-s0113.json'));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);

describe('#755 ISSUE_23_0113 bounded release scope', () => {
  it('selects exactly 0113 from the current real alias map, with no pending dependency pulled in', () => {
    expect(selectedProductionMigrations(aliasMap(), ISSUE_23_0113)).toEqual({ migrationScope: ISSUE_23_0113, migrations: [MIGRATION] });
  });

  it('builds a one-file plan that verifies against the canonical SQL', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'issue755-0113-test-20261018', mainSha: SHA, plannedAt: '2026-10-18T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_23_0113, readCanonicalSql,
    });
    expect(plan.migrationScope).toBe(ISSUE_23_0113);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual([MIGRATION]);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each(['0001_extensions_and_functions', '0003_tenants_and_accounts'])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_23_0113)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING|requires an exact applied prerequisite/);
  });

  it('rejects the scope once 0113 is no longer pending', () => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === MIGRATION);
    entry.classification = 'EXACT'; entry.ledgerNames = [MIGRATION]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_23_0113)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('does not alter the original-eight spec and admits only the three bounded capture scopes', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_46_0110_0136_CLOSURE]).toEqual({ migrationCount: 8, routinesRequired: true, createTourOrderFamily: true });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_23_0113]).toEqual({ migrationCount: 1, routinesRequired: false, createTourOrderFamily: false });
    expect(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES)).toEqual([ISSUE_46_0110_0136_CLOSURE, ISSUE_23_0113, ISSUE_749_0137, 'ISSUE_37_0131_0134', 'ISSUE_25_0117_0118']);
  });

  it('impact manifest declares every object 0113 creates', () => {
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const keys = manifest.entries.find((entry: any) => entry.repoFile === MIGRATION).impacts.map((i: any) => `${i.surface}:${i.objectKey}`);
    expect(keys.filter((key: string) => key.startsWith('columns:'))).toHaveLength(7);
    expect(keys).toEqual(expect.arrayContaining([
      'constraints:public.page_view_events.page_view_events_pkey', 'constraints:public.page_view_events.page_view_events_tenant_id_fkey',
      'indexes:public.page_view_events.idx_page_view_events_tenant_created', 'indexes:public.page_view_events.idx_page_view_events_tenant_visitor',
      'indexes:public.page_view_events.idx_page_view_events_created_at', 'indexes:public.page_view_events.page_view_events_pkey',
      'policies:public.page_view_events.p_page_view_events_select', 'acl:table:public.page_view_events',
    ]));
  });
});

describe('#755 ISSUE_23_0113 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (scope: string, count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: scope,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? MIGRATION : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
  const run = (p: any) => buildProductionConsistencyEvidence({ report, plan: p, impactManifest: { schemaVersion: 1, entries: [] }, mainSha: SHA, planDigest: 'b'.repeat(64) });

  it('routes the new scope through the scoped path despite a DRIFT_BLOCKED raw observer report', () => {
    // 一般路徑會先以 DRIFT_BLOCKED 失敗；scoped 路徑改為先驗 plan／manifest／G3 ledger binding。
    const real = buildProductionDbReleasePlan({ releaseId: 'issue755-0113-test-20261018', mainSha: SHA, plannedAt: '2026-10-18T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_23_0113, readCanonicalSql });
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const call = (impactManifest: any) => buildProductionConsistencyEvidence({ repoRoot: preReleaseRepoRoot(), report, plan: real, impactManifest, mainSha: SHA, planDigest: real.planDigest });
    expect(() => call({ schemaVersion: 1, entries: [] })).toThrow(/RELEASE_MANIFEST_SOURCE_MISMATCH/);
    expect(() => call(manifest)).toThrow(/RELEASE_G3_BINDING_REQUIRED/);
  });
  it('rejects a wrong migration count for the new scope and an unadmitted scope', () => {
    expect(() => run(plan(ISSUE_23_0113, 2))).toThrow(/RELEASE_SCOPE_MISMATCH/);
    expect(() => run(plan(ISSUE_755_0110_0137_CLOSURE, 9))).toThrow(/RELEASE_SCOPE_MISMATCH/);
    expect(() => run(plan(ISSUE_46_0110_0136_CLOSURE, 7))).toThrow(/RELEASE_SCOPE_MISMATCH/);
  });
});

describe('#755 ISSUE_23_0113 workflow wiring', () => {
  const drift = readFileSync('.github/workflows/agent-schema-drift-watch.yml', 'utf8');
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  it('drift-watch selects scoped capture through the shared per-scope table', () => {
    expect(drift).toContain('SCOPED_RELEASE_CAPTURE_SCOPES[binding?.plan?.migrationScope]');
    expect(drift).toContain('binding.plan.migrations.length !== scopeSpec.migrationCount');
    expect(drift).toContain('SCOPED_RELEASE_CAPTURE=${selected}');
  });
  it('orchestrator downloads catalogs and passes capture args for both scoped scopes', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_46_0110_0136_CLOSURE' || fromJSON(needs.admission.outputs.g3_ledger_binding).plan.migrationScope == 'ISSUE_23_0113'");
    expect(orchestrator).toContain('SCOPED_RELEASE_CAPTURE_SCOPES[JSON.parse(fs.readFileSync(`${process.env.RUNNER_TEMP}/g3/production-db-release-plan.json`)).migrationScope] !== undefined');
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_23_0113');
  });
});
