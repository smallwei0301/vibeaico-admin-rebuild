import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

import {
  ISSUE_23_0113, ISSUE_46_0110_0136_CLOSURE, ISSUE_749_0137, SCOPED_RELEASE_CAPTURE_SCOPES,
  buildProductionDbReleasePlan, selectedProductionMigrations, verifyProductionDbReleasePlan,
} from '../../scripts/agents/production-db-release-plan.mjs';
import { buildProductionConsistencyEvidence, sourceCatalog } from '../../scripts/agents/production-db-consistency-evidence.mjs';

const MIGRATION = '0137_issue_749_create_tour_order_quoted';
// 0137 已釋出 Production（ledger version 20261019031547）；此 bounded scope 的歷史測試改讀釋出前 fixture。
const aliasMap = () => JSON.parse(readFileSync('tests/fixtures/ledger-alias-map.pre-755-s0137.json', 'utf8'));
// consistency evidence 自行從 repoRoot 讀 alias map，所以另備一個以釋出前 fixture 取代 alias map 的 repoRoot。
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-s0137-root-'));
  mkdirSync(join(root, 'supabase'), { recursive: true });
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync('tests/fixtures/ledger-alias-map.pre-755-s0137.json'));
  return root;
}
const readCanonicalSql = (path: string) => readFileSync(path, 'utf8');
const SHA = 'a'.repeat(40);

describe('#755 ISSUE_749_0137 bounded release scope', () => {
  it('selects exactly 0137; applied 0132/0136 are prerequisites, not pulled back in as pending', () => {
    expect(selectedProductionMigrations(aliasMap(), ISSUE_749_0137)).toEqual({ migrationScope: ISSUE_749_0137, migrations: [MIGRATION] });
  });

  it('builds a one-file plan that verifies against the canonical SQL', () => {
    const plan = buildProductionDbReleasePlan({
      releaseId: 'issue755-0137-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_749_0137, readCanonicalSql,
    });
    expect(plan.migrationScope).toBe(ISSUE_749_0137);
    expect(plan.migrations.map((item: any) => item.repoFile)).toEqual([MIGRATION]);
    expect(() => verifyProductionDbReleasePlan({ plan, aliasMap: aliasMap(), readCanonicalSql })).not.toThrow();
  });

  it.each([
    '0110_issue_42_plan_duration_pricetype_yearround', '0111_issue_46_guide_request_accept', '0130_issue_46_refund_policy_snapshot',
    '0128_issue_42_plan_seasonal_pricing', '0132_issue_42_seasonal_price_resolution', '0136_issue_755_create_tour_order_invoker',
    '0087_issue_8b_tour_orders', '0003_tenants_and_accounts',
  ])('requires exact applied prerequisite %s', (repoFile) => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === repoFile).classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_749_0137)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING|requires an exact applied prerequisite/);
  });

  it('requires the reviewed 0099 alias like the other create_tour_order scopes', () => {
    const map = aliasMap();
    map.entries.find((entry: any) => entry.repoFile === '0099_drop_legacy_create_tour_order_overload').classification = 'NOT_APPLIED';
    expect(() => selectedProductionMigrations(map, ISSUE_749_0137)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING|0099/);
  });

  it('rejects the scope once 0137 is no longer pending', () => {
    const map = aliasMap();
    const entry = map.entries.find((item: any) => item.repoFile === MIGRATION);
    entry.classification = 'EXACT'; entry.ledgerNames = [MIGRATION]; delete entry.notAppliedReason;
    expect(() => selectedProductionMigrations(map, ISSUE_749_0137)).toThrow(/MIGRATION_SCOPE_DEPENDENCY_NOT_PENDING|requires pending migrations/);
  });

  it('does not silently pull 0132/0136 back in when they are pending: they must be applied first', () => {
    const map = aliasMap();
    for (const repoFile of ['0132_issue_42_seasonal_price_resolution', '0136_issue_755_create_tour_order_invoker']) {
      const entry = map.entries.find((item: any) => item.repoFile === repoFile);
      entry.classification = 'NOT_APPLIED'; entry.ledgerNames = []; entry.notAppliedReason = 'PENDING_APPLY';
    }
    expect(() => selectedProductionMigrations(map, ISSUE_749_0137)).toThrow(/MIGRATION_SCOPE_APPLIED_PREREQUISITE_MISSING/);
  });

  it('pins the capture table: three scopes, original-eight and 0113 values unchanged', () => {
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_46_0110_0136_CLOSURE]).toEqual({ migrationCount: 8, routinesRequired: true, createTourOrderFamily: true });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_23_0113]).toEqual({ migrationCount: 1, routinesRequired: false, createTourOrderFamily: false });
    expect(SCOPED_RELEASE_CAPTURE_SCOPES[ISSUE_749_0137]).toEqual({ migrationCount: 1, routinesRequired: true, createTourOrderFamily: true,
      appliedSourceFiles: [
        '0110_issue_42_plan_duration_pricetype_yearround', '0111_issue_46_guide_request_accept', '0128_issue_42_plan_seasonal_pricing',
        '0130_issue_46_refund_policy_snapshot', '0132_issue_42_seasonal_price_resolution', '0136_issue_755_create_tour_order_invoker'] });
    expect(Object.keys(SCOPED_RELEASE_CAPTURE_SCOPES)).toEqual([ISSUE_46_0110_0136_CLOSURE, ISSUE_23_0113, ISSUE_749_0137, 'ISSUE_37_0131_0134']);
  });

  it('impact manifest declares the routine and ACL 0137 creates', () => {
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const keys = manifest.entries.find((entry: any) => entry.repoFile === MIGRATION).impacts.map((i: any) => `${i.surface}:${i.objectKey}`);
    expect(keys).toHaveLength(2);
    expect(keys.some((key: string) => key.startsWith('routines:public.create_tour_order_quoted('))).toBe(true);
    expect(keys.some((key: string) => key.startsWith('acl:function:public.create_tour_order_quoted('))).toBe(true);
  });
});

