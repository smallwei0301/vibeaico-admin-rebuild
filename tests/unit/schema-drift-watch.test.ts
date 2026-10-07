import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  READ_ONLY_SNAPSHOT_SQL, buildObserverSnapshotFromRaw, buildUnavailableSnapshot,
  captureEnvironmentSnapshot, compareObserverSnapshots, normalizeObserverSnapshot,
} from '../../scripts/agents/schema-drift-watch.mjs';
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
