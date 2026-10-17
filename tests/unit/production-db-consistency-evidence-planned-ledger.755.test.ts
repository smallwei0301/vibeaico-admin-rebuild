import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { assembleProductionDbConsistencyEvidence } from '../../scripts/agents/assemble-production-db-release-evidence.mjs';
import { buildReleaseCatalogCapture } from '../../scripts/agents/schema-drift-watch.mjs';
import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import { assertLiveLedgerMatchesAliasMap } from '../../scripts/db/controlled-production-db-release.mjs';
import { buildAtomicTestReleaseValidationSql } from '../../scripts/db/validate-production-db-release-on-test.mjs';
import { advanceReleaseJournal, createReleaseJournal } from '../../scripts/agents/production-db-release-journal.mjs';
import { finalizeProductionDbPostcheck } from '../../scripts/agents/production-db-postcheck.mjs';
import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { buildObserverSnapshotFromRaw, compareObserverSnapshots } from '../../scripts/agents/schema-drift-watch.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const MIGRATION = '0136_issue_755_create_tour_order_invoker';
const OTHER = '0135_issue_46_guide_interval_availability';
const NOW = '2026-10-07T22:00:00Z';
const BASELINE = { version: '0105', name: '0105_previous_migration' };
const identity = (name: string) => ({ version: name.slice(0, 4), name });
const manifest = { schemaVersion: 1, entries: [{ repoFile: MIGRATION, impacts: [] }] };