describe('#755 ISSUE_749_0137 consistency dispatch', () => {
  const report = { observedMainSha: SHA, status: 'DRIFT_BLOCKED', differences: [], safety: { authorizesDatabaseWrite: false } };
  const plan = (scope: string, count: number) => ({ mainSha: SHA, planDigest: 'b'.repeat(64), migrationScope: scope,
    migrations: Array.from({ length: count }, (_, i) => ({ repoFile: i === 0 ? MIGRATION : `x${i}`, path: 'p', sha256: 'c'.repeat(64) })) });
  const run = (p: any) => buildProductionConsistencyEvidence({ report, plan: p, impactManifest: { schemaVersion: 1, entries: [] }, mainSha: SHA, planDigest: 'b'.repeat(64) });

  it('routes the scope through the scoped path despite a DRIFT_BLOCKED raw observer report', () => {
    const real = buildProductionDbReleasePlan({ releaseId: 'issue755-0137-test-20261019', mainSha: SHA, plannedAt: '2026-10-19T00:00:00Z',
      aliasMap: aliasMap(), migrationScope: ISSUE_749_0137, readCanonicalSql });
    const manifest = JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8'));
    const call = (impactManifest: any) => buildProductionConsistencyEvidence({ repoRoot: preReleaseRepoRoot(), report, plan: real, impactManifest, mainSha: SHA, planDigest: real.planDigest });
    expect(() => call({ schemaVersion: 1, entries: [] })).toThrow(/RELEASE_MANIFEST_SOURCE_MISMATCH/);
    expect(() => call(manifest)).toThrow(/RELEASE_G3_BINDING_REQUIRED/);
  });
  it('rejects a wrong migration count for the scope', () => {
    expect(() => run(plan(ISSUE_749_0137, 2))).toThrow(/RELEASE_SCOPE_MISMATCH/);
  });
});

