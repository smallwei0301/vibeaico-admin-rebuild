import { describe, expect, it, vi } from 'vitest';

import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbReleasePlan } from '../../scripts/agents/production-db-release-plan.mjs';
import { runControlledProductionRelease } from '../../scripts/db/controlled-production-db-release.mjs';

const MAIN = 'a'.repeat(40);
const NOW = '2026-09-14T12:40:00Z';
const SQL = 'create table if not exists public.guard_447(id uuid primary key);';

function aliasMap() {
  return { schemaVersion: 1, entries: [
    { repoFile: '0109_assertions', ledgerNames: [], classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', evidence: 'x' },
  ] };
}
function plan() {
  return buildProductionDbReleasePlan({ releaseId: 'release-20260914-447', mainSha: MAIN, plannedAt: '2026-09-14T12:30:00Z', aliasMap: aliasMap(), readCanonicalSql: () => SQL });
}
function packet(p: any) {
  const value: any = {
    schemaVersion: 1, releaseId: p.releaseId, repository: p.repository, productionProjectRef: p.productionProjectRef,
    mainSha: p.mainSha, planDigest: p.planDigest, riskTier: p.riskTier,
    source: { status: 'SOURCE_VERIFIED', mainSha: p.mainSha, planDigest: p.planDigest, databaseMutationAuthorized: false },
    consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T12:35:00Z', mainSha: p.mainSha, planDigest: p.planDigest },
    test: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 1, cleanup: 'PASSED', mainSha: p.mainSha, planDigest: p.planDigest },
    recovery: { status: 'RECOVERY_VERIFIED', backupObservedAt: '2026-09-14T12:20:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z', storageObjectsCovered: false },
    finalRisk: { status: 'ASTRA_APPROVED', requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1', planDigest: p.planDigest, evidenceDigest: '', reviewedAt: '2026-09-14T12:25:00Z', executionRef: 'https://github.com/example/review', reviewId: '447' },
    data: { paymentFactsTouched: false, batchSize: 1, maxRows: 1 },
  };
  value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
  return value;
}

describe('Issue #447 controlled writer admission negatives', () => {
  it('rejects wrong project in release packet before network', async () => {
    const p = plan(); const pkt = packet(p); pkt.productionProjectRef = 'wrong-project';
    const fetchImpl = vi.fn();
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: pkt,
      aliasMap: aliasMap(), readCanonicalSql: () => SQL, token: 'x', fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/WRONG_PROJECT/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects stale consistency evidence before network', async () => {
    const p = plan(); const pkt = packet(p); const fetchImpl = vi.fn();
    pkt.consistency.observedAt = '2026-09-14T12:00:00Z';
    pkt.finalRisk.evidenceDigest = releaseEvidenceDigestOf(pkt);
    await expect(runControlledProductionRelease({
      plan: p, releasePacket: pkt,
      aliasMap: aliasMap(), readCanonicalSql: () => SQL, token: 'x', fetchImpl: fetchImpl as unknown as typeof fetch, now: NOW,
    })).rejects.toThrow(/STALE_EVIDENCE/);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