// Exercise the real read-only producer, using synthetic snapshots only. No DB
// capture or mutation is invoked, and this is not a release/G0 acceptance test.
function snapshot(environment: 'LOCAL_EXPECTED' | 'TEST' | 'PRODUCTION', missing: string[] = [], names = [MIGRATION], ledger?: { version: string; name: string }[], sha = MAIN) {
  return buildObserverSnapshotFromRaw({
    environment,
    projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh'
      : environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: NOW, observedMainSha: sha,
    evidenceRef: environment === 'LOCAL_EXPECTED' ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`,
    raw: {
      metadata: { counts: { columns: 0, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [] },
      acl: { tables: [], functions: [] },
      ledger: ledger ?? [BASELINE, ...names.filter(name => !missing.includes(name)).map(identity)],
    },
  });
}

function fixture(names = [MIGRATION], ledger?: { version: string; name: string }[]) {
  const report = compareObserverSnapshots({
    expectedSnapshot: snapshot('LOCAL_EXPECTED', [], names),
    testSnapshot: snapshot('TEST', [], names),
    productionSnapshot: snapshot('PRODUCTION', names, names),
    currentMainSha: MAIN, now: Date.parse(NOW),
  });
  return {
    report,
    plan: { mainSha: MAIN, planDigest: PLAN, migrations: [{ repoFile: MIGRATION, ledgerVersion: '20261007220000' }] },
    impactManifest: structuredClone(manifest), mainSha: MAIN, planDigest: PLAN,
  };
}

describe('#755 planned missing ledger producer/consumer contract', () => {
  it('accepts a producer-classified exact selected canonical ledger omission without adding a manifest surface', () => {
    const input = fixture();
    expect(input.report).toMatchObject({ status: 'EXPECTED_PENDING_PRODUCTION', environmentStatuses: { TEST: 'MATCH' } });
    expect(input.report.differences).toEqual([expect.objectContaining({
      surface: 'migrationLedger', objectKey: `0136/${MIGRATION}`,
      observedFingerprint: null, classification: 'EXPECTED_PENDING_PRODUCTION',
    })]);
    expect(buildProductionConsistencyEvidence(input)).toMatchObject({
      status: 'CONSISTENCY_VERIFIED', plannedProductionDifferenceCount: 1,
      unexplainedDifferences: 0, databaseMutationAuthorized: false,
    });
  });

  it('rejects another canonical migration missing outside the selected plan', () => {
    expect(() => buildProductionConsistencyEvidence(fixture([MIGRATION, OTHER]))).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
  });

  it.each([
    ['same prefix, different name', { objectKey: '0136/0136_unselected_migration' }],
    ['same name, different version', { objectKey: `0135/${MIGRATION}` }],
    ['writer timestamp instead of canonical version', { objectKey: `20261007220000/${MIGRATION}` }],
    ['path instead of canonical identity', { objectKey: `0136/supabase/migrations/${MIGRATION}.sql` }],
    ['wrong expected fingerprint', { expectedFingerprint: 'c'.repeat(64) }],
    ['missing expected fingerprint', { expectedFingerprint: null }],
    ['existing changed ledger', { observedFingerprint: 'd'.repeat(64) }],
    ['undefined observed fingerprint', { observedFingerprint: undefined }],
  ])('rejects %s', (_name, patch) => {
    const input = fixture();
    Object.assign(input.report.differences[0], patch);
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
  });

  it('still requires the selected migration impact manifest entry', () => {
    const input = fixture();
    input.impactManifest.entries = [];
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/MISSING_IMPACT_MANIFEST_ENTRY/);
  });

  it('does not admit unplanned non-ledger surfaces', () => {
    const input = fixture();
    Object.assign(input.report.differences[0], { surface: 'columns', objectKey: 'public.trips.surprise' });
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
  });

  it('does not turn pending TEST into release-ready evidence', () => {
    const input = fixture();
    input.report = compareObserverSnapshots({
      expectedSnapshot: snapshot('LOCAL_EXPECTED'), testSnapshot: snapshot('TEST', [MIGRATION]),
      productionSnapshot: snapshot('PRODUCTION', [MIGRATION]), currentMainSha: MAIN, now: Date.parse(NOW),
    });
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/TEST_SCHEMA_NOT_READY/);
  });

  it('still rejects stale source binding', () => {
    const input = fixture();
    input.report.observedMainSha = 'e'.repeat(40);
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/CONSISTENCY_MAIN_MISMATCH/);
  });

  it('still rejects an observer claiming write authority', () => {
    const input = fixture();
    input.report.safety.authorizesDatabaseWrite = true;
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/OBSERVER_SCOPE_ESCALATION/);
  });

  it('still rejects expired exceptions and blocked drift', () => {
    const input = fixture();
    input.report.exceptionSummary.expired = 1;
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/STALE_DRIFT_EXCEPTION/);
    input.report.status = 'DRIFT_BLOCKED';
    expect(() => buildProductionConsistencyEvidence(input)).toThrow(/DRIFT_BLOCKED/);
  });
});


// A one-migration source fixture isolates actual G3 writer identity. It reads
// canonical 0136 bytes and invokes the real SQL builder, but executes no SQL.
function writerFixture(existingVersion?: string) {
  const aliasMap = { schemaVersion: 1, entries: [{ repoFile: MIGRATION, ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY' }] };
  const readCanonicalSql = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
  const plan = buildProductionDbReleasePlan({ releaseId: 'issue755-writer-identity-fixture', mainSha: MAIN, plannedAt: NOW, aliasMap, readCanonicalSql });
  const liveLedgerRows = existingVersion ? [BASELINE, { version: existingVersion, name: MIGRATION }] : [BASELINE];
  const built = buildAtomicTestReleaseValidationSql({ plan, aliasMap, liveLedgerRows, readCanonicalSql });
  const rows = [...built.sql.matchAll(/insert into supabase_migrations\.schema_migrations\(version, statements, name, created_by, idempotency_key\) values \('([^']+)', null, '([^']+)'/g)]
    .map(match => ({ version: match[1], name: match[2] }));
  expect(rows).toEqual(existingVersion ? [] : [{ version: plan.migrations[0].ledgerVersion, name: MIGRATION }]);
  expect(built.decisions[0].existedBefore).toBe(Boolean(existingVersion));
  const observedRows = existingVersion ? [{ version: existingVersion, name: MIGRATION }] : rows;
  const proofIdentity = { repository: plan.repository, releaseId: plan.releaseId, mainSha: MAIN, planDigest: plan.planDigest, testProjectRef: 'nmwhwngojosmagjuvxol', sourceRunId: '123', sourceRunAttempt: 2, databaseMutationAuthorized: false, productionMutationPerformed: false };
  const releasePlanEvidence = { ...proofIdentity, status: 'TEST_RELEASE_PLAN_VERIFIED', testMutationPerformed: true, migrations: [{ ...plan.migrations[0], execution: existingVersion ? 'REPLAY_VERIFIED' : 'APPLIED_VERIFIED', ledgerVersion: observedRows[0].version }] };
  const postTestSchemaEvidence = { ...proofIdentity, status: 'TEST_POST_APPLY_SCHEMA_CAPTURED', readOnly: true, comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED', captureDigest: 'c'.repeat(64), migrationLedgerDigest: 'd'.repeat(64), observedAt: NOW, plannedMigrations: [{ repoFile: MIGRATION, ledgerVersion: observedRows[0].version }] };
  const releaseLedgerBinding = {
    releaseId: plan.releaseId, plan, releasePlanEvidence, postTestSchemaEvidence,
    sourceRun: { repository: plan.repository, workflowPath: '.github/workflows/ci.yml', event: 'workflow_dispatch', branch: 'main', headSha: MAIN, id: '123', attempt: 2, status: 'completed', conclusion: 'success' },
    testEvidence: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 1, cleanup: 'PASSED', mainSha: MAIN, planDigest: plan.planDigest,
      testProjectRef: 'nmwhwngojosmagjuvxol', sourceRunId: '123', sourceRunAttempt: 2, integrationStep: 'PASSED', e2eStep: 'PASSED', databaseMutationAuthorized: false },
  };
  const args = { expectedSnapshot: snapshot('LOCAL_EXPECTED'), testSnapshot: snapshot('TEST', [], [MIGRATION], [BASELINE, ...observedRows]),
    productionSnapshot: snapshot('PRODUCTION', [MIGRATION]), currentMainSha: MAIN, now: Date.parse(NOW), releaseLedgerBinding, aliasMap, readCanonicalSql };
  return { args, plan, rows: observedRows };
}

describe('#755 trusted G3 writer to observer identity binding', () => {
  it.each([
    ['0136', MIGRATION], ['20261007220000', MIGRATION], ['0135', MIGRATION],
    ['0136', MIGRATION.slice(5)], ['20261007220000', MIGRATION.slice(5)],
  ])('rejects selected pending migration already in Production as %s/%s', (version, name) => {
    const { args, plan } = writerFixture('0136');
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, { version: '0136', name: MIGRATION.slice(5) }]);
    const liveLedgerRows = [BASELINE, { version, name }];
    args.productionSnapshot = snapshot('PRODUCTION', [], [MIGRATION], liveLedgerRows);
    const original = structuredClone({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot });
    const aliasMap = { ...args.aliasMap, entries: [
      { repoFile: BASELINE.name, ledgerNames: [BASELINE.name], classification: 'EXACT' }, ...args.aliasMap.entries,
    ] };
    expect(() => assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows: [BASELINE] })).not.toThrow();
    expect(() => assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows })).toThrow(/LIVE_LEDGER_DRIFT/);
    expect(() => {
      const report = compareObserverSnapshots(args);
      buildProductionConsistencyEvidence({ ...fixture(), report, plan, planDigest: plan.planDigest });
    }).toThrow(/PLANNED_PRODUCTION_LEDGER_PRESENT/);
    expect({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot }).toEqual(original);
  });

  it('rejects already-present selected Production identity with a full canonical expected name too', () => {
    const { args } = writerFixture('0136');
    args.productionSnapshot = snapshot('PRODUCTION');
    expect(() => compareObserverSnapshots(args)).toThrow(/PLANNED_PRODUCTION_LEDGER_PRESENT/);
  });

  it.each([MIGRATION, MIGRATION.slice(5)])('preserves unbound post-apply parity with name %s', (name) => {
    const { args } = writerFixture('0136');
    const ledger = [BASELINE, { version: '0136', name }];
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], ledger);
    args.testSnapshot = snapshot('TEST', [], [MIGRATION], ledger);
    args.productionSnapshot = snapshot('PRODUCTION', [], [MIGRATION], ledger);
    const { releaseLedgerBinding: _binding, ...unbound } = args;
    expect(compareObserverSnapshots(unbound)).toMatchObject({ status: 'MATCH', differenceCount: 0 });
    expect(compareObserverSnapshots(unbound)).not.toHaveProperty('plannedLedgerMapping');
  });

  it.each([undefined, '0136'])('accepts CLI replay short names with verified TEST version %s in a comparison-only view', (version) => {
    const { args, plan, rows } = writerFixture(version);
    const cliIdentity = { version: '0136', name: MIGRATION.slice(5) };
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, cliIdentity]);
    const original = structuredClone({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot });
    const report = compareObserverSnapshots(args);
    expect(report).toMatchObject({ status: 'EXPECTED_PENDING_PRODUCTION', environmentStatuses: { TEST: 'MATCH' },
      plannedLedgerMapping: { canonicalReplayMappings: [{ observed: cliIdentity, canonical: identity(MIGRATION) }] } });
    expect(report.differences).toEqual([expect.objectContaining({
      surface: 'migrationLedger', objectKey: `0136/${MIGRATION}`, observedFingerprint: null, classification: 'EXPECTED_PENDING_PRODUCTION',
    })]);
    expect(buildProductionConsistencyEvidence({ ...fixture(), report, plan, planDigest: plan.planDigest })).toMatchObject({
      status: 'CONSISTENCY_VERIFIED', databaseMutationAuthorized: false,
    });
    expect({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot }).toEqual(original);
    expect(report.environments.expected.captureDigest).toEqual(original.expected.captureDigest);
    expect(report.environments.expected.migrationLedger).toEqual(original.expected.migrationLedger.digest);
    expect(report.environments.TEST.captureDigest).toEqual(original.test.captureDigest);
    expect(report.environments.PRODUCTION.captureDigest).toEqual(original.production.captureDigest);
    expect(rows[0].name).toBe(MIGRATION);
  });

  it.each([
    ['full name with wrong version', [{ version: '0135', name: MIGRATION }]],
    ['short name with wrong version', [{ version: '0135', name: MIGRATION.slice(5) }]],
    ['writer timestamp as canonical version', [{ version: '20261007000000', name: MIGRATION.slice(5) }]],
    ['wrong name at the same version', [{ version: '0136', name: 'issue_755_wrong_name' }]],
    ['another prefix in the name', [{ version: '0136', name: `0135_${MIGRATION.slice(5)}` }]],
    ['doubled prefix', [{ version: '0136', name: `0136_${MIGRATION}` }]],
    ['SQL extension', [{ version: '0136', name: `${MIGRATION}.sql` }]],
    ['full and short names', [identity(MIGRATION), { version: '0136', name: MIGRATION.slice(5) }]],
    ['full name plus wrong-version short name', [identity(MIGRATION), { version: '0135', name: MIGRATION.slice(5) }]],
    ['short name plus wrong-version full name', [{ version: '0136', name: MIGRATION.slice(5) }, { version: '0135', name: MIGRATION }]],
  ])('rejects canonical replay %s', (_name, ledger) => {
    const { args } = writerFixture();
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, ...ledger]);
    expect(() => compareObserverSnapshots(args)).toThrow(/CANONICAL_LEDGER_IDENTITY_REQUIRED/);
  });

  it('rejects duplicate canonical replay rows before resolving either name format', () => {
    const { args } = writerFixture();
    const row = { version: '0136', name: MIGRATION.slice(5) };
    expect(() => {
      args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, row, row]);
      compareObserverSnapshots(args);
    }).toThrow(/DUPLICATE_LEDGER_IDENTITY/);
  });

  it('leaves CLI versus writer names unexplained without the trusted binding', () => {
    const { args } = writerFixture('0136');
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, { version: '0136', name: MIGRATION.slice(5) }]);
    const { releaseLedgerBinding: _binding, ...unbound } = args;
    const report = compareObserverSnapshots(unbound);
    expect(report.status).toBe('DRIFT_BLOCKED');
    expect(report).not.toHaveProperty('plannedLedgerMapping');
    expect(report.differences).toContainEqual(expect.objectContaining({ objectKey: `0136/${MIGRATION.slice(5)}` }));
  });

  it.each([OTHER, '0137_issue_749_create_tour_order_quoted'])('does not normalize unselected CLI identity %s', (unselected) => {
    const { args } = writerFixture('0136');
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE,
      { version: '0136', name: MIGRATION.slice(5) }, { version: unselected.slice(0, 4), name: unselected.slice(5) }]);
    args.testSnapshot = snapshot('TEST', [], [MIGRATION, unselected]);
    const report = compareObserverSnapshots(args);
    expect(report.status).toBe('DRIFT_BLOCKED');
    expect(report).toHaveProperty('plannedLedgerMapping.canonicalReplayMappings.length', 1);
    expect(report.differences).toContainEqual(expect.objectContaining({
      environment: 'TEST', objectKey: `${unselected.slice(0, 4)}/${unselected.slice(5)}`, classification: null,
    }));
  });

  it.each(['short-only', 'both-forms'])('does not invent a verified TEST alias for %s', (variant) => {
    const { args } = writerFixture('0136');
    const short = { version: '0136', name: MIGRATION.slice(5) };
    args.expectedSnapshot = snapshot('LOCAL_EXPECTED', [], [MIGRATION], [BASELINE, short]);
    args.testSnapshot = snapshot('TEST', [], [MIGRATION], [BASELINE, short, ...(variant === 'both-forms' ? [identity(MIGRATION)] : [])]);
    const report = compareObserverSnapshots(args);
    expect(report.status).toBe('DRIFT_BLOCKED');
    expect(report).toMatchObject({ environmentStatuses: { TEST: 'DRIFT_BLOCKED' } });
  });

  it('accepts the exact real writer identity without changing any captured ledger or digest', () => {
    const { args, plan, rows } = writerFixture();
    const original = structuredClone(args.testSnapshot);
    const report = compareObserverSnapshots(args);
    expect(report).toMatchObject({ status: 'EXPECTED_PENDING_PRODUCTION', environmentStatuses: { TEST: 'MATCH' },
      plannedLedgerMapping: { planDigest: plan.planDigest, sourceRunId: '123', sourceRunAttempt: 2,
        mappings: [{ observed: rows[0], canonical: identity(MIGRATION) }] } });
    expect(args.testSnapshot).toEqual(original);
    expect(report.environments.TEST.captureDigest).toEqual(original.captureDigest);
    expect(buildProductionConsistencyEvidence({ ...fixture(), report, plan, planDigest: plan.planDigest })).toMatchObject({ status: 'CONSISTENCY_VERIFIED', databaseMutationAuthorized: false });
  });

  it.each(['20261007000000', '0136'])('accepts real writer replay of exactly observed %s without new inserts', (version) => {
    const { args, plan } = writerFixture(version);
    const report = compareObserverSnapshots(args);
    expect(report.status).toBe('EXPECTED_PENDING_PRODUCTION');
    expect(buildProductionConsistencyEvidence({ ...fixture(), report, plan, planDigest: plan.planDigest }).status).toBe('CONSISTENCY_VERIFIED');
  });

  describe('post_apply release phase', () => {
    function applied() {
      const { args, plan } = writerFixture();
      const ledger = [BASELINE, { version: plan.migrations[0].ledgerVersion, name: MIGRATION }];
      args.productionSnapshot = snapshot('PRODUCTION', [], [MIGRATION], ledger);
      return { args, plan };
    }
    it('pre_apply (default) still rejects a selected migration already in Production; post_apply compares and postcheck is READY', () => {
      const { args, plan } = applied();
      expect(() => compareObserverSnapshots(args)).toThrow(/PLANNED_PRODUCTION_LEDGER_PRESENT/);
      expect(() => compareObserverSnapshots({ ...args, releasePhase: 'pre_apply' })).toThrow(/PLANNED_PRODUCTION_LEDGER_PRESENT/);
      expect(() => compareObserverSnapshots({ ...args, releasePhase: 'bogus' })).toThrow(/INVALID_RELEASE_PHASE/);
      const report = compareObserverSnapshots({ ...args, releasePhase: 'post_apply' });
      expect(report.observedMainSha).toBe(MAIN);
      let journal = createReleaseJournal({ releaseId: plan.releaseId, mainSha: MAIN, planDigest: plan.planDigest, createdAt: '2026-10-16T09:00:00Z' });
      journal = advanceReleaseJournal(journal, { status: 'APPLYING', at: '2026-10-16T09:01:00Z', evidenceRef: 'writer:start' });
      journal = advanceReleaseJournal(journal, { status: 'APPLIED_CONFIRMED', at: '2026-10-16T09:02:00Z', evidenceRef: 'readback:applied' });
      const consistency = { status: 'CONSISTENCY_VERIFIED', mainSha: MAIN, planDigest: plan.planDigest, plannedProductionDifferences: [
        { surface: 'routines', objectKey: 'public.create_tour_order(uuid)', expectedFingerprint: '1'.repeat(64) },
        { surface: 'migrationLedger', objectKey: `0136/${MIGRATION}`, expectedFingerprint: '2'.repeat(64) }] };
      expect(finalizeProductionDbPostcheck({ report, preApplyReport: compareObserverSnapshots(writerFixture().args), plan, journal, consistency, now: '2026-10-16T09:03:00Z' }))
        .toMatchObject({ status: 'PRODUCTION_SCHEMA_READY', databaseMutationAuthorized: false });
    });
    it('collect g2 keeps the pre_apply default and the consistency assembly; only g7/g7-recheck pass post_apply', () => {
      const g2 = ORCHESTRATOR.split('\n  g2:\n')[1].split('\n  g4-backup:')[0];
      expect(g2).not.toContain('release_phase');
      expect(OBSERVER_WORKFLOW).toContain("default: pre_apply");
      expect(OBSERVER_WORKFLOW).toContain('assemble-production-db-release-evidence.mjs consistency');
      expect(ORCHESTRATOR.match(/release_phase: post_apply/g)).toHaveLength(2);
    });
  });

  describe('later main with unchanged migrations (postcheck recheck)', () => {
    const LATER = 'e'.repeat(40);
    function later(flag: Record<string, unknown> | null) {
      const { args, plan, rows } = writerFixture();
      const ledger = [BASELINE, ...rows];
      const next = { ...args, currentMainSha: LATER,
        expectedSnapshot: snapshot('LOCAL_EXPECTED', [], [MIGRATION], undefined, LATER),
        testSnapshot: snapshot('TEST', [], [MIGRATION], ledger, LATER),
        productionSnapshot: snapshot('PRODUCTION', [MIGRATION], [MIGRATION], undefined, LATER),
        releaseLedgerBinding: { ...args.releaseLedgerBinding, ...(flag ?? {}) } };
      return { args: next, plan };
    }
    it('stays strict on a later main without the workflow flag', () => {
      expect(() => compareObserverSnapshots(later(null).args)).toThrow(/LEDGER_PLAN_BINDING_MISMATCH/);
      expect(() => compareObserverSnapshots(later({ planMainSha: MAIN }).args)).toThrow(/LEDGER_PLAN_BINDING_MISMATCH/);
      expect(() => compareObserverSnapshots(later({ migrationsUnchangedSincePlan: false, planMainSha: MAIN }).args)).toThrow(/LEDGER_PLAN_BINDING_MISMATCH/);
    });
    it('proceeds with the scoped compare when the flag and planMainSha are present', () => {
      const { args } = later({ planMainSha: MAIN, migrationsUnchangedSincePlan: true });
      const report = compareObserverSnapshots(args);
      expect(report).toMatchObject({ observedMainSha: LATER, status: 'EXPECTED_PENDING_PRODUCTION',
        plannedLedgerMapping: { planMainSha: MAIN, migrationsUnchangedSincePlan: true } });
    });
    it('rejects the flag with a wrong planMainSha, a changed plan digest or foreign evidence', () => {
      expect(() => compareObserverSnapshots(later({ planMainSha: LATER, migrationsUnchangedSincePlan: true }).args)).toThrow(/LEDGER_PLAN_BINDING_MISMATCH/);
      expect(() => compareObserverSnapshots(later({ migrationsUnchangedSincePlan: true }).args)).toThrow(/LEDGER_PLAN_BINDING_MISMATCH/);
      const flagged = later({ planMainSha: MAIN, migrationsUnchangedSincePlan: true }).args;
      flagged.releaseLedgerBinding = { ...flagged.releaseLedgerBinding, plan: { ...flagged.releaseLedgerBinding.plan, planDigest: 'f'.repeat(64) } };
      expect(() => compareObserverSnapshots(flagged)).toThrow();
      const foreign = later({ planMainSha: MAIN, migrationsUnchangedSincePlan: true }).args;
      foreign.releaseLedgerBinding = { ...foreign.releaseLedgerBinding, sourceRun: { ...foreign.releaseLedgerBinding.sourceRun, headSha: LATER } };
      expect(() => compareObserverSnapshots(foreign)).toThrow(/UNTRUSTED_G3_LEDGER_SOURCE/);
    });
    it('consistency evidence binds to the plan main but needs an explicit observedMainSha for a later report', () => {
      const base = fixture();
      const report = { ...base.report, observedMainSha: LATER };
      expect(() => buildProductionConsistencyEvidence({ ...base, report })).toThrow(/CONSISTENCY_MAIN_MISMATCH/);
      expect(buildProductionConsistencyEvidence({ ...base, report, observedMainSha: LATER })).toMatchObject({ status: 'CONSISTENCY_VERIFIED', mainSha: MAIN });
    });
  });

  it('remains strict without the trusted plan binding', () => {
    const { args } = writerFixture();
    const { releaseLedgerBinding: _binding, ...unbound } = args;
    expect(compareObserverSnapshots(unbound).status).toBe('DRIFT_BLOCKED');
  });

  it.each([
    ['wrong main', (x: any) => { x.releaseLedgerBinding.plan.mainSha = 'f'.repeat(40); }],
    ['wrong release', (x: any) => { x.releaseLedgerBinding.releaseId = 'different-release'; }],
    ['wrong plan digest', (x: any) => { x.releaseLedgerBinding.plan.planDigest = '0'.repeat(64); }],
    ['wrong canonical SQL', (x: any) => { x.readCanonicalSql = () => 'select 1;'; }],
    ['wrong plan hash', (x: any) => { x.releaseLedgerBinding.plan.migrations[0].sha256 = '0'.repeat(64); }],
    ['wrong run', (x: any) => { x.releaseLedgerBinding.sourceRun.id = '124'; }],
    ['wrong attempt', (x: any) => { x.releaseLedgerBinding.sourceRun.attempt = 3; }],
    ['wrong workflow', (x: any) => { x.releaseLedgerBinding.sourceRun.workflowPath = '.github/workflows/other.yml'; }],
    ['wrong event', (x: any) => { x.releaseLedgerBinding.sourceRun.event = 'pull_request'; }],
    ['wrong ref', (x: any) => { x.releaseLedgerBinding.sourceRun.branch = 'feature'; }],
    ['wrong run SHA', (x: any) => { x.releaseLedgerBinding.sourceRun.headSha = 'f'.repeat(40); }],
    ['failed run', (x: any) => { x.releaseLedgerBinding.sourceRun.conclusion = 'failure'; }],
    ['failed cleanup', (x: any) => { x.releaseLedgerBinding.testEvidence.cleanup = 'FAILED'; }],
    ['policy skip', (x: any) => { x.releaseLedgerBinding.testEvidence.policySkip = true; }],
    ['wrong TEST plan', (x: any) => { x.releaseLedgerBinding.testEvidence.planDigest = '0'.repeat(64); }],
    ['wrong TEST project', (x: any) => { x.releaseLedgerBinding.testEvidence.testProjectRef = 'egehnijjpgijmccagxac'; }],
    ['wrong execution project', (x: any) => { x.releaseLedgerBinding.releasePlanEvidence.testProjectRef = 'egehnijjpgijmccagxac'; }],
    ['wrong post-TEST project', (x: any) => { x.releaseLedgerBinding.postTestSchemaEvidence.testProjectRef = 'egehnijjpgijmccagxac'; }],
    ['missing execution proof', (x: any) => { delete x.releaseLedgerBinding.releasePlanEvidence; }],
    ['missing post-TEST proof', (x: any) => { delete x.releaseLedgerBinding.postTestSchemaEvidence; }],
    ['execution hash', (x: any) => { x.releaseLedgerBinding.releasePlanEvidence.migrations[0].sha256 = '0'.repeat(64); }],
    ['execution name', (x: any) => { x.releaseLedgerBinding.releasePlanEvidence.migrations[0].repoFile = OTHER; }],
    ['execution version', (x: any) => { x.releaseLedgerBinding.releasePlanEvidence.migrations[0].ledgerVersion = '20260101000000'; }],
    ['post-TEST version', (x: any) => { x.releaseLedgerBinding.postTestSchemaEvidence.plannedMigrations[0].ledgerVersion = '20260101000000'; }],
    ['post-TEST plan', (x: any) => { x.releaseLedgerBinding.postTestSchemaEvidence.planDigest = '0'.repeat(64); }],
    ['post-TEST attempt', (x: any) => { x.releaseLedgerBinding.postTestSchemaEvidence.sourceRunAttempt = 3; }],
    ['post-TEST capture digest', (x: any) => { x.releaseLedgerBinding.postTestSchemaEvidence.captureDigest = 'invalid'; }],
    ['duplicate proof', (x: any) => { x.releaseLedgerBinding.releasePlanEvidence.migrations.push(x.releaseLedgerBinding.releasePlanEvidence.migrations[0]); }],
  ])('rejects %s binding', (_name, change) => {
    const { args } = writerFixture(); change(args);
    expect(() => compareObserverSnapshots(args)).toThrow();
  });

  it.each(['wrong-version', 'wrong-name', 'unselected', 'duplicate'])('rejects %s observed identity', (variant) => {
    const { args, rows } = writerFixture();
    let ledger = [BASELINE, ...rows];
    if (variant === 'wrong-version') ledger[1] = { ...rows[0], version: '20260101000000' };
    if (variant === 'wrong-name') ledger[1] = { ...rows[0], name: '0136_wrong_name' };
    if (variant === 'unselected') ledger.push({ version: '20260101000000', name: OTHER });
    if (variant === 'duplicate') ledger.push(identity(MIGRATION));
    args.testSnapshot = snapshot('TEST', [], [MIGRATION], ledger);
    if (['wrong-version', 'duplicate'].includes(variant)) expect(() => compareObserverSnapshots(args)).toThrow();
    else expect(compareObserverSnapshots(args).status).toBe('DRIFT_BLOCKED');
  });

  it('rejects a changed replay version or a falsely classified new apply', () => {
    const { args } = writerFixture('20261007000000');
    args.testSnapshot = snapshot('TEST', [], [MIGRATION], [BASELINE, { version: '20261006000000', name: MIGRATION }]);
    expect(() => compareObserverSnapshots(args)).toThrow(/UNPLANNED_LEDGER_VERSION/);
    const applied = writerFixture('20261007000000').args;
    applied.releaseLedgerBinding.releasePlanEvidence.migrations[0].execution = 'APPLIED_VERIFIED';
    expect(() => compareObserverSnapshots(applied)).toThrow(/G3_LEDGER_IDENTITY_MISMATCH/);
  });

  it('rejects tampered snapshot fingerprints and stale captures before using a binding', () => {
    const { args } = writerFixture();
    args.testSnapshot.captureDigest.value = '0'.repeat(64);
    expect(() => compareObserverSnapshots(args)).toThrow(/DIGEST/);
    const fresh = writerFixture().args;
    fresh.now += 61 * 60_000;
    expect(compareObserverSnapshots(fresh).status).toBe('EVIDENCE_UNAVAILABLE');
  });

  it('binds the consumer to the same plan and leaves Production timestamps unexplained', () => {
    const { args, plan, rows } = writerFixture();
    const report = compareObserverSnapshots(args);
    expect(() => buildProductionConsistencyEvidence({ ...fixture(), report })).toThrow(/CONSISTENCY_LEDGER_PLAN_MISMATCH/);
    args.productionSnapshot = snapshot('PRODUCTION', [], [MIGRATION], [BASELINE, ...rows]);
    expect(() => compareObserverSnapshots(args)).toThrow(/PLANNED_PRODUCTION_LEDGER_PRESENT/);
    expect(plan.mainSha).toBe(MAIN);
  });
});


const ORCHESTRATOR = readFileSync(new URL('../../.github/workflows/production-db-release-orchestrator.yml', import.meta.url), 'utf8');
const OBSERVER_WORKFLOW = readFileSync(new URL('../../.github/workflows/agent-schema-drift-watch.yml', import.meta.url), 'utf8');
const provenanceStep = ORCHESTRATOR.split('      - name: Verify G3 provenance for read-only ledger comparison\n')[1].split('      - name:')[0];
const provenanceScript = provenanceStep.split('          script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');

async function runProvenance(patch: Record<string, unknown> = {}, mode = 'collect') {
  const outputs: Record<string, string> = {};
  const run = { id: 123, repository: { full_name: 'smallwei0301/vibeaico-admin-rebuild' }, name: 'ci', path: '.github/workflows/ci.yml',
    event: 'workflow_dispatch', head_branch: 'main', head_sha: MAIN, run_attempt: 2, status: 'completed', conclusion: 'success', ...patch };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('github', 'context', 'core', 'process', 'require', provenanceScript)(
    { rest: { actions: { getWorkflowRun: async ({ run_id }: { run_id: number }) => { expect(run_id).toBe(123); return { data: run }; } } } },
    { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' } }, { setOutput: (key: string, value: string) => { outputs[key] = value; } },
    { env: { G3_RUN_ID: '123', EXPECTED_MAIN_SHA: MAIN, MODE: mode } }, createRequire(import.meta.url));
  return JSON.parse(outputs.run);
}

describe('#755 exact trusted G3 workflow wiring', () => {
  it('executes the real provenance step using a completed exact-main run readback', async () => {
    expect(await runProvenance()).toMatchObject({ id: '123', attempt: 2, headSha: MAIN, workflowPath: '.github/workflows/ci.yml' });
  });
  describe('postcheck earlier-G3-main admission (real git, temp repo)', () => {
    const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd }).toString().trim();
    function repo() {
      const dir = mkdtempSync(join(tmpdir(), 'g3-anc-'));
      git(dir, 'init', '-q'); mkdirSync(join(dir, 'supabase/migrations'), { recursive: true });
      writeFileSync(join(dir, 'supabase/migrations/0001.sql'), 'select 1;');
      git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'g3');
      const g3 = git(dir, 'rev-parse', 'HEAD');
      writeFileSync(join(dir, 'README.md'), 'x'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'unrelated');
      const unchanged = git(dir, 'rev-parse', 'HEAD');
      writeFileSync(join(dir, 'supabase/migrations/0002.sql'), 'select 2;'); git(dir, 'add', '-A'); git(dir, 'commit', '-qm', 'migration');
      const changed = git(dir, 'rev-parse', 'HEAD');
      return { dir, g3, unchanged, changed };
    }
    async function run(dir: string, g3: string, expected: string, mode: string) {
      const outputs: Record<string, string> = {};
      const run = { id: 123, repository: { full_name: 'smallwei0301/vibeaico-admin-rebuild' }, name: 'ci', path: '.github/workflows/ci.yml',
        event: 'workflow_dispatch', head_branch: 'main', head_sha: g3, run_attempt: 2, status: 'completed', conclusion: 'success' };
      const fakeRequire = () => ({ execFileSync: (cmd: string, args: string[], opts: any) => execFileSync(cmd, args, { ...opts, cwd: dir }) });
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      await new AsyncFunction('github', 'context', 'core', 'process', 'require', provenanceScript)(
        { rest: { actions: { getWorkflowRun: async () => ({ data: run }) } } },
        { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' } }, { setOutput: (k: string, v: string) => { outputs[k] = v; } },
        { env: { G3_RUN_ID: '123', EXPECTED_MAIN_SHA: expected, MODE: mode } }, fakeRequire);
      return outputs;
    }
    it('postcheck accepts an ancestor G3 main with unchanged migration inputs and flags it', async () => {
      const r = repo();
      expect(await run(r.dir, r.g3, r.unchanged, 'postcheck')).toMatchObject({ g3_head_sha: r.g3, migrations_unchanged: 'true' });
      expect(await run(r.dir, r.g3, r.g3, 'postcheck')).toMatchObject({ migrations_unchanged: 'false' });
    });
    it('postcheck rejects an ancestor G3 main when migrations changed or the G3 main is not an ancestor', async () => {
      const r = repo();
      await expect(run(r.dir, r.g3, r.changed, 'postcheck')).rejects.toThrow(/UNTRUSTED_G3_LEDGER_SOURCE/);
      await expect(run(r.dir, r.changed, r.g3, 'postcheck')).rejects.toThrow(/UNTRUSTED_G3_LEDGER_SOURCE/);
    });
    it.each(['collect', 'execute'])('%s keeps exact-main equality', async (mode) => {
      const r = repo();
      await expect(run(r.dir, r.g3, r.unchanged, mode)).rejects.toThrow(/UNTRUSTED_G3_LEDGER_SOURCE/);
    });
  });
  it.each([
    ['id', { id: 124 }], ['repository', { repository: { full_name: 'other/repo' } }], ['workflow', { path: '.github/workflows/other.yml' }],
    ['name', { name: 'other' }], ['event', { event: 'pull_request' }], ['ref', { head_branch: 'feature' }], ['SHA', { head_sha: 'f'.repeat(40) }],
    ['attempt', { run_attempt: 0 }], ['running', { status: 'in_progress' }], ['failed', { conclusion: 'failure' }],
  ])('rejects wrong %s API provenance', async (_name, patch) => { await expect(runProvenance(patch)).rejects.toThrow(/UNTRUSTED_G3_LEDGER_SOURCE/); });
  it('uses existing external G3 artifact and evidence reassembly, no new permissions or G7 path', () => {
    const admission = ORCHESTRATOR.split('  admission:\n')[1].split('\n  g2:')[0];
    const g2 = ORCHESTRATOR.split('\n  g2:\n')[1].split('\n  g4-backup:')[0];
    const g7 = ORCHESTRATOR.split('\n  g7:\n')[1].split('\n  postcheck:')[0];
    expect(g2).toContain('needs: admission');
    expect(admission).not.toContain('needs: g2');
    expect(admission).toContain('name: production-db-g3-evidence-${{ steps.g3-source.outputs.g3_head_sha }}-${{ inputs.g3_run_id }}');
    expect(admission).toContain('run-id: ${{ inputs.g3_run_id }}');
    expect(admission).toContain('buildProductionDbTestEvidence({ plan, rawRunEvidence:');
    expect(admission).toContain('testEvidence.sourceRunAttempt !== sourceRun.attempt');
    expect(g2).toContain('release_ledger_binding: ${{ needs.admission.outputs.g3_ledger_binding }}');
    expect(g7).toContain('release_ledger_binding: ${{ needs.admission.outputs.g3_ledger_binding }}');
    expect(OBSERVER_WORKFLOW).toContain('permissions:\n  contents: read\n');
    expect(OBSERVER_WORKFLOW).not.toContain('actions: read');
    expect(OBSERVER_WORKFLOW.split('  workflow_dispatch:')[1].split('  workflow_call:')[0]).not.toContain('release_ledger_binding');
    expect(OBSERVER_WORKFLOW).toContain('binding_args=(--release-ledger-binding "$RUNNER_TEMP/release-ledger-binding.json" --release-phase "$RELEASE_PHASE")');
    expect(OBSERVER_WORKFLOW).toContain('"${binding_args[@]}"');
  });
});

// Captured metadata subset: complete fixed closure, no business data or release authority.
const capturedFixture = JSON.parse(readFileSync('tests/fixtures/production-db-original8-catalog.755.json', 'utf8'));
function hydrateCaptured(value: any): any {
  if (Array.isArray(value)) return value.map(hydrateCaptured);
  if (value && typeof value === 'object') {
    if (value.fixtureRef) return hydrateCaptured(capturedFixture.sharedMetadata[value.fixtureRef]);
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, hydrateCaptured(item)]));
  }
  return value;
}
// #755 original-eight 範圍已釋出（execute run 38905178422）；此 repoRoot 以釋出前 fixture 取代 ledger alias map，其餘檔案沿用 main。
function preReleaseRepoRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pre755-root-'));
  mkdirSync(join(root, 'supabase'), {recursive: true});
  symlinkSync(resolve('supabase/migrations'), join(root, 'supabase/migrations'));
  symlinkSync(resolve('supabase/production-db-impact-manifest.json'), join(root, 'supabase/production-db-impact-manifest.json'));
  writeFileSync(join(root, 'supabase/ledger-alias-map.json'), readFileSync('tests/fixtures/ledger-alias-map.pre-755-original8.json'));
  return root;
}
function scopedCapturedInput(): any {
  const fixture = hydrateCaptured(capturedFixture);
  const plan = fixture.plan;
  const input: any = {repoRoot: preReleaseRepoRoot(), plan, impactManifest: JSON.parse(readFileSync('supabase/production-db-impact-manifest.json', 'utf8')), now: '2026-10-12T15:56:00Z', releaseCatalog: {...fixture.packets, binding: fixture.binding}};
  for (const [environment, capture] of Object.entries(input.releaseCatalog) as any) {
    if (environment === 'binding') continue;
    Object.assign(capture, {projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh' : environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac', observedAt: '2026-10-12T15:55:08Z'});
  }
  resealCaptured(input);
  return input;
}
// #755 original-eight 範圍已釋出（execute run 38905178422）；此 fixture 保存釋出前的 ledger 狀態（8 筆 PENDING_APPLY）。
function resealCaptured(i: any) {
  const snapshots: any = {};
  for (const environment of ['LOCAL_EXPECTED', 'TEST', 'PRODUCTION']) {
    const c = i.releaseCatalog[environment];
    c.raw.metadata.counts = null;
    const snapshot = buildObserverSnapshotFromRaw({environment, projectRef: c.projectRef, observedAt: c.observedAt, observedMainSha: i.plan.mainSha, evidenceRef: environment === 'LOCAL_EXPECTED' ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`, raw: c.raw});
    snapshots[environment] = snapshot;
    i.releaseCatalog[environment] = buildReleaseCatalogCapture({snapshot, raw: c.raw, catalog: c.catalog});
  }
  i.report = compareObserverSnapshots({expectedSnapshot: snapshots.LOCAL_EXPECTED, testSnapshot: snapshots.TEST, productionSnapshot: snapshots.PRODUCTION, currentMainSha: i.plan.mainSha, now: i.now, releaseLedgerBinding: i.releaseCatalog.binding, aliasMap: JSON.parse(readFileSync('tests/fixtures/ledger-alias-map.pre-755-original8.json', 'utf8')), readCanonicalSql: (path: string) => readFileSync(path, 'utf8')});
}
function capturedMetadata(i: any, key: string, surface: string) { return i.releaseCatalog.TEST.raw.metadata.items.find((x: any) => x.key === key && x.surface === surface); }
function capturedRoutine(i: any, name: string, mutate: (r: any) => void) {
 const c = i.releaseCatalog.TEST, r = c.catalog.routines.find((r: any) => r.name === `public.${name}`);
 mutate(r);
 c.raw.metadata.items.find((x: any) => x.surface === 'routines' && x.key === `${r.name}(${r.args})`).value = `f|${r.volatility}|${r.securityDefiner}|${(r.config ?? []).join(',')}|${createHash('md5').update(r.definition).digest('hex')}`;
}
describe('#755 complete captured original-eight closure', () => {
 it('verifies source-attributed scoped consistency while retaining raw drift failure', () => {
  const input = scopedCapturedInput();
  expect(input.report.status).toBe('DRIFT_BLOCKED');
  expect(assembleProductionDbConsistencyEvidence(input)).toMatchObject({status: 'CONSISTENCY_VERIFIED', databaseMutationAuthorized: false});
 });
const mutations: [string, (i: any) => void, RegExp][] = [
 ['return_shape',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('RETURNS boolean','RETURNS text')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['language',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('LANGUAGE plpgsql','LANGUAGE sql')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['strict',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql\n STRICT')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['leakproof',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql\n LEAKPROOF')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['parallel',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('LANGUAGE plpgsql','LANGUAGE plpgsql\n PARALLEL SAFE')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['argument_default',i=>capturedRoutine(i,'guide_staff_interval_available',(r: any) =>r.definition=r.definition.replace('p_end timestamp with time zone)','p_end timestamp with time zone DEFAULT NULL::timestamp with time zone)')),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['body',i=>capturedRoutine(i,'create_tour_order',(r: any) =>{const old=r.body;r.body+='\n-- altered body';r.definition=r.definition.replace(old,r.body)}),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['nested_helper',i=>capturedRoutine(i,'is_tenant_member',(r: any) =>{const old=r.body;r.body=r.body.replace('tenant_users','customers');r.definition=r.definition.replace(old,r.body)}),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['planned_trigger_helper',i=>capturedRoutine(i,'set_updated_at',(r: any) =>{const old=r.body;r.body+='\n-- altered body';r.definition=r.definition.replace(old,r.body)}),/RELEASE_ROUTINE_SOURCE_MISMATCH/],
 ['rls_predicate',i=>capturedMetadata(i,'public.trip_departure_staff.p_trip_departure_staff_s','policies').value='true|r|public|true|',/RELEASE_RLS_PREDICATE_MISMATCH/],
 ['app_grant',i=>i.releaseCatalog.TEST.raw.acl.tables.find((t: any) =>t.name==='tour_orders').privileges.find((p: any) =>p.grantee==='anon'&&p.privilege==='TRIGGER').grantable=true,/RELEASE_APP_GRANT_MISMATCH/],
 ['fk_target',i=>{const fk=i.releaseCatalog.TEST.catalog.foreignKeys.find((f: any) =>f.table==='public.tour_orders'&&f.columns.includes('customer_id'));fk.definition=fk.definition.replace('customers','staff');fk.target='public.staff';capturedMetadata(i,`${fk.table}.${fk.name}`,'constraints').value=`f|${fk.definition}`;},/RELEASE_FK_SOURCE_MISMATCH/],
 ['missing_fk',i=>{const c=i.releaseCatalog.TEST,fk=c.catalog.foreignKeys.find((f: any) =>f.table==='public.tour_orders'&&f.columns.includes('customer_id'));c.catalog.foreignKeys=c.catalog.foreignKeys.filter((f: any) =>f!==fk);c.raw.metadata.items=c.raw.metadata.items.filter((x: any) =>x.key!==`${fk.table}.${fk.name}`)},/RELEASE_EXPECTED_CONTRACT_MISSING/],
 ['paid_default',i=>{capturedMetadata(i,'public.tour_orders.paid_amount','columns').value='numeric|true|1';i.releaseCatalog.TEST.catalog.defaults.find((x: any) =>x.table==='public.tour_orders'&&x.column==='paid_amount').expression='1'},/RELEASE_DEPENDENCY_COLUMN_MISMATCH/],
 ['legacy_check',i=>capturedMetadata(i,'public.tour_orders.tour_orders_balance_due_nonnegative_check','constraints').value='c|CHECK (balance_due >= 10::numeric)',/RELEASE_WRITE_CONSTRAINT_UNEXPLAINED/],
 ['json_null_key_default',i=>{capturedMetadata(i,'public.tour_orders.cancellation_policy_snapshot','columns').value="jsonb|true|jsonb_build_object(NULL, 'bad')";i.releaseCatalog.TEST.catalog.defaults.find((x: any) =>x.table==='public.tour_orders'&&x.column==='cancellation_policy_snapshot').expression="jsonb_build_object(NULL, 'bad')"},/RELEASE_INSERT_DEFAULT_UNEXPLAINED/],
 ['enum_label',i=>i.releaseCatalog.TEST.catalog.enums.find((e: any) =>e.name==='tour_payment_status').labels.push('UNKNOWN'),/RELEASE_ENUM_MISMATCH/],
 ['write_trigger',i=>i.releaseCatalog.TEST.raw.metadata.items.push({surface:'triggers',key:'public.tour_orders.forged_write_trigger',value:'O|CREATE TRIGGER forged_write_trigger BEFORE INSERT ON tour_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at()'}),/RELEASE_WRITE_TRIGGER_MISMATCH/],
 ['write_unique_index',i=>i.releaseCatalog.TEST.raw.metadata.items.push({surface:'indexes',key:'public.tour_orders.forged_unique',value:'CREATE UNIQUE INDEX forged_unique ON public.tour_orders USING btree (party_size)'}),/RELEASE_UNIQUE_INDEX_UNEXPLAINED/],
 ['write_expression_index',i=>i.releaseCatalog.TEST.raw.metadata.items.push({surface:'indexes',key:'public.tour_orders.forged_expression',value:'CREATE INDEX forged_expression ON public.tour_orders USING btree (public.evil(party_size))'}),/RELEASE_INDEX_EXPRESSION_UNEXPLAINED/],
 ['platform_auth_header',i=>i.releaseCatalog.TEST.catalog.routines.find((r: any) =>r.name==='auth.uid').definition=i.releaseCatalog.TEST.catalog.routines.find((r: any) =>r.name==='auth.uid').definition.replace('RETURNS uuid','RETURNS text'),/RELEASE_AUTH_UID_MISMATCH/],
];

 it.each(mutations)('rejects resealed %s in a valid complete capture', (_name, mutate, expected) => {
  const input = scopedCapturedInput();
  mutate(input);
  resealCaptured(input);
  expect(() => assembleProductionDbConsistencyEvidence(input)).toThrow(expected);
 });
});
