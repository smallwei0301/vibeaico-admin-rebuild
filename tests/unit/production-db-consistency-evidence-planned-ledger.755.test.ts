import { describe, expect, it } from 'vitest';
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
function snapshot(environment: 'LOCAL_EXPECTED' | 'TEST' | 'PRODUCTION', missing: string[] = [], names = [MIGRATION]) {
  return buildObserverSnapshotFromRaw({
    environment,
    projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh'
      : environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: NOW, observedMainSha: MAIN,
    evidenceRef: environment === 'LOCAL_EXPECTED' ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`,
    raw: {
      metadata: { counts: { columns: 0, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [] },
      acl: { tables: [], functions: [] },
      ledger: [BASELINE, ...names.filter(name => !missing.includes(name)).map(identity)],
    },
  });
}

function fixture(names = [MIGRATION]) {
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
