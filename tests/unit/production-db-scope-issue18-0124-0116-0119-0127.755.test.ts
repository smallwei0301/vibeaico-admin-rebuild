import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_18_0124_0116_0119_0127, ISSUE_25_0117_0118, ISSUE_37_0131_0134, ISSUE_23_0113, ISSUE_46_0110_0136_CLOSURE, ISSUE_749_0137, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, stripSqlComments, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence, sourceCatalog } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { RELEASE_CATALOG_SQL } from '../../scripts/agents/schema-drift-watch.mjs';

const M0124 = '0124_issue_18_owner_notify_legacy_shape';
const M0116 = '0116_issue_18_owner_notify';
const M0119 = '0119_issue_18_owner_notify_confirm_atomic';
const M0127 = '0127_issue_589_authz_constraint_reconciliation';
const ORDER = [M0124, M0116, M0119, M0127];
// 此 bounded scope 的測試讀釋出前 fixture（origin/main ledger-alias-map.json 的 byte copy；四檔皆為 PENDING_APPLY）。
const FIXTURE = 'tests/fixtures/ledger-alias-map.pre-755-s0124-0116-0119-0127.json';
const aliasMap = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0124-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync(FIXTURE));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);
const build = () => buildProductionDbReleasePlan({
  releaseId: 'issue755-0124-0116-0119-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
  aliasMap: aliasMap(), migrationScope: ISSUE_18_0124_0116_0119_0127, readCanonicalSql,
});

describe('#755 ISSUE_18_0124_0116_0119_0127 bounded release scope', () => {
  it('selects exactly 0124, 0116, 0119, 0127 in that order (0127 last), pulling in nothing else', () => {
    expect(selectedProductionMigrations(aliasMap(), ISSUE_18_0124_0116_0119_0127)).toEqual({ migrationScope: ISSUE_18_0124_0116_0119_0127, migrations: ORDER });
  });

  it('builds a four-file plan in apply order that verifies against the canonical SQL', () => {
    const plan = build();
    expect(plan.migrationScope).toBe(ISSUE_18_0124_0116_0119_0127);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual(ORDER);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each(['0001_extensions_and_functions', '0003_tenants_and_accounts', '0005_line_marketing_other', '0082_reconcile_booking_addon_notify_fields'])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_18_0124_0116_0119_0127)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it.each(ORDER)('rejects the scope once %s is no longer pending', (repoFile) => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === repoFile);
    entry.classification = 'EXACT'; entry.ledgerNames = [repoFile]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_18_0124_0116_0119_0127)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('pins the capture table: routines required, no applied-source override; other scopes unchanged', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_18_0124_0116_0119_0127]).toEqual({ migrationCount: 4, routinesRequired: true, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_25_0117_0118]).toEqual({ migrationCount: 2, routinesRequired: false, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_37_0131_0134]).toEqual({ migrationCount: 2, routinesRequired: true, createTourOrderFamily: false });
    expect(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES)).toEqual([ISSUE_46_0110_0136_CLOSURE, ISSUE_23_0113, ISSUE_749_0137, ISSUE_37_0131_0134, ISSUE_25_0117_0118, ISSUE_18_0124_0116_0119_0127, 'ISSUE_17_0121_0125_0133_0123']);
  });

  it('source facts: no auth schema, no top-level DML/backfill, only 0119 creates routines (0127 is a DO-block reconciliation)', () => {
    const sqlOf = (file: string) => stripSqlComments(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
    for (const file of ORDER) expect(sqlOf(file)).not.toMatch(/\bauth\s*\./i);
    // 去除 $$...$$ 函式本體與 DO 區塊後，不得再有 INSERT／UPDATE／DELETE 語句。
    for (const file of ORDER) {
      const topLevel = sqlOf(file).replace(/\$\$[\s\S]*?\$\$/g, '');
      expect(topLevel).not.toMatch(/^\s*(insert\s+into|update\s+\S+\s+set|delete\s+from)\b/im);
    }
    expect(sqlOf(M0124)).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sqlOf(M0116)).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sqlOf(M0119).match(/create\s+or\s+replace\s+function\s+public\.\w+/gi)).toHaveLength(2);
    // 0124 以 IF EXISTS 保護：Production 尚無 owner_notify_* 時為 no-op；0116 以 IF NOT EXISTS 建表。
    expect(sqlOf(M0124)).toMatch(/alter table if exists public\.owner_notify_recipients/i);
    expect(sqlOf(M0116)).toMatch(/create table if not exists public\.owner_notify_bind_requests/i);
    expect(sqlOf(M0116)).toMatch(/create table if not exists public\.owner_notify_recipients/i);
  });

  it('0127 is not pulled in alongside unapplied 0121/0125/0133 and stays last', () => {
    const { migrations } = selectedProductionMigrations(aliasMap(), ISSUE_18_0124_0116_0119_0127);
    expect(migrations[migrations.length - 1]).toBe(M0127);
    for (const other of ['0121_issue_17_booking_addons_hardening', '0125_issue_17_booking_addons_legacy_enum', '0133_issue_680_booking_addons_composite_fk_expand']) expect(migrations).not.toContain(other);
    const sql = stripSqlComments(readFileSync(`supabase/migrations/${M0127}.sql`, 'utf8'));
    expect(sql).toMatch(/p_owner_notify_recipients_all/);
    expect(sql).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it('release catalog allowlist captures both 0119 routines', () => {
    expect(RELEASE_CATALOG_SQL).toContain("'confirm_owner_notify_bind'");
    expect(RELEASE_CATALOG_SQL).toContain("'owner_notify_max_recipients'");
  });
});

