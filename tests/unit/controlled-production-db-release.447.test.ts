import { describe, expect, it, vi } from 'vitest';

import { advanceApplyReceipt, createProductionDbApplyReceipt } from '../../scripts/agents/production-db-apply-receipt.mjs';
import { createReleaseJournal } from '../../scripts/agents/production-db-release-journal.mjs';
import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import {
  assertLiveLedgerMatchesAliasMap,
  buildAtomicProductionApplySql,
  executePreparedControlledProductionRelease,
  prepareControlledProductionReleaseAttempt,
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

function journal(p: any) {
  return createReleaseJournal({ releaseId: p.releaseId, mainSha: p.mainSha, planDigest: p.planDigest, createdAt: '2026-09-14T12:39:00Z' });
}

function receipt(p: any) {
  return createProductionDbApplyReceipt({
    releaseId: p.releaseId,
    mainSha: p.mainSha,
    planDigest: p.planDigest,
    projectRef: p.productionProjectRef,
    githubRunId: '44701',
    githubRunAttempt: 1,
    issuedAt: '2026-09-14T12:39:30Z',
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
    recovery: { status: 'RECOVERY_VERIFIED', backupObservedAt: '2026-09-14T12:20:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z', restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY', productionBackupRestored: false, storageObjectsCovered: false, preimageBackupVerified: false },
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

  it('prepares with read-only work, survives serialization, then performs exactly one mutable transaction', async () => {
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

    const prepared = await prepareControlledProductionReleaseAttempt({
      plan: p, releasePacket: packet(p), journal: journal(p), receipt: receipt(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    });
    expect(prepared).toMatchObject({
      status: 'CONTROLLED_APPLY_PREPARED',
      journal: { status: 'APPLYING' },
      receipt: { status: 'CONSUMING' },
      nextRequiredStep: 'DURABLY_PERSIST_ATTEMPT_ENVELOPE_BEFORE_MUTABLE_REQUEST',
      databaseMutationAuthorized: false,
    });
    expect(requests.filter((item) => item.endsWith('/database/query')).length).toBe(0);
    expect(requests.filter((item) => item.endsWith('/database/query/read-only')).length).toBe(1);

    // 模擬 workflow 已先把 envelope 存成 durable artifact，再由下一步重新讀入。
    const durablePrepared = JSON.parse(JSON.stringify(prepared));
    const result = await executePreparedControlledProductionRelease({
      prepared: durablePrepared, plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    });
    expect(result).toMatchObject({
      status: 'APPLY_NEEDS_SCHEMA_POSTCHECK',
      journal: { status: 'APPLIED_CONFIRMED' },
      receipt: { status: 'CONSUMED' },
      g6: 'DURABLE_ATTEMPT_THEN_SINGLE_USE_RECEIPT_PLUS_DB_LOCK_AND_POST_LOCK_RECHECK',
      nextRequiredGate: 'G7_SCHEMA_ACL_RLS_READBACK',
      databaseMutationAuthorized: false,
    });
    expect(requests.filter((item) => item.endsWith('/database/query')).length).toBe(1);
    expect(requests.filter((item) => item.endsWith('/database/query/read-only')).length).toBe(2);
  });

  it('turns mutable/readback uncertainty into APPLY_UNKNOWN + UNKNOWN after durable preparation', async () => {
    const p = plan();
    let mutableCalls = 0;
    const fetchSpy = vi.fn(async (url: string | URL | Request) => {
      const text = String(url);
      if (text.endsWith('/database/query/read-only')) return new Response(JSON.stringify(beforeRows), { status: 200, headers: { 'content-type': 'application/json' } });
      mutableCalls += 1;
      throw new Error('connection reset after send');
    });
    const prepared = await prepareControlledProductionReleaseAttempt({
      plan: p, releasePacket: packet(p), journal: journal(p), receipt: receipt(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    });
    await expect(executePreparedControlledProductionRelease({
      prepared: JSON.parse(JSON.stringify(prepared)), plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toMatchObject({ code: 'APPLY_UNKNOWN', journal: { status: 'APPLY_UNKNOWN' }, receipt: { status: 'UNKNOWN' } });
    expect(mutableCalls).toBe(1);
  });

  it('rejects packet/journal mismatch and receipt replay during preparation before network', async () => {
    const p = plan();
    const fetchSpy = vi.fn();
    const badPacket = packet(p); badPacket.planDigest = 'b'.repeat(64);
    await expect(prepareControlledProductionReleaseAttempt({
      plan: p, releasePacket: badPacket, journal: journal(p), receipt: receipt(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/RELEASE_PACKET_PLAN_MISMATCH/);
    const badJournal = { ...journal(p), planDigest: 'c'.repeat(64) };
    await expect(prepareControlledProductionReleaseAttempt({
      plan: p, releasePacket: packet(p), journal: badJournal, receipt: receipt(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/RELEASE_JOURNAL_PLAN_MISMATCH/);
    const consuming = advanceApplyReceipt(receipt(p), 'CONSUMING', '2026-09-14T12:39:40Z');
    const consumed = advanceApplyReceipt(consuming, 'CONSUMED', '2026-09-14T12:39:50Z');
    await expect(prepareControlledProductionReleaseAttempt({
      plan: p, releasePacket: packet(p), journal: journal(p), receipt: consumed, aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/APPLY_RECEIPT_REPLAY/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('cannot jump directly from PRE_APPLY / ISSUED state into mutable execution', async () => {
    const p = plan();
    const fetchSpy = vi.fn();
    await expect(executePreparedControlledProductionRelease({
      prepared: {
        schemaVersion: 1,
        status: 'CONTROLLED_APPLY_PREPARED',
        releaseId: p.releaseId,
        mainSha: p.mainSha,
        planDigest: p.planDigest,
        preparedAt: NOW,
        baselineLedgerRows: beforeRows,
        journal: journal(p),
        receipt: receipt(p),
        preparationDigest: '0'.repeat(64),
      },
      plan: p, releasePacket: packet(p), aliasMap: aliasMap(), readCanonicalSql,
      token: 'writer-token', fetchImpl: fetchSpy as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/PREPARED_ATTEMPT_DIGEST_MISMATCH|DURABLE_APPLYING_JOURNAL_REQUIRED|APPLY_RECEIPT_NOT_DURABLY_CONSUMING/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
