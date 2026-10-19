import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_23_0113, ISSUE_25_0117_0118, ISSUE_37_0131_0134, ISSUE_46_0110_0136_CLOSURE, ISSUE_749_0137, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';

const M0117 = '0117_issue_25b_support_chat_threads';
const M0118 = '0118_issue_25c_platform_donations';
// 0117／0118 套用 Production 後，此 bounded scope 的歷史測試改讀釋出前 fixture。
const FIXTURE = 'tests/fixtures/ledger-alias-map.pre-755-s0117-0118.json';
const aliasMap = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0117-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync(FIXTURE));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);

describe('#755 ISSUE_25_0117_0118 bounded release scope', () => {
  it('selects exactly 0117 then 0118 in order, with no other pending migration pulled in', () => {
    expect(selectedProductionMigrations(aliasMap(), ISSUE_25_0117_0118)).toEqual({ migrationScope: ISSUE_25_0117_0118, migrations: [M0117, M0118] });
  });

  it('builds a two-file plan that verifies against the canonical SQL', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'issue755-0117-0118-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_25_0117_0118, readCanonicalSql,
    });
    expect(plan.migrationScope).toBe(ISSUE_25_0117_0118);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual([M0117, M0118]);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each(['0001_extensions_and_functions', '0003_tenants_and_accounts'])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_25_0117_0118)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it.each([M0117, M0118])('rejects the scope once %s is no longer pending', (repoFile) => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === repoFile);
    entry.classification = 'EXACT'; entry.ledgerNames = [repoFile]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_25_0117_0118)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('pins the capture table: no routines required, no applied-source override; other scopes unchanged', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_25_0117_0118]).toEqual({ migrationCount: 2, routinesRequired: false, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_37_0131_0134]).toEqual({ migrationCount: 2, routinesRequired: true, createTourOrderFamily: false });
    expect(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES)).toEqual([ISSUE_46_0110_0136_CLOSURE, ISSUE_23_0113, ISSUE_749_0137, ISSUE_37_0131_0134, ISSUE_25_0117_0118]);
  });

  it('migrations create no routine (routinesRequired=false is honest)', () => {
    for (const file of [M0117, M0118]) {
      const sql = readFileSync(`supabase/migrations/${file}.sql`, 'utf8').replace(/--.*$/gm, '');
      expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    }
  });

  it('impact manifest declares the tables, policies and ACL the two migrations finalise', () => {
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const keys = (file: string) => manifest.entries.find((entry: any) => entry.repoFile === file).impacts.map((i: any) => `${i.surface}:${i.objectKey}`);
    expect(keys(M0117)).toEqual(expect.arrayContaining([
      'columns:public.support_chat_threads.id', 'columns:public.support_chat_messages.body',
      'policies:public.support_chat_threads.p_sct_r', 'policies:public.support_chat_messages.p_scm_i',
    ]));
    expect(keys(M0118)).toEqual(expect.arrayContaining(['columns:public.platform_donations.merchant_trade_no', 'acl:table:public.platform_donations']));
  });
});

describe('#755 ISSUE_25_0117_0118 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: ISSUE_25_0117_0118,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? M0117 : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
  const run = (p: any) => buildProductionConsistencyEvidence({ report, plan: p, impactManifest: { schemaVersion: 1, entries: [] }, mainSha: SHA, planDigest: 'b'.repeat(64) });

  it('routes the scope through the scoped path despite a DRIFT_BLOCKED raw observer report', () => {
    const real = buildProductionDbReleasePlan({ releaseId: 'issue755-0117-0118-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_25_0117_0118, readCanonicalSql });
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

describe('#755 ISSUE_25_0117_0118 workflow wiring', () => {
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  it('orchestrator downloads catalogs for the scope', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_25_0117_0118'");
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_25_0117_0118');
  });
});
