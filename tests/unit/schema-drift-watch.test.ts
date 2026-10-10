import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READ_ONLY_SNAPSHOT_SQL, buildObserverSnapshotFromRaw, buildUnavailableSnapshot,
  captureEnvironmentSnapshot, compareObserverSnapshots, normalizeObserverSnapshot,
  verifyTestBaseline0098Binding,
} from '../../scripts/agents/schema-drift-watch.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import { sha256 } from '../../scripts/agents/schema-truth-evidence.mjs';
const MAIN = 'a'.repeat(40);
const raw = (value = 'uuid|false|') => ({
  metadata: { counts: { columns: 1, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [{ surface: 'columns', key: 'public.tours.id', value }] },
  acl: { tables: [{ schema: 'public', name: 'tours', rowSecurity: true, forceRowSecurity: false, policyCount: 0, privileges: [{ grantee: 'authenticated', privilege: 'SELECT', grantable: false }] }], functions: [] },
  ledger: [{ version: '0105', name: '0105_previous_migration' }, { version: '0106', name: '0106_deduplicate_redundant_indexes' }],
});
const rawWithoutColumn = () => ({ ...raw(), metadata: { counts: { columns: 0, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [] }, ledger: [{ version: '0105', name: '0105_previous_migration' }] });
const expected = () => buildObserverSnapshotFromRaw({ environment: 'LOCAL_EXPECTED', projectRef: 'local-fresh', observedAt: '2026-09-14T01:17:00Z', observedMainSha: MAIN, evidenceRef: 'local:fresh-install', raw: raw() });
const remote = (environment: 'TEST' | 'PRODUCTION', value = 'uuid|false|') => buildObserverSnapshotFromRaw({ environment, projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac', observedAt: '2026-09-14T01:18:00Z', observedMainSha: MAIN, evidenceRef: `supabase:${environment.toLowerCase()}/schema-observer`, raw: raw(value) });
const remoteMissing = (environment: 'TEST' | 'PRODUCTION') => buildObserverSnapshotFromRaw({ environment, projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac', observedAt: '2026-09-14T01:18:00Z', observedMainSha: MAIN, evidenceRef: `supabase:${environment.toLowerCase()}/schema-observer`, raw: rawWithoutColumn() });
const NOW = Date.parse('2026-09-14T02:00:00Z');
const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const WORKFLOW = readFileSync(join(ROOT, '.github/workflows/agent-schema-drift-watch.yml'), 'utf8');
const RETAIN = 'Preserve sanitized normalized schema snapshots';
function workflowStep(name: string, source = WORKFLOW) {
  const block = source.split(`      - name: ${name}\n`)[1]?.split(/^      - /m)[0];
  expect(block, `workflow step ${name}`).toBeDefined();
  return block!;
}
function executeStep(name: string, dir: string, source = WORKFLOW) {
  const shell = workflowStep(name, source).split('        run: |\n')[1].split('\n').map((line) => line.slice(10)).join('\n');
  return spawnSync('bash', ['-e', '-o', 'pipefail', '-c', shell], {
    cwd: ROOT, encoding: 'utf8', timeout: 10_000,
    env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, NODE_ENV: 'test', RUNNER_TEMP: dir, EXPECTED_MAIN_SHA: MAIN },
  });
}
function withSnapshots(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'schema-retention-'));
  try {
    for (const [name, packet] of [['expected', expected()], ['test', remote('TEST')], ['production', remote('PRODUCTION')]] as const) {
      // The executable compare uses current time; rehash rather than editing the capture timestamp.
      const environment = packet.environment;
      const fresh = buildObserverSnapshotFromRaw({ environment, projectRef: packet.projectRef,
        observedAt: new Date().toISOString(), observedMainSha: MAIN, evidenceRef: packet.evidenceRef, raw: raw() });
      writeFileSync(join(dir, `${name}.json`), JSON.stringify(fresh));
    }
    run(dir);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}
const saved = (dir: string, name: string) => JSON.parse(readFileSync(join(dir, 'schema-snapshots', `${name}.json`), 'utf8'));
describe('schema drift watch', () => {
  it('hashes one captured metadata contract without retaining raw definitions', () => {
    const snapshot = expected();
    expect(snapshot).toMatchObject({ schemaVersion: 2, status: 'CAPTURED', environment: 'LOCAL_EXPECTED' });
    expect(snapshot.surfaces.columns.items[0]).toMatchObject({ key: 'public.tours.id', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(snapshot)).not.toContain('uuid|false|');
    expect(READ_ONLY_SNAPSHOT_SQL).toContain('pg_attribute');
    expect(READ_ONLY_SNAPSHOT_SQL).toContain('supabase_migrations.schema_migrations');
    expect(READ_ONLY_SNAPSHOT_SQL).not.toMatch(/from\s+public\.(?:customers|bookings|tenants)\b/i);
  });
  it('round-trips ACL identities whose names differ by a suffix', () => {
    const value: any = raw();
    value.acl.functions = [
      { schema: 'public', name: 'consume_push_quota', identityArguments: 'p_tenant uuid', owner: 'postgres', securityDefiner: true, privileges: [] },
      { schema: 'public', name: 'consume_push_quota_17', identityArguments: 'p_tenant uuid', owner: 'postgres', securityDefiner: true, privileges: [] },
    ];
    const snapshot = buildObserverSnapshotFromRaw({
      environment: 'TEST', projectRef: 'nmwhwngojosmagjuvxol', observedAt: '2026-09-14T01:18:00Z',
      observedMainSha: MAIN, evidenceRef: 'supabase:test/schema-observer', raw: value,
    });
    expect((normalizeObserverSnapshot(snapshot, MAIN) as any).captureDigest).toEqual(snapshot.captureDigest);
  });
  it('reports exact three-way match and never grants write authority', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: NOW });
    expect(result).toMatchObject({ status: 'MATCH', differenceCount: 0, safety: { fullEnvironmentParityProven: false, authorizesDatabaseWrite: false, rawDataIncluded: false } });
  });
  it('lists an unapproved object-level difference as DRIFT_BLOCKED', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST', 'text|false|'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: NOW });
    expect(result.status).toBe('DRIFT_BLOCKED');
    expect(result.differences).toEqual(expect.arrayContaining([expect.objectContaining({ environment: 'TEST', surface: 'columns', objectKey: 'public.tours.id', expectedFingerprint: expect.any(String), observedFingerprint: expect.any(String), exception: null })]));
  });
  it('classifies a missing current-main object as pending rollout, not definition drift', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remoteMissing('TEST'), productionSnapshot: remoteMissing('PRODUCTION'), currentMainSha: MAIN, now: NOW });
    expect(result).toMatchObject({ status: 'EXPECTED_PENDING_TEST', environmentStatuses: { TEST: 'EXPECTED_PENDING_TEST', PRODUCTION: 'EXPECTED_PENDING_TEST' } });
    expect(result.differences).toEqual(expect.arrayContaining([expect.objectContaining({ surface: 'columns', expectedFingerprint: expect.any(String), observedFingerprint: null, classification: 'EXPECTED_PENDING_TEST' })]));
  });
  it('classifies Production as pending only after TEST has the expected object', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remoteMissing('PRODUCTION'), currentMainSha: MAIN, now: NOW });
    expect(result).toMatchObject({ status: 'EXPECTED_PENDING_PRODUCTION', environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'EXPECTED_PENDING_PRODUCTION' } });
  });
  it('accepts only an exact, unexpired, environment-bound exception', () => {
    const goodExpected = expected();
    const changedTest = remote('TEST', 'text|false|');
    const fingerprint = changedTest.surfaces.columns.items[0].fingerprint;
    const exception: any = { classification: 'INTENTIONAL_DIFFERENCE', environment: 'TEST', surface: 'columns', objectKey: 'public.tours.id', expectedFingerprint: goodExpected.surfaces.columns.items[0].fingerprint, observedFingerprint: fingerprint, issue: '#396', reason: 'bounded reconciliation', expiresAt: '2026-09-15T00:00:00Z' };
    const result = compareObserverSnapshots({ expectedSnapshot: goodExpected, testSnapshot: changedTest, productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: NOW, exceptions: [exception] as any });
    expect(result).toMatchObject({ status: 'INTENTIONAL_DIFFERENCE', differenceCount: 1, exceptionSummary: { matched: 1, expired: 0, unmatched: 0 } });
  });
  it('preserves mixed per-environment classifications in the report', () => {
    const goodExpected = expected();
    const changedProduction = remote('PRODUCTION', 'text|false|');
    const exception: any = { classification: 'INTENTIONAL_DIFFERENCE', environment: 'PRODUCTION', surface: 'columns', objectKey: 'public.tours.id', expectedFingerprint: goodExpected.surfaces.columns.items[0].fingerprint, observedFingerprint: changedProduction.surfaces.columns.items[0].fingerprint, issue: '#396', reason: 'bounded reconciliation', expiresAt: '2026-09-15T00:00:00Z' };
    const result = compareObserverSnapshots({ expectedSnapshot: goodExpected, testSnapshot: remoteMissing('TEST'), productionSnapshot: changedProduction, currentMainSha: MAIN, now: NOW, exceptions: [exception] as any });
    expect(result).toMatchObject({ status: 'INTENTIONAL_DIFFERENCE', environmentStatuses: { TEST: 'EXPECTED_PENDING_TEST', PRODUCTION: 'INTENTIONAL_DIFFERENCE' } });
  });
  it('blocks expired or orphaned exceptions instead of treating them as approval', () => {
    const exception = { classification: 'INTENTIONAL_DIFFERENCE', environment: 'TEST', surface: 'columns', objectKey: 'public.unknown.value', expectedFingerprint: '0'.repeat(64), observedFingerprint: null, issue: '#396', reason: 'stale', expiresAt: '2026-09-13T00:00:00Z' };
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: NOW, exceptions: [exception] as any });
    expect(result).toMatchObject({ status: 'DRIFT_BLOCKED', differenceCount: 0, exceptionSummary: { expired: 1 } });
  });
  it('rejects stale captured packets as unavailable evidence', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: Date.parse('2026-09-14T03:00:00Z'), maxEvidenceAgeMinutes: 60 });
    expect(result).toMatchObject({ status: 'EVIDENCE_UNAVAILABLE', evidence: { status: 'EVIDENCE_UNAVAILABLE', reason: 'EVIDENCE_STALE' } });
  });
  it('keeps missing token, missing ledger, stale capture, and raw fields non-green', async () => {
    const missingToken = await captureEnvironmentSnapshot({ environment: 'TEST', currentMainSha: MAIN, token: '', fetchImpl: () => { throw new Error('must not call remote'); } });
    expect(missingToken.status).toBe('EVIDENCE_UNAVAILABLE');
    const unavailable = buildUnavailableSnapshot({ environment: 'PRODUCTION', observedMainSha: MAIN, reason: 'MIGRATION_LEDGER_UNAVAILABLE' });
    expect(compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: unavailable, currentMainSha: MAIN, now: NOW }).status).toBe('EVIDENCE_UNAVAILABLE');
    expect(() => buildObserverSnapshotFromRaw({ environment: 'TEST', projectRef: 'nmwhwngojosmagjuvxol', observedAt: '2026-09-14T01:18:00Z', observedMainSha: MAIN, evidenceRef: 'supabase:test/schema-observer', raw: { ...raw(), ledger: [] } })).toThrow(/MIGRATION_LEDGER_UNAVAILABLE/);
    expect(() => normalizeObserverSnapshot({ ...expected(), observedMainSha: 'b'.repeat(40) }, MAIN)).toThrow(/STALE_MAIN_SHA/);
    expect(() => normalizeObserverSnapshot({ ...expected(), rawRows: [] }, MAIN)).toThrow(/UNKNOWN_OR_MISSING_FIELD/);
  });
  it('uses only the read-only endpoint and returns a normalized packet shape', async () => {
    let request: { url: string; authorization: string; query: string } | null = null;
    const captured = await captureEnvironmentSnapshot({ environment: 'PRODUCTION', currentMainSha: MAIN, token: 'observer-read-only', fetchImpl: (async (url: string, init: RequestInit) => {
      request = { url, authorization: String((init.headers as Record<string, string>).authorization), query: JSON.parse(String(init.body)).query };
      return { ok: true, json: async () => [{ snapshot: raw() }] };
    }) as any });
    expect(captured.status).toBe('CAPTURED');
    expect(request).toMatchObject({ url: 'https://api.supabase.com/v1/projects/egehnijjpgijmccagxac/database/query/read-only', authorization: 'Bearer observer-read-only' });
    expect((request as any)?.query).toBe(READ_ONLY_SNAPSHOT_SQL);
  });
});

