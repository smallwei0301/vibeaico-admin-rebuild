import { describe, expect, it } from 'vitest';
import {
  READ_ONLY_SNAPSHOT_SQL, buildObserverSnapshotFromRaw, buildUnavailableSnapshot,
  captureEnvironmentSnapshot, compareObserverSnapshots, normalizeObserverSnapshot,
} from '../../scripts/agents/schema-drift-watch.mjs';
const MAIN = 'a'.repeat(40);
const raw = (value = 'uuid|false|') => ({
  metadata: { counts: { columns: 1, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [{ surface: 'columns', key: 'public.tours.id', value }] },
  acl: { tables: [{ schema: 'public', name: 'tours', rowSecurity: true, forceRowSecurity: false, policyCount: 0, privileges: [{ grantee: 'authenticated', privilege: 'SELECT', grantable: false }] }], functions: [] },
  ledger: [{ version: '0106', name: '0106_deduplicate_redundant_indexes' }],
});
const expected = () => buildObserverSnapshotFromRaw({ environment: 'LOCAL_EXPECTED', projectRef: 'local-fresh', observedAt: '2026-09-14T01:17:00Z', observedMainSha: MAIN, evidenceRef: 'local:fresh-install', raw: raw() });
const remote = (environment: 'TEST' | 'PRODUCTION', value = 'uuid|false|') => buildObserverSnapshotFromRaw({ environment, projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac', observedAt: '2026-09-14T01:18:00Z', observedMainSha: MAIN, evidenceRef: `supabase:${environment.toLowerCase()}/schema-observer`, raw: raw(value) });
describe('schema drift watch', () => {
  it('hashes one captured metadata contract without retaining raw definitions', () => {
    const snapshot = expected();
    expect(snapshot).toMatchObject({ status: 'CAPTURED', environment: 'LOCAL_EXPECTED' });
    expect(snapshot.surfaces.columns.items[0]).toMatchObject({ key: 'public.tours.id', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(JSON.stringify(snapshot)).not.toContain('uuid|false|');
    expect(READ_ONLY_SNAPSHOT_SQL).toContain('pg_attribute');
    expect(READ_ONLY_SNAPSHOT_SQL).toContain('supabase_migrations.schema_migrations');
    expect(READ_ONLY_SNAPSHOT_SQL).not.toMatch(/from\s+public\.(?:customers|bookings|tenants)\b/i);
  });
  it('reports exact three-way match and never grants write authority', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN });
    expect(result).toMatchObject({ status: 'MATCH', differenceCount: 0, safety: { fullEnvironmentParityProven: false, authorizesDatabaseWrite: false, rawDataIncluded: false } });
  });
  it('lists an unapproved object-level difference as DRIFT_BLOCKED', () => {
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST', 'text|false|'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN });
    expect(result.status).toBe('DRIFT_BLOCKED');
    expect(result.differences).toEqual(expect.arrayContaining([expect.objectContaining({ environment: 'TEST', surface: 'columns', objectKey: 'public.tours.id', expectedFingerprint: expect.any(String), observedFingerprint: expect.any(String), exception: null })]));
  });
  it('accepts only an exact, unexpired, environment-bound exception', () => {
    const goodExpected = expected();
    const changedTest = remote('TEST', 'text|false|');
    const fingerprint = changedTest.surfaces.columns.items[0].fingerprint;
    const exception: any = { classification: 'EXPECTED_PENDING_TEST', environment: 'TEST', surface: 'columns', objectKey: 'public.tours.id', expectedFingerprint: goodExpected.surfaces.columns.items[0].fingerprint, observedFingerprint: fingerprint, issue: '#396', reason: 'bounded reconciliation', expiresAt: '2026-09-15T00:00:00Z' };
    const result = compareObserverSnapshots({ expectedSnapshot: goodExpected, testSnapshot: changedTest, productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: Date.parse('2026-09-14T02:00:00Z'), exceptions: [exception] as any });
    expect(result).toMatchObject({ status: 'EXPECTED_PENDING_TEST', differenceCount: 1, exceptionSummary: { matched: 1, expired: 0, unmatched: 0 } });
  });
  it('blocks expired or orphaned exceptions instead of treating them as approval', () => {
    const exception = { classification: 'INTENTIONAL_DIFFERENCE', environment: 'TEST', surface: 'columns', objectKey: 'public.unknown.value', expectedFingerprint: '0'.repeat(64), observedFingerprint: null, issue: '#396', reason: 'stale', expiresAt: '2026-09-13T00:00:00Z' };
    const result = compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: remote('PRODUCTION'), currentMainSha: MAIN, now: Date.parse('2026-09-14T00:00:00Z'), exceptions: [exception] as any });
    expect(result).toMatchObject({ status: 'DRIFT_BLOCKED', differenceCount: 0, exceptionSummary: { expired: 1 } });
  });
  it('keeps missing token, missing ledger, stale capture, and raw fields non-green', async () => {
    const missingToken = await captureEnvironmentSnapshot({ environment: 'TEST', currentMainSha: MAIN, token: '', fetchImpl: () => { throw new Error('must not call remote'); } });
    expect(missingToken.status).toBe('EVIDENCE_UNAVAILABLE');
    const unavailable = buildUnavailableSnapshot({ environment: 'PRODUCTION', observedMainSha: MAIN, reason: 'MIGRATION_LEDGER_UNAVAILABLE' });
    expect(compareObserverSnapshots({ expectedSnapshot: expected(), testSnapshot: remote('TEST'), productionSnapshot: unavailable, currentMainSha: MAIN }).status).toBe('EVIDENCE_UNAVAILABLE');
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