describe('#755 ISSUE_18_0124_0116_0119_0127 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: ISSUE_18_0124_0116_0119_0127,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? M0124 : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
  const run = (p: any) => buildProductionConsistencyEvidence({ report, plan: p, impactManifest: { schemaVersion: 1, entries: [] }, mainSha: SHA, planDigest: 'b'.repeat(64) });

  it('routes the scope through the scoped path despite a DRIFT_BLOCKED raw observer report', () => {
    const real = build();
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const call = (impactManifest: any) => buildProductionConsistencyEvidence({ repoRoot: preReleaseRepoRoot(), report, plan: real, impactManifest, mainSha: SHA, planDigest: real.planDigest });
    expect(() => call({ schemaVersion: 1, entries: [] })).toThrow(/RELEASE_MANIFEST_SOURCE_MISMATCH/);
    expect(() => call(manifest)).toThrow(/RELEASE_G3_BINDING_REQUIRED/);
  });
  it('rejects wrong migration counts for the scope', () => {
    expect(() => run(plan(3))).toThrow(/RELEASE_SCOPE_MISMATCH/);
    expect(() => run(plan(5))).toThrow(/RELEASE_SCOPE_MISMATCH/);
  });
});

describe('#755 ISSUE_18_0124_0116_0119_0127 workflow wiring', () => {
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  it('orchestrator downloads catalogs for the scope', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_18_0124_0116_0119_0127'");
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_18_0124_0116_0119_0127');
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('ISSUE_25_0117_0118|ISSUE_18_0124_0116_0119_0127|ISSUE_17_0121_0125_0133_0123) ;;');
  });
});

describe('#755 ISSUE_18_0124_0116_0119_0127 source model', () => {
  const { before, after } = sourceCatalog({
    plan: { migrations: ORDER.map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })) },
    repoRoot: process.cwd(), readCanonicalSql,
    appliedSourceFiles: (SCOPED_RELEASE_CAPTURE_SCOPES as any)[ISSUE_18_0124_0116_0119_0127].appliedSourceFiles });

  it('0119 creates confirm_owner_notify_bind (security definer) and owner_notify_max_recipients; none existed before', () => {
    const names = (map: Map<string, any>) => [...map.values()].map((r: any) => r.name).sort();
    expect(names(before)).not.toContain('public.confirm_owner_notify_bind');
    expect(names(after).filter((n: string) => n.includes('owner_notify'))).toEqual(['public.confirm_owner_notify_bind', 'public.owner_notify_max_recipients']);
    const rpc = [...after.values()].find((r: any) => r.name === 'public.confirm_owner_notify_bind');
    expect(rpc.securityDefiner).toBe(true);
    expect(rpc.source.path).toContain(M0119);
  });
});