describe('schema observer workflow snapshot retention', () => {
  it.each(['MATCH', 'DRIFT_BLOCKED'])('retains normalized full packets after compare %s without changing its outcome', (status) => withSnapshots((dir) => {
    if (status === 'DRIFT_BLOCKED') writeFileSync(join(dir, 'test.json'), JSON.stringify(buildObserverSnapshotFromRaw({
      environment: 'TEST', projectRef: 'nmwhwngojosmagjuvxol', observedAt: new Date().toISOString(),
      observedMainSha: MAIN, evidenceRef: 'supabase:test/schema-observer', raw: raw('text|false|'),
    })));
    for (const name of ['local-raw.json', 'local-supabase-status.json', '.env']) writeFileSync(join(dir, name), 'secret-fixture');
    const comparison = executeStep('Compare exact object fingerprints and fail closed', dir);
    expect(comparison.status, comparison.stderr).toBe(status === 'MATCH' ? 0 : 2);
    const report = readFileSync(join(dir, 'report.json'), 'utf8');
    expect(JSON.parse(report)).toMatchObject({ status, safety: { authorizesDatabaseWrite: false, fullEnvironmentParityProven: false } });
    expect(executeStep(RETAIN, dir).status).toBe(0);
    expect(readFileSync(join(dir, 'report.json'), 'utf8')).toBe(report);
    expect(readdirSync(join(dir, 'schema-snapshots')).sort()).toEqual(['expected.json', 'production.json', 'test.json']);
    for (const name of ['expected', 'test', 'production']) {
      const packet = saved(dir, name);
      expect(packet).toEqual(normalizeObserverSnapshot(JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')), MAIN));
      expect(packet.migrationLedger.identities).toHaveLength(2);
      expect(packet.acl.items).toEqual([expect.objectContaining({ key: 'table:public.tours', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
      expect(JSON.stringify(packet)).not.toMatch(/secret-fixture|uuid\|false\||rowSecurity|privileges/);
    }
    for (const name of [RETAIN, 'Upload sanitized schema snapshots']) expect(workflowStep(name)).toContain('if: ${{ always() }}');
    const upload = workflowStep('Upload sanitized schema snapshots');
    expect(upload.match(/\$\{\{ runner.temp \}\}\/[^\s]+/g)).toEqual(['${{ runner.temp }}/schema-snapshots/expected.json', '${{ runner.temp }}/schema-snapshots/test.json', '${{ runner.temp }}/schema-snapshots/production.json']);
    expect(upload).not.toContain('*');
    expect(workflowStep('Upload sanitized drift report')).toContain('path: ${{ runner.temp }}/report.json');
  }));

  it('preserves unavailable evidence and marks a missing fixed snapshot explicitly', () => withSnapshots((dir) => {
    rmSync(join(dir, 'test.json'));
    const unavailable = buildUnavailableSnapshot({ environment: 'PRODUCTION', observedMainSha: MAIN, reason: 'MIGRATION_LEDGER_UNAVAILABLE' });
    writeFileSync(join(dir, 'production.json'), JSON.stringify(unavailable));
    expect(executeStep(RETAIN, dir).status).toBe(0);
    expect(saved(dir, 'production')).toEqual(unavailable);
    expect(saved(dir, 'test')).toMatchObject({ status: 'EVIDENCE_UNAVAILABLE', environment: 'TEST', reason: 'SNAPSHOT_MISSING' });
    expect(saved(dir, 'test')).not.toHaveProperty('migrationLedger');
  }));

  it.each(['wrong SHA', 'wrong role', 'wrong environment', 'wrong project', 'raw definition', 'raw ACL', 'secret field', 'malformed JSON', 'wrong digest'])('withholds %s payloads', (fault) => withSnapshots((dir) => {
    const packet: any = JSON.parse(readFileSync(join(dir, 'expected.json'), 'utf8'));
    if (fault === 'wrong SHA') packet.observedMainSha = 'b'.repeat(40);
    if (fault === 'wrong role') Object.assign(packet, remote('TEST'));
    if (fault === 'wrong environment') packet.environment = 'OTHER';
    if (fault === 'wrong project') packet.projectRef = 'wrong-project';
    if (fault === 'raw definition') packet.surfaces.columns.items[0].definition = 'secret-fixture';
    if (fault === 'raw ACL') packet.acl.items[0].privileges = ['secret-fixture'];
    if (fault === 'secret field') packet.token = 'secret-fixture';
    if (fault === 'wrong digest') packet.captureDigest.value = '0'.repeat(64);
    writeFileSync(join(dir, 'expected.json'), fault === 'malformed JSON' ? '{secret-fixture' : JSON.stringify(packet));
    expect(executeStep(RETAIN, dir).status).toBe(0);
    expect(saved(dir, 'expected')).toMatchObject({ status: 'EVIDENCE_UNAVAILABLE', environment: 'LOCAL_EXPECTED', reason: 'SNAPSHOT_INVALID' });
    expect(JSON.stringify(saved(dir, 'expected'))).not.toContain('secret-fixture');
    expect(saved(dir, 'test').status).toBe('CAPTURED');
    expect(saved(dir, 'production').status).toBe('CAPTURED');
  }));

  it('detects unsafe retention when the inline normalizer is removed', () => withSnapshots((dir) => {
    const packet = { ...expected(), rawRows: [{ token: 'secret-fixture' }] };
    writeFileSync(join(dir, 'expected.json'), JSON.stringify(packet));
    expect(executeStep(RETAIN, dir).status).toBe(0);
    expect(saved(dir, 'expected').status).toBe('EVIDENCE_UNAVAILABLE');
    const mutant = WORKFLOW.replace('normalizeObserverSnapshot(JSON.parse(readFileSync(input, \'utf8\')), process.env.EXPECTED_MAIN_SHA)', 'JSON.parse(readFileSync(input, \'utf8\'))');
    expect(mutant).not.toBe(WORKFLOW);
    expect(executeStep(RETAIN, dir, mutant).status).toBe(0);
    expect(saved(dir, 'expected').rawRows).toEqual([{ token: 'secret-fixture' }]);
  }));
});

// Synthetic read-only consumer cases. Historical provenance is a receipt claim;
// fresh observer packets deliberately retain version/name only.
const B0098 = '0098_reconcile_tour_orders_legacy_contact_columns';
const B0098_HASH = 'f0bd13dcf2226143d90dc1ca3431df7a3020e3d3f9eabd446b640b03261193e5';
const HISTORICAL = 'a7368f05c4f8c3c6e2901b2387139b90e2ef3ef2';
function baselineFixture() {
  const readSourceAt = (_sha: string, path: string) => readFileSync(join(ROOT, path), 'utf8');
  const baseline: any = {
    receipt: { schemaVersion: 1, status: 'TEST_BASELINE_0098_VERIFIED', repository: 'smallwei0301/vibeaico-admin-rebuild',
      testProjectRef: 'nmwhwngojosmagjuvxol', mainSha: HISTORICAL, sourceRunId: '38025747318', sourceRunAttempt: 1,
      migration: { repoFile: B0098, sha256: B0098_HASH, ledger: { version: '0098', name: B0098,
        created_by: 'vibeaico-test-baseline-0098', idempotency_key: `test-baseline-0098:${B0098_HASH}` } },
      columnFingerprints: { before: 'b'.repeat(64), after: 'c'.repeat(64) },
      testMutationPerformed: true, productionMutationPerformed: false, databaseMutationAuthorized: false },
    sourceRun: { repository: 'smallwei0301/vibeaico-admin-rebuild', workflowPath: '.github/workflows/ci.yml', event: 'workflow_dispatch',
      branch: 'main', headSha: HISTORICAL, id: '38025747318', attempt: 1, status: 'completed', conclusion: 'success',
      baselineStep: 'success', integrationStep: 'success', e2eStep: 'success' },
    artifact: { id: '11659019044', name: `test-baseline-0098-evidence-${HISTORICAL}-38025747318`,
      runId: '38025747318', headSha: HISTORICAL, expired: false },
  };
  const sourceOptions = { currentMainSha: MAIN, readSourceAt, isAncestor: () => true };
  const aliasMap = { schemaVersion: 1, entries: [{ repoFile: '0136_issue_755_create_tour_order_invoker', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY' }] };
  const readCanonicalSql = (path: string) => readFileSync(join(ROOT, path), 'utf8');
  const plan = buildProductionDbReleasePlan({ releaseId: 'issue755-baseline-consumer-fixture', mainSha: MAIN,
    plannedAt: '2026-09-14T01:00:00Z', aliasMap, readCanonicalSql });
  const migration = plan.migrations[0];
  const sourceRun = { repository: plan.repository, workflowPath: '.github/workflows/ci.yml', event: 'workflow_dispatch', branch: 'main',
    headSha: MAIN, id: '123', attempt: 1, status: 'completed', conclusion: 'success' };
  const common = { repository: plan.repository, releaseId: plan.releaseId, mainSha: MAIN, planDigest: plan.planDigest,
    testProjectRef: 'nmwhwngojosmagjuvxol', sourceRunId: '123', sourceRunAttempt: 1, databaseMutationAuthorized: false, productionMutationPerformed: false };
  const releaseLedgerBinding: any = { releaseId: plan.releaseId, plan, sourceRun,
    testEvidence: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 1, cleanup: 'PASSED', mainSha: MAIN, planDigest: plan.planDigest,
      testProjectRef: 'nmwhwngojosmagjuvxol', sourceRunId: '123', sourceRunAttempt: 1, integrationStep: 'PASSED', e2eStep: 'PASSED', databaseMutationAuthorized: false },
    releasePlanEvidence: { ...common, status: 'TEST_RELEASE_PLAN_VERIFIED', testMutationPerformed: true,
      migrations: [{ repoFile: migration.repoFile, sha256: migration.sha256, riskTier: migration.riskTier, execution: 'APPLIED_VERIFIED', ledgerVersion: migration.ledgerVersion }] },
    postTestSchemaEvidence: { ...common, status: 'TEST_POST_APPLY_SCHEMA_CAPTURED', readOnly: true, comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED',
      captureDigest: 'c'.repeat(64), migrationLedgerDigest: 'd'.repeat(64), observedAt: '2026-09-14T01:18:00Z', plannedMigrations: [{ repoFile: migration.repoFile, ledgerVersion: migration.ledgerVersion }] },
    testBaseline0098: verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions }),
  };
  const packet = (environment: 'LOCAL_EXPECTED' | 'TEST' | 'PRODUCTION', ledger: any[], value = 'uuid|false|') => buildObserverSnapshotFromRaw({
    environment, projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh' : environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedMainSha: MAIN, observedAt: '2026-09-14T01:18:00Z', evidenceRef: 'local:baseline-consumer-fixture', raw: { ...raw(value), ledger } });
  const previous = { version: '0105', name: '0105_previous_migration' };
  const canonical = { version: '0098', name: B0098.slice(5) };
  const args: any = { currentMainSha: MAIN, now: NOW, readCanonicalSql, readSourceAt, isAncestor: sourceOptions.isAncestor, aliasMap, releaseLedgerBinding,
    expectedSnapshot: packet('LOCAL_EXPECTED', [previous, canonical, { version: '0136', name: migration.repoFile }]),
    testSnapshot: packet('TEST', [previous, { version: '0098', name: B0098 }, { version: migration.ledgerVersion, name: migration.repoFile }]),
    productionSnapshot: packet('PRODUCTION', [previous, canonical]) };
  return { args, baseline, sourceOptions, packet, previous, canonical };
}

describe('#755 separately verified historical TEST 0098 comparison binding', () => {
  it('independently reads real historical Git source and ancestry, while consumer-only source changes remain irrelevant', () => {
    const { baseline, sourceOptions } = baselineFixture();
    const verified = verifyTestBaseline0098Binding({ binding: baseline, currentMainSha: HISTORICAL });
    expect(verified.sourceEvidence).toMatchObject({ historicalMainSha: HISTORICAL, currentMainSha: HISTORICAL,
      ancestorVerified: true, canonicalSqlSha256: B0098_HASH });
    expect(verified.sourceEvidence.producerBlobs.map((blob: any) => blob.path)).not.toContain('.github/workflows/production-db-release-orchestrator.yml');
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions, readSourceAt: (head: string, path: string) =>
      sourceOptions.readSourceAt(head, path) + (head === MAIN && ['.github/workflows/production-db-release-orchestrator.yml', 'scripts/agents/schema-drift-watch.mjs'].includes(path) ? '\nconsumer change' : '') })).not.toThrow();
  });
  it('maps TEST only and preserves historical source, raw packets, expected and Production views', () => {
    const { args } = baselineFixture();
    const before = structuredClone({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot, binding: args.releaseLedgerBinding });
    const report = compareObserverSnapshots(args);
    if (!('testBaseline0098Mapping' in report) || !report.testBaseline0098Mapping) throw new Error('verified baseline mapping required');
    expect(report.testBaseline0098Mapping).toMatchObject({ environment: 'TEST', sourceMainSha: HISTORICAL, currentMainSha: MAIN,
      sourceRunId: '38025747318', sourceRunAttempt: 1, artifactId: '11659019044', freshLedgerFields: ['version', 'name'],
      observed: { version: '0098', name: B0098 }, canonical: { version: '0098', name: B0098.slice(5) } });
    expect(report.differences).toHaveLength(1);
    expect(report.differences[0]).toMatchObject({ environment: 'PRODUCTION', objectKey: '0136/0136_issue_755_create_tour_order_invoker' });
    expect({ expected: args.expectedSnapshot, test: args.testSnapshot, production: args.productionSnapshot, binding: args.releaseLedgerBinding }).toEqual(before);
    expect(report.environments.expected.captureDigest).toEqual(before.expected.captureDigest);
    expect(report.environments.TEST.migrationLedger).toEqual(before.test.migrationLedger.digest);
    expect(report.environments.PRODUCTION.captureDigest).toEqual(before.production.captureDigest);
    expect(report.safety.authorizesDatabaseWrite).toBe(false);
  });
  it('leaves absence of baseline binding unchanged and never adds 0098 to the plan', () => {
    const { args } = baselineFixture();
    delete args.releaseLedgerBinding.testBaseline0098;
    const planBefore = structuredClone(args.releaseLedgerBinding.plan);
    const report = compareObserverSnapshots(args);
    expect(report.status).toBe('DRIFT_BLOCKED');
    expect(report.differences.filter((d: any) => d.environment === 'TEST' && d.objectKey.startsWith('0098/'))).toHaveLength(2);
    expect(report).not.toHaveProperty('testBaseline0098Mapping');
    expect(args.releaseLedgerBinding.plan).toEqual(planBefore);
    expect(planBefore.migrations.some((m: any) => m.repoFile === B0098)).toBe(false);
  });
  it('does not change any Production classification/status when the baseline makes TEST ledger exact', () => {
    const { args } = baselineFixture();
    const unbound = { ...args.releaseLedgerBinding };
    delete unbound.testBaseline0098;
    const before = compareObserverSnapshots({ ...args, releaseLedgerBinding: unbound });
    const after = compareObserverSnapshots(args);
    if (!('environmentStatuses' in before) || !('environmentStatuses' in after)) throw new Error('captured comparison required');
    expect(before.differences.filter((d: any) => d.environment === 'TEST')).toHaveLength(2);
    expect(after.differences.filter((d: any) => d.environment === 'TEST')).toHaveLength(0);
    expect(after.differences.filter((d: any) => d.environment === 'PRODUCTION')).toEqual(before.differences.filter((d: any) => d.environment === 'PRODUCTION'));
    expect(after.environmentStatuses.PRODUCTION).toBe(before.environmentStatuses.PRODUCTION);
    expect(after.status).toBe('DRIFT_BLOCKED');
  });
  it.each([false, true])('preserves every unrelated TEST row/classification when another ledger is missing (missing object: %s)', (missingObject) => {
    const { args, packet } = baselineFixture();
    const unselected = { version: '0106', name: 'unselected_missing_migration' };
    args.expectedSnapshot = packet('LOCAL_EXPECTED', [...args.expectedSnapshot.migrationLedger.identities, unselected]);
    if (missingObject) args.testSnapshot = buildObserverSnapshotFromRaw({ environment: 'TEST', projectRef: 'nmwhwngojosmagjuvxol',
      observedMainSha: MAIN, observedAt: '2026-09-14T01:18:00Z', evidenceRef: 'local:baseline-consumer-fixture',
      raw: { ...rawWithoutColumn(), ledger: args.testSnapshot.migrationLedger.identities } });
    const unbound = { ...args.releaseLedgerBinding };
    delete unbound.testBaseline0098;
    const before = compareObserverSnapshots({ ...args, releaseLedgerBinding: unbound });
    const after = compareObserverSnapshots(args);
    if (!('environmentStatuses' in before) || !('environmentStatuses' in after)) throw new Error('captured comparison required');
    const residual = before.differences.filter((d: any) => !(d.environment === 'TEST' && d.surface === 'migrationLedger' && d.objectKey.startsWith('0098/')));
    expect(after.differences).toEqual(residual);
    expect(after.differences).toContainEqual(expect.objectContaining({ environment: 'TEST', objectKey: '0106/unselected_missing_migration', classification: null }));
    expect(after.environmentStatuses.TEST).toBe(before.environmentStatuses.TEST);
    expect(after.environmentStatuses.PRODUCTION).toBe(before.environmentStatuses.PRODUCTION);
  });
  it.each(['repository', 'workflowPath', 'event', 'branch', 'headSha', 'id', 'attempt', 'status', 'conclusion', 'baselineStep', 'integrationStep', 'e2eStep'])('rejects wrong run %s', (field) => {
    const { baseline, sourceOptions } = baselineFixture();
    baseline.sourceRun[field] = field === 'attempt' ? 2 : 'wrong';
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow();
  });
  it.each(['id', 'name', 'runId', 'headSha', 'expired'])('rejects invalid artifact %s', (field) => {
    const { baseline, sourceOptions } = baselineFixture();
    baseline.artifact[field] = field === 'expired' ? true : field === 'id' ? '' : 'wrong';
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow();
  });
  it.each(['schemaVersion', 'status', 'repository', 'testProjectRef', 'mainSha', 'sourceRunId', 'sourceRunAttempt', 'testMutationPerformed', 'productionMutationPerformed', 'databaseMutationAuthorized'])('rejects wrong receipt %s', (field) => {
    const { baseline, sourceOptions } = baselineFixture();
    baseline.receipt[field] = typeof baseline.receipt[field] === 'boolean' ? !baseline.receipt[field] : 'wrong';
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow();
  });
  it.each(['version', 'name', 'created_by', 'idempotency_key'])('rejects historical ledger provenance %s', (field) => {
    const { baseline, sourceOptions } = baselineFixture();
    baseline.receipt.migration.ledger[field] = 'wrong';
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow();
  });
  it('rejects changed SQL, changed producer/CI, nonancestor and a forged source evidence digest', () => {
    const { baseline, sourceOptions, args } = baselineFixture();
    baseline.receipt.migration.sha256 = '0'.repeat(64);
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow();
    baseline.receipt.migration.sha256 = B0098_HASH;
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions, isAncestor: () => false })).toThrow(/ANCESTOR/);
    for (const changed of ['supabase/migrations/0098_reconcile_tour_orders_legacy_contact_columns.sql',
      ...args.releaseLedgerBinding.testBaseline0098.sourceEvidence.producerBlobs.map((blob: any) => blob.path)]) {
      expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions, readSourceAt: (head: string, path: string) =>
        sourceOptions.readSourceAt(head, path) + (head === MAIN && path === changed ? '\nchanged' : '') })).toThrow(/SOURCE/);
    }
    args.releaseLedgerBinding.testBaseline0098.sourceEvidence.producerBlobs[0].sha256 = '0'.repeat(64);
    expect(() => compareObserverSnapshots(args)).toThrow(/SOURCE/);
  });
  it('rejects an absent source binding and a changed migration identity instead of silently omitting the baseline', () => {
    const { args, baseline, sourceOptions } = baselineFixture();
    delete args.releaseLedgerBinding.testBaseline0098.sourceEvidence;
    expect(() => compareObserverSnapshots(args)).toThrow(/TEST_BASELINE_BINDING_REQUIRED/);
    baseline.receipt.migration.repoFile = '0098_wrong';
    expect(() => verifyTestBaseline0098Binding({ binding: baseline, ...sourceOptions })).toThrow(/IDENTITY/);
  });
  it.each(['missing', 'duplicate', 'short plus full', 'same version wrong name', 'wrong version'])('rejects ambiguous/missing TEST 0098: %s', (fault) => {
    const { args, packet, previous } = baselineFixture();
    const row = { version: '0098', name: B0098 };
    const ledger = fault === 'missing' ? [] : fault === 'duplicate' ? [row, row] : fault === 'short plus full' ? [row, { ...row, name: B0098.slice(5) }]
      : [{ ...row, ...(fault === 'wrong version' ? { version: '0097' } : { name: 'wrong_name' }) }];
    expect(() => { args.testSnapshot = packet('TEST', [previous, ...ledger]); compareObserverSnapshots(args); }).toThrow();
  });
  it.each(['missing', 'duplicate', 'short plus full', 'same version wrong name', 'full only', 'wrong version'])('rejects ambiguous/missing expected 0098: %s', (fault) => {
    const { args, packet, previous, canonical } = baselineFixture();
    const ledger = fault === 'missing' ? [] : fault === 'duplicate' ? [canonical, canonical] : fault === 'short plus full' ? [canonical, { ...canonical, name: B0098 }]
      : [{ ...canonical, ...(fault === 'wrong version' ? { version: '0097' } : { name: fault === 'full only' ? B0098 : 'wrong_name' }) }];
    expect(() => { args.expectedSnapshot = packet('LOCAL_EXPECTED', [previous, ...ledger]); compareObserverSnapshots(args); }).toThrow();
  });
  it('preserves columns, unrelated TEST names and Production 0098 drift', () => {
    const { args, packet, previous } = baselineFixture();
    const originalReport = compareObserverSnapshots(args);
    const ledger = args.testSnapshot.migrationLedger.identities;
    args.testSnapshot = packet('TEST', [...ledger, { version: '0106', name: '0106_other_full_name' }], 'text|false|');
    args.productionSnapshot = packet('PRODUCTION', [previous, { version: '0098', name: B0098 }]);
    const report = compareObserverSnapshots(args);
    expect(report.status).toBe('DRIFT_BLOCKED');
    expect(report.differences).toEqual(expect.arrayContaining([
      expect.objectContaining({ environment: 'TEST', surface: 'columns' }),
      expect.objectContaining({ environment: 'TEST', objectKey: '0106/0106_other_full_name' }),
      expect.objectContaining({ environment: 'PRODUCTION', objectKey: `0098/${B0098}` }),
      ...originalReport.differences.map(({ classification: _classification, ...difference }: any) => expect.objectContaining(difference)),
    ]));
    if (!('testBaseline0098Mapping' in report) || !report.testBaseline0098Mapping) throw new Error('verified baseline mapping required');
    expect(report.testBaseline0098Mapping.observedFingerprint).toBe(sha256(JSON.stringify({ name: B0098, version: '0098' })));
  });
});