describe('#755 ISSUE_749_0137 workflow wiring', () => {
  const orchestrator = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
  const ci = parse(readFileSync('.github/workflows/ci.yml', 'utf8'));
  it('orchestrator downloads catalogs for the new scope', () => {
    expect(orchestrator).toContain("plan.migrationScope == 'ISSUE_749_0137'");
  });
  it('ci dispatch admits the scope', () => {
    expect(ci.on.workflow_dispatch.inputs.production_db_release_scope.options).toContain('ISSUE_749_0137');
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain('ISSUE_23_0113|ISSUE_749_0137) ;;');
  });
});

describe('#755 ISSUE_749_0137 source model (canonical last-defining sources)', () => {
  const sql = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
  const find = (map: Map<string, any>, name: string) => { const hits = [...map.values()].filter((r: any) => r.name === name); expect(hits).toHaveLength(1); return hits[0]; };
  const catalog = (scope: string, migrations: string[]) => sourceCatalog({
    plan: { migrations: migrations.map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })) },
    repoRoot: process.cwd(), readCanonicalSql,
    appliedSourceFiles: (SCOPED_RELEASE_CAPTURE_SCOPES as any)[scope]?.appliedSourceFiles });

  it('create/cancel/expire before == after, from 0132(+0136 invoker)/0111/0111, never 0087/0100', () => {
    const { before, after } = catalog(ISSUE_749_0137, [MIGRATION]);
    for (const name of ['public.create_tour_order', 'public.cancel_tour_order', 'public.expire_tour_order']) {
      expect(find(before, name)).toEqual(find(after, name));
    }
    const create = find(after, 'public.create_tour_order');
    expect(sql('0132_issue_42_seasonal_price_resolution')).toContain(create.body);
    expect(create.source.path).toContain('0132_issue_42_seasonal_price_resolution');
    expect(create.securityDefiner).toBe(false);
    expect(create.alterSource.path).toContain('0136_issue_755_create_tour_order_invoker');
    for (const name of ['public.cancel_tour_order', 'public.expire_tour_order']) {
      const routine = find(after, name);
      expect(routine.source.path).toContain('0111_issue_46_guide_request_accept');
      expect(sql('0111_issue_46_guide_request_accept')).toContain(routine.body);
      expect(sql('0087_issue_8b_tour_orders')).not.toContain(routine.body);
      expect(sql('0100_issue_350_expire_tour_order')).not.toContain(routine.body);
    }
    expect(sql('0087_issue_8b_tour_orders')).not.toContain(create.body);
  });

  it('original-eight scope keeps the 0087/0100 before override and a distinct after', () => {
    const roots = ['0110_issue_42_plan_duration_pricetype_yearround', '0111_issue_46_guide_request_accept', '0115_issue_21_external_calendars',
      '0128_issue_42_plan_seasonal_pricing', '0130_issue_46_refund_policy_snapshot', '0132_issue_42_seasonal_price_resolution',
      '0135_issue_46_guide_interval_availability', '0136_issue_755_create_tour_order_invoker'];
    const { before, after } = catalog(ISSUE_46_0110_0136_CLOSURE, roots);
    expect(sql('0087_issue_8b_tour_orders')).toContain(find(before, 'public.create_tour_order').body);
    expect(sql('0087_issue_8b_tour_orders')).toContain(find(before, 'public.cancel_tour_order').body);
    expect(sql('0100_issue_350_expire_tour_order')).toContain(find(before, 'public.expire_tour_order').body);
    expect(find(after, 'public.create_tour_order').body).not.toBe(find(before, 'public.create_tour_order').body);
    expect(find(after, 'public.cancel_tour_order').source.path).toContain('0111_issue_46_guide_request_accept');
  });

  it('0113 scope applies no applied-source override and skips >=0110 unselected files', () => {
    const { before, after } = catalog(ISSUE_23_0113, ['0113_issue_23_promotion_page_view_events']);
    expect(sql('0087_issue_8b_tour_orders')).toContain(find(before, 'public.create_tour_order').body);
    expect(find(after, 'public.create_tour_order').source.path).toContain('0087_issue_8b_tour_orders');
  });
});
