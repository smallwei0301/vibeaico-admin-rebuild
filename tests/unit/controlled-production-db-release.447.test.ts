import { describe, expect, it, vi } from 'vitest';

import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import {
  assertLiveLedgerMatchesAliasMap,
  buildAtomicProductionApplySql,
  verifyPostApplyLedger,
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

const beforeRows = [
  { version: '1', name: '0001_base' },
  { version: '2', name: '0082_source' },
];

describe('Controlled Production DB writer #447', () => {
  it('requires live provider ledger to match the trusted alias map before building mutable SQL', () => {
    expect(assertLiveLedgerMatchesAliasMap({ aliasMap: aliasMap(), liveLedgerRows: beforeRows })).toMatchObject({ status: 'LIVE_LEDGER_VERIFIED' });
    expect(() => assertLiveLedgerMatchesAliasMap({ aliasMap: aliasMap(), liveLedgerRows: [...beforeRows, { version: 'x', name: 'manual_unknown' }] })).toThrow(/LIVE_LEDGER_DRIFT/);
  });

  it('builds a valid ledger reconciliation for an empty live baseline', () => {
    const emptyAliasMap = {
      schemaVersion: 1,
      entries: [{ repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' }],
    };
    const p = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: emptyAliasMap, readCanonicalSql,
    });
    const sql = buildAtomicProductionApplySql({
      plan: p, aliasMap: emptyAliasMap, liveLedgerRows: [], readCanonicalSql,
    });
    expect(sql).toContain('select null::text as name, null::text as version where false');
  });

  it('uses a non-colliding procedural tag for ledger identity values', () => {
    const dollar = String.fromCharCode(36);
    const collisionName = [dollar, 'ledgercheck', dollar].join('');
    const collisionAliasMap = {
      schemaVersion: 1,
      entries: [
        { repoFile: '0001_base', ledgerNames: [collisionName], classification: 'EXACT', evidence: 'x' },
        { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
      ],
    };
    const p = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: collisionAliasMap, readCanonicalSql,
    });
    const sql = buildAtomicProductionApplySql({
      plan: p, aliasMap: collisionAliasMap,
      liveLedgerRows: [{ version: '1', name: collisionName }], readCanonicalSql,
    });
    expect(sql).toContain('do ' + dollar + 'ledgercheck0' + dollar);
  });

  it('builds one atomic transaction with DB advisory lock before live recheck, exact main SQL and ledger identity', () => {
    const p = plan();
    const sql = buildAtomicProductionApplySql({ plan: p, aliasMap: aliasMap(), liveLedgerRows: beforeRows, readCanonicalSql });
    const lockAt = sql.indexOf('pg_try_advisory_xact_lock');
    const recheckAt = sql.indexOf('PRODUCTION_DB_LIVE_LEDGER_CHANGED_AFTER_LOCK');
    const migrationAt = sql.indexOf(SQL);
    expect(lockAt).toBeGreaterThan(0);
    expect(recheckAt).toBeGreaterThan(lockAt);
    expect(migrationAt).toBeGreaterThan(recheckAt);
    expect(sql).toContain(p.migrations[0].ledgerVersion);
    expect(sql).toContain('m.version = x.version');
    expect(sql).toContain("'0109_assertions'");
    expect(sql.trim().startsWith('begin;')).toBe(true);
    expect(sql.trim().endsWith('commit;')).toBe(true);
  });

  it('keeps arbitrary BACKFILL out of the v1 writer even with row-limit evidence', () => {
    const backfillSql = 'delete from public.guard_447 where id is not null;';
    const backfillPlan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql: () => backfillSql,
    });
    expect(backfillPlan.riskTier).toBe('BACKFILL');

    const backfillPacket = packet(backfillPlan);
    backfillPacket.riskTier = 'BACKFILL';
    backfillPacket.recovery.preimageBackupVerified = true;
    backfillPacket.data.executionBounded = true;
    backfillPacket.data.batchSize = 1;
    backfillPacket.data.maxRows = 1;
    backfillPacket.finalRisk.evidenceDigest = releaseEvidenceDigestOf(backfillPacket);

    expect(() => buildAtomicProductionApplySql({
      plan: backfillPlan, releasePacket: backfillPacket,
      aliasMap: aliasMap(), liveLedgerRows: beforeRows, readCanonicalSql: () => backfillSql,
    })).toThrow(/BACKFILL_EXECUTOR_NOT_ADMITTED/);
  });

  it('rejects transaction-unsafe migration commands before any mutable request', () => {
    const p = plan();
    expect(() => buildAtomicProductionApplySql({
      plan: p,
      aliasMap: aliasMap(),
      liveLedgerRows: beforeRows,
      readCanonicalSql: () => 'create index concurrently x_idx on public.x(id);',
    })).toThrow(/MIGRATION_BYTES_MISMATCH|TRANSACTION_UNSAFE_MIGRATION/);

    for (const transactionSql of ['commit;', 'rollback;', 'abort;', 'end;', 'start transaction;', 'savepoint writer_savepoint;', 'release writer_savepoint;']) {
      const transactionPlan = buildProductionDbReleasePlan({
        releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
        aliasMap: aliasMap(), readCanonicalSql: () => transactionSql,
      });
      expect(() => buildAtomicProductionApplySql({
        plan: transactionPlan,
        aliasMap: aliasMap(),
        liveLedgerRows: beforeRows,
        readCanonicalSql: () => transactionSql,
      })).toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
    }

    const proceduralSql = 'do $$ begin perform 1; end $$;';
    const proceduralPlan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql: () => proceduralSql,
    });
    expect(() => buildAtomicProductionApplySql({
      plan: proceduralPlan,
      aliasMap: aliasMap(),
      liveLedgerRows: beforeRows,
      readCanonicalSql: () => proceduralSql,
    })).not.toThrow();

    const dollarQuote = String.fromCharCode(36, 36);
    const proceduralNoticeSql = 'do ' + dollarQuote + " begin raise notice 'commit'; end " + dollarQuote + ';';
    const proceduralNoticePlan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql: () => proceduralNoticeSql,
    });
    expect(() => buildAtomicProductionApplySql({
      plan: proceduralNoticePlan,
      aliasMap: aliasMap(),
      liveLedgerRows: beforeRows,
      readCanonicalSql: () => proceduralNoticeSql,
    })).not.toThrow();

    const proceduralCommitSql = 'do ' + dollarQuote + ' begin commit; end ' + dollarQuote + ';';
    const proceduralCommitPlan = buildProductionDbReleasePlan({
      releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: PLANNED_AT,
      aliasMap: aliasMap(), readCanonicalSql: () => proceduralCommitSql,
    });
    expect(() => buildAtomicProductionApplySql({
      plan: proceduralCommitPlan,
      aliasMap: aliasMap(),
      liveLedgerRows: beforeRows,
      readCanonicalSql: () => proceduralCommitSql,
    })).toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
  });

  it('uses read-only ledger → one DB-locked mutable transaction → read-only ledger, then stops for schema/ACL/RLS postcheck', async () => {
    const p = plan();
    const requests: string[] = [];
    const fetchSpy = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const text = String(url);
      requests.push(text);
      if (text.endsWith('/database/query/read-only')) {
        const count = requests.filter((item) => item.endsWith('/database/query/read-only')).length;
        return new Response(JSON.stringify(count === 1 ? beforeRows : [...beforeRows, { version: p.migrations[0].ledgerVersion, name: '0109_assertions' }]), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      const query = JSON.parse(String(init?.body)).query;
      expect(query).toContain('pg_try_advisory_xact_lock');
      expect(query.indexOf('pg_try_advisory_xact_lock')).toBeLessThan(query.indexOf(SQL));
      return new Response('[]', { status: 200 });
    });

    const result = await runControlledProductionRelease({
      plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    });
    expect(result).toMatchObject({
      status: 'APPLY_NEEDS_SCHEMA_POSTCHECK',
      g6: 'DB_ADVISORY_LOCK_AND_POST_LOCK_LEDGER_RECHECK_ENFORCED_IN_ATOMIC_TRANSACTION',
      nextRequiredGate: 'G7_SCHEMA_ACL_RLS_READBACK',
      databaseMutationAuthorized: false,
    });
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
      plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/APPLY_UNKNOWN/);
    expect(mutableCalls).toBe(1);
  });

  it('rejects packet/plan mismatch before a Production write', async () => {
    const p = plan();
    const fetchSpy = vi.fn();
    const badPacket = packet(p); badPacket.planDigest = 'b'.repeat(64);
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: badPacket, aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/RELEASE_PACKET_PLAN_MISMATCH/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('maps post-apply ledger readback uncertainty to APPLY_UNKNOWN without retrying', async () => {
    const p = plan();
    let readOnlyCalls = 0;
    let mutableCalls = 0;
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/database/query/read-only')) {
        readOnlyCalls += 1;
        if (readOnlyCalls === 1) return new Response(JSON.stringify(beforeRows), { status: 200, headers: { 'content-type': 'application/json' } });
        throw new Error('ledger read timed out after apply');
      }
      mutableCalls += 1;
      return new Response('[]', { status: 200 });
    });
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/APPLY_UNKNOWN/);
    expect(readOnlyCalls).toBe(2);
    expect(mutableCalls).toBe(1);
  });

  it('rejects missing, extra and version-drifted full-ledger identities after apply', () => {
    const p = plan();
    const applied = [...beforeRows, { version: p.migrations[0].ledgerVersion, name: '0109_assertions' }];
    expect(() => verifyPostApplyLedger({
      plan: p, baselineLedgerRows: beforeRows,
      liveLedgerRows: [...applied, { version: '3', name: 'unexpected_manual_row' }],
    })).toThrow(/POST_APPLY_LEDGER_MISMATCH/);
    expect(() => verifyPostApplyLedger({
      plan: p, baselineLedgerRows: beforeRows,
      liveLedgerRows: [{ version: p.migrations[0].ledgerVersion, name: '0109_assertions' }],
    })).toThrow(/POST_APPLY_LEDGER_MISMATCH/);
    expect(() => verifyPostApplyLedger({
      plan: p, baselineLedgerRows: beforeRows,
      liveLedgerRows: [...applied.map((row) => row.name === '0001_base' ? { ...row, version: 'drifted' } : row)],
    })).toThrow(/POST_APPLY_LEDGER_VERSION_MISMATCH/);
  });

});
