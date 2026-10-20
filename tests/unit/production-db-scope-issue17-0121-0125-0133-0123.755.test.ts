import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_17_0121_0125_0133_0123, ISSUE_18_0124_0116_0119_0127, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, stripSqlComments, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence, sourceCatalog } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { RELEASE_CATALOG_SQL } from '../../scripts/agents/schema-drift-watch.mjs';

const M0125 = '0125_issue_17_booking_addons_legacy_enum';
const M0121 = '0121_issue_17_booking_addons_hardening';
const M0123 = '0123_issue_589_richmenu_asset_retirement';
const M0133 = '0133_issue_680_booking_addons_composite_fk_expand';
// 0125 必須先於 0121（PENDING_MIGRATION_PRECEDENCE）；0123 與其餘獨立，依檔名排序落在 0121 之後、0133 之前。
const ORDER = [M0125, M0121, M0123, M0133];
// 釋出前 fixture：origin/main ledger-alias-map.json 的 byte copy（四檔皆為 PENDING_APPLY）。
const FIXTURE = 'tests/fixtures/ledger-alias-map.pre-755-s0121-0125-0133-0123.json';
const aliasMap = () => JSON.parse(readFileSync(FIXTURE, 'utf8'));
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0121-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync(FIXTURE));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);
const build = () => buildProductionDbReleasePlan({
  releaseId: 'issue755-0121-0125-0133-0123-test-20261020', mainSha: SHA, plannedAt: '2026-10-20T00:00:00Z',
  aliasMap: aliasMap(), migrationScope: ISSUE_17_0121_0125_0133_0123, readCanonicalSql,
});

describe('#755 ISSUE_17_0121_0125_0133_0123 bounded release scope', () => {
  it('selects exactly 0125, 0121, 0123, 0133 in apply order (0125 before 0121), nothing else', () => {
    const { migrations } = selectedProductionMigrations(aliasMap(), ISSUE_17_0121_0125_0133_0123);
    expect(migrations).toEqual(ORDER);
    expect(migrations).toHaveLength(4);
    for (const excluded of ['0126_issue_402_keyword_reply_images_authz', '0117_issue_25b_support_chat_threads', '0118_issue_25c_platform_donations']) expect(migrations).not.toContain(excluded);
  });

  it('builds a four-file plan in apply order that verifies against the canonical SQL', () => {
    const plan = build();
    expect(plan.migrationScope).toBe(ISSUE_17_0121_0125_0133_0123);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual(ORDER);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each(['0003_tenants_and_accounts', '0004_core_business_tables', '0082_reconcile_booking_addon_notify_fields', '0127_issue_589_authz_constraint_reconciliation'])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_17_0121_0125_0133_0123)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it('rejects a non-identity ledger name for an applied prerequisite', () => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === '0082_reconcile_booking_addon_notify_fields').ledgerNames = ['other_name'];
    expect(() => selectedProductionMigrations(map, ISSUE_17_0121_0125_0133_0123)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it.each(ORDER)('rejects the scope once %s is no longer pending', (repoFile) => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === repoFile);
    entry.classification = 'EXACT'; entry.ledgerNames = [repoFile]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_17_0121_0125_0133_0123)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('pins the capture table: routines required, no applied-source override; neighbouring scope unchanged', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_17_0121_0125_0133_0123]).toEqual({ migrationCount: 4, routinesRequired: true, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_18_0124_0116_0119_0127]).toEqual({ migrationCount: 4, routinesRequired: true, createTourOrderFamily: false });
  });

  it('source facts: no auth schema, no DDL on public.bookings, no top-level DML, routines only in 0121/0123', () => {
    const sqlOf = (file: string) => stripSqlComments(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'));
    for (const file of ORDER) {
      expect(sqlOf(file)).not.toMatch(/\bauth\s*\./i);
      // G2 owner 前提：bookings 為 postgres 擁有，本 scope 不得對它做 DDL（函式本體內的 DML 不在此限）。
      expect(sqlOf(file)).not.toMatch(/(alter|create|drop)\s+(table|trigger|policy|index|constraint)[^;]*\bpublic\.bookings\b/i);
      expect(sqlOf(file)).not.toMatch(/\block\s+table[^;]*\bbookings\b/i);
      expect(sqlOf(file)).not.toMatch(/\bon\s+(table\s+)?public\.bookings\b/i);
      const topLevel = sqlOf(file).replace(/\$\$[\s\S]*?\$\$/g, '').replace(/\$[a-z_]+\$[\s\S]*?\$[a-z_]+\$/g, '');
      expect(topLevel).not.toMatch(/^\s*(insert\s+into|update\s+\S+\s+set|delete\s+from)\b/im);
    }
    expect(sqlOf(M0121).match(/create\s+or\s+replace\s+function\s+public\.\w+/gi)).toHaveLength(2);
    expect(sqlOf(M0123).match(/create\s+or\s+replace\s+function\s+public\.\w+/gi)).toHaveLength(3);
    expect(sqlOf(M0125)).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
    expect(sqlOf(M0133)).not.toMatch(/create\s+(or\s+replace\s+)?function/i);
  });

  it('keeps platform-owned / parked migrations out of the closure sources', () => {
    const { migrations } = selectedProductionMigrations(aliasMap(), ISSUE_17_0121_0125_0133_0123);
    for (const file of migrations) expect(stripSqlComments(readFileSync(`supabase/migrations/${file}.sql`, 'utf8'))).not.toMatch(/storage\.objects/i);
  });

  it('release catalog allowlist captures every routine the scope creates', () => {
    for (const name of ['create_booking_addon', 'delete_booking_addon', 'richmenu_asset_references', 'prevent_retired_richmenu_asset', 'retire_richmenu_asset']) {
      expect(RELEASE_CATALOG_SQL).toContain(`'${name}'`);
    }
  });
});

describe('#755 ISSUE_17_0121_0125_0133_0123 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: ISSUE_17_0121_0125_0133_0123,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? M0125 : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
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

describe('#755 ISSUE_17_0121_0125_0133_0123 workflow wiring', () => {
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ciText = readFileSync('.github/workflows/ci.yml', 'utf8');
  const ci = parse(ciText);
  it('orchestrator downloads catalogs for the scope', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_17_0121_0125_0133_0123'");
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_17_0121_0125_0133_0123');
    expect(ciText).toContain('ISSUE_18_0124_0116_0119_0127|ISSUE_17_0121_0125_0133_0123) ;;');
  });
});

describe('#755 ISSUE_17_0121_0125_0133_0123 source model', () => {
  const { before, after } = sourceCatalog({
    plan: { migrations: ORDER.map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })) },
    repoRoot: process.cwd(), readCanonicalSql,
    appliedSourceFiles: (SCOPED_RELEASE_CAPTURE_SCOPES as any)[ISSUE_17_0121_0125_0133_0123].appliedSourceFiles });

  it('0121 and 0123 create exactly five public routines, none present before', () => {
    const names = (map: Map<string, any>) => [...map.values()].map((r: any) => r.name).sort();
    const expected = ['public.create_booking_addon', 'public.delete_booking_addon', 'public.prevent_retired_richmenu_asset', 'public.retire_richmenu_asset', 'public.richmenu_asset_references'];
    expect(names(after).filter((n: string) => expected.includes(n))).toEqual(expected);
    for (const n of expected) expect(names(before)).not.toContain(n);
    const create = [...after.values()].find((r: any) => r.name === 'public.create_booking_addon');
    expect(create.securityDefiner).toBe(true);
    expect(create.source.path).toContain(M0121);
  });
});
