import { describe, expect, it, vi } from 'vitest';

import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import {
  assertLiveLedgerMatchesAliasMap,
  buildAtomicProductionApplySql,
  runControlledProductionRelease,
} from '../../scripts/db/controlled-production-db-release.mjs';

const MAIN = 'a'.repeat(40);
const NOW = '2026-09-14T12:40:00Z';
const PLANNED_AT = '2026-09-14T12:30:00Z';

function aliasMap() {
  return {
    schemaVersion: 1,
    entries: [
      { repoFile: '0001_base', ledgerNames: ['0001_base'], classification: 'EXACT', evidence: 'x' },
      { repoFile: '0083_source', ledgerNames: ['0082_source'], classification: 'ALIAS', evidence: 'x' },
      { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
    ],
  };
}

const SQL = 'create table if not exists public.guard_447(id uuid primary key);';
const readCanonicalSql = () => SQL;

function plan() {
  return buildProductionDbReleasePlan({
    releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
    aliasMap: aliasMap(), readCanonicalSql,
  });
}

function packet(p: any) {
  const value: any = {
    schemaVersion: 1,
    releaseId: p.releaseId,
    repository: p.repository,
    productionProjectRef: p.productionProjectRef,
    mainSha: p.mainSha,
    planDigest: p.planDigest,
    riskTier: p.riskTier,
    source: { status: 'SOURCE_VERIFIED', mainSha: p.mainSha, planDigest: p.planDigest, databaseMutationAuthorized: false },
    consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T12:35:00Z', mainSha: p.mainSha, planDigest: p.planDigest },
    test: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 8, cleanup: 'PASSED', mainSha: p.mainSha, planDigest: p.planDigest },
    recovery: { status: 'RECOVERY_VERIFIED', backupObservedAt: '2026-09-14T12:20:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z', storageObjectsCovered: false, preimageBackupVerified: false },
    finalRisk: { status: 'ASTRA_APPROVED', requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1', planDigest: p.planDigest, evidenceDigest: '', reviewedAt: '2026-09-14T12:25:00Z', executionRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/999#review', reviewId: 'review-447' },
    data: { paymentFactsTouched: false, batchSize: 100, maxRows: 1000 },
  };
  value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
  return value;
}

function lock(p: any) {
  return {
    status: 'LOCK_VERIFIED', releaseId: p.releaseId, projectRef: p.productionProjectRef,
    planDigest: p.planDigest, acquiredAt: '2026-09-14T12:39:30Z', holder: 'workflow:447/job:apply',
    liveBaselineRechecked: true,
  };
}

const beforeRows = [
  { version: '1', name: '0001_base' },
  { version: '2', name: '0082_source' },
];

describe('Controlled Production DB writer #447', () => {
  it('requires live provider ledger to match the trusted alias map before building mutable SQL', () => {
    expect(assertLiveLedgerMatchesAliasMap({ aliasMap: aliasMap(), liveLedgerRows: beforeRows })).toMatchObject({ status: 'LIVE_LEDGER_VERIFIED' });
    expect(() => assertLiveLedgerMatchesAliasMap({ aliasMap: aliasMap(), liveLedgerRows: [...beforeRows, { version: 'x', name: 'manual_unknown' }] })).toThrow(/LIVE_LEDGER_DRIFT/);
  });

  it('builds one atomic transaction with DB advisory lock, live recheck, exact main SQL and ledger identity', () => {
    const p = plan();
    const sql = buildAtomicProductionApplySql({ plan: p, aliasMap: aliasMap(), liveLedgerRows: beforeRows, readCanonicalSql });
    expect(sql).toContain('pg_try_advisory_xact_lock');
    expect(sql).toContain('PRODUCTION_DB_LIVE_LEDGER_CHANGED_AFTER_LOCK');
    expect(sql).toContain(SQL);
    expect(sql).toContain(p.migrations[0].ledgerVersion);
    expect(sql).toContain("'0109_assertions'");
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });

  it('rejects transaction-unsafe migration commands before any mutable request', () => {
    const p = plan();
    expect(() => buildAtomicProductionApplySql({
      plan: p,
      aliasMap: aliasMap(),
      liveLedgerRows: beforeRows,
      readCanonicalSql: () => 'create index concurrently x_idx on public.x(id);',
    })).toThrow(/MIGRATION_BYTES_MISMATCH|TRANSACTION_UNSAFE_MIGRATION/);
  });

  it('uses read-only ledger → one mutable transaction → read-only ledger, then stops for schema/ACL/RLS postcheck', async () => {
    const p = plan();
    const requests: string[] = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url);
      requests.push(text);
      if (text.endsWith('/database/query/read-only')) {
        const count = requests.filter((item) => item.endsWith('/database/query/read-only')).length;
        return new Response(JSON.stringify(count === 1 ? beforeRows : [...beforeRows, { version: p.migrations[0].ledgerVersion, name: '0109_assertions' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      expect(JSON.parse(String(init?.body)).query).toContain('pg_try_advisory_xact_lock');
      return new Response('[]', { status: 200 });
    });

    const result = await runControlledProductionRelease({
      plan: p, releasePacket: packet(p), lockEvidence: lock(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    });
    expect(result).toMatchObject({ status: 'APPLY_NEEDS_SCHEMA_POSTCHECK', nextRequiredGate: 'G7_SCHEMA_ACL_RLS_READBACK', databaseMutationAuthorized: false });
    expect(requests.filter((item) => item.endsWith('/database/query')).length).toBe(1);
    expect(requests.filter((item) => item.endsWith('/database/query/read-only')).length).toBe(2);
  });

  it('turns any mutable-call uncertainty into APPLY_UNKNOWN and does not blind retry', async () => {
    const p = plan();
    let mutableCalls = 0;
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/database/query/read-only')) return new Response(JSON.stringify(beforeRows), { status: 200, headers: { 'content-type': 'application/json' } });
      mutableCalls += 1;
      throw new Error('connection reset after send');
    });
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: packet(p), lockEvidence: lock(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/APPLY_UNKNOWN/);
    expect(mutableCalls).toBe(1);
  });

  it('rejects packet/plan or lock/release mismatch before a Production write', async () => {
    const p = plan();
    const fetchSpy = vi.fn();
    const badPacket = packet(p); badPacket.planDigest = 'b'.repeat(64);
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: badPacket, lockEvidence: lock(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/RELEASE_PACKET_PLAN_MISMATCH/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
