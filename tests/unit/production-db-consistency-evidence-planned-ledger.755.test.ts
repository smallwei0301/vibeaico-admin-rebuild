import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import { assertLiveLedgerMatchesAliasMap } from '../../scripts/db/controlled-production-db-release.mjs';
import { buildAtomicTestReleaseValidationSql } from '../../scripts/db/validate-production-db-release-on-test.mjs';
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
function snapshot(environment: 'LOCAL_EXPECTED' | 'TEST' | 'PRODUCTION', missing: string[] = [], names = [MIGRATION], ledger?: { version: string; name: string }[]) {
  return buildObserverSnapshotFromRaw({
    environment,
    projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh'
      : environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: NOW, observedMainSha: MAIN,
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

async function runProvenance(patch: Record<string, unknown> = {}) {
  const outputs: Record<string, string> = {};
  const run = { id: 123, repository: { full_name: 'smallwei0301/vibeaico-admin-rebuild' }, name: 'ci', path: '.github/workflows/ci.yml',
    event: 'workflow_dispatch', head_branch: 'main', head_sha: MAIN, run_attempt: 2, status: 'completed', conclusion: 'success', ...patch };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  await new AsyncFunction('github', 'context', 'core', 'process', provenanceScript)(
    { rest: { actions: { getWorkflowRun: async ({ run_id }: { run_id: number }) => { expect(run_id).toBe(123); return { data: run }; } } } },
    { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' } }, { setOutput: (key: string, value: string) => { outputs[key] = value; } },
    { env: { G3_RUN_ID: '123', EXPECTED_MAIN_SHA: MAIN } });
  return JSON.parse(outputs.run);
}

describe('#755 exact trusted G3 workflow wiring', () => {
  it('executes the real provenance step using a completed exact-main run readback', async () => {
    expect(await runProvenance()).toMatchObject({ id: '123', attempt: 2, headSha: MAIN, workflowPath: '.github/workflows/ci.yml' });
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
    expect(admission).toContain('name: production-db-g3-evidence-${{ inputs.expected_main_sha }}-${{ inputs.g3_run_id }}');
    expect(admission).toContain('run-id: ${{ inputs.g3_run_id }}');
    expect(admission).toContain('buildProductionDbTestEvidence({ plan, rawRunEvidence:');
    expect(admission).toContain('testEvidence.sourceRunAttempt !== sourceRun.attempt');
    expect(g2).toContain('release_ledger_binding: ${{ needs.admission.outputs.g3_ledger_binding }}');
    expect(g7).not.toContain('release_ledger_binding');
    expect(OBSERVER_WORKFLOW).toContain('permissions:\n  contents: read\n');
    expect(OBSERVER_WORKFLOW).not.toContain('actions: read');
    expect(OBSERVER_WORKFLOW.split('  workflow_dispatch:')[1].split('  workflow_call:')[0]).not.toContain('release_ledger_binding');
    expect(OBSERVER_WORKFLOW).toContain('binding_args=(--release-ledger-binding "$RUNNER_TEMP/release-ledger-binding.json")');
    expect(OBSERVER_WORKFLOW).toContain('"${binding_args[@]}"');
  });
});
