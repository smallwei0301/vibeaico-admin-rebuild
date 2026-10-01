import { describe, expect, it, vi } from 'vitest';

// Historical DB/model semantics replay only: this mocked caller has no trusted role-context
// entrypoint. This is not current-policy Production approval. Current enabled missing-proof
// rejection remains covered in final-risk-cost-policy.552 and the current-policy check below.
vi.mock('../../scripts/agents/astra-review-policy.mjs', async importOriginal => {
  const actual = await importOriginal<typeof import('../../scripts/agents/astra-review-policy.mjs')>();
  return { ...actual, routing: { ...actual.routing,
    openaiBuilderDecision: { ...actual.routing.openaiBuilderDecision, independentReviewerRequired: false } } };
});

import {
  PRODUCTION_DB_POLICY,
  evaluateReleasePreflight,
  releaseEvidenceDigestOf,
} from '../../scripts/agents/production-db-release-preflight.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const NOW = '2026-09-14T12:40:00Z';

function schemaRepairPacket() {
  const value: any = {
    schemaVersion: 1,
    releaseId: 'release-schema-repair-447',
    repository: PRODUCTION_DB_POLICY.repository,
    productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'SCHEMA_REPAIR',
    source: { status: 'SOURCE_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false },
    consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T12:35:00Z', mainSha: MAIN, planDigest: PLAN },
    test: {
      status: 'TEST_VERIFIED', policySkip: false, executedTests: 4, cleanup: 'PASSED',
      mainSha: MAIN, planDigest: PLAN,
      // Intentionally false: schema repair must not inherit AUTHZ-only checks.
      tenantBoundaryVerified: false,
      negativeRoleTestsPassed: false,
    },
    recovery: {
      status: 'RECOVERY_VERIFIED', productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef, databaseMutationAuthorized: false, backupObservedAt: '2026-09-14T12:20:00Z',
      restoreRehearsedAt: '2026-09-01T03:00:00Z', storageObjectsCovered: false,
      // Intentionally false: schema repair must not inherit BACKFILL-only preimage requirements.
      preimageBackupVerified: false,
    },
    finalRisk: {
      status: 'ASTRA_APPROVED', requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1',
      planDigest: PLAN, evidenceDigest: '', reviewedAt: '2026-09-14T12:25:00Z',
      executionRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/450#review', reviewId: 'repair-447',
    },
    data: { paymentFactsTouched: false, batchSize: 0, maxRows: 0 },
  };
  value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
  return value;
}

describe('Production DB SCHEMA_REPAIR preflight #447', () => {
  it('admits a fully evidenced reversible schema repair without unrelated AUTHZ/BACKFILL checks', () => {
    expect(evaluateReleasePreflight(schemaRepairPacket(), { now: NOW })).toMatchObject({
      status: 'READY_FOR_LOCK',
      riskTier: 'SCHEMA_REPAIR',
      databaseMutationAuthorized: false,
    });
  });

  it('still rejects unknown/destructive risk tiers', () => {
    const packet = schemaRepairPacket();
    packet.riskTier = 'DESTRUCTIVE';
    expect(() => evaluateReleasePreflight(packet, { now: NOW })).toThrow(/UNSUPPORTED_RISK_TIER/);
  });
});


it('current enabled role policy still rejects this historical DB fixture without trusted role proof', async () => {
  const { routing: currentPolicy } = await vi.importActual<typeof import('../../scripts/agents/astra-review-policy.mjs')>('../../scripts/agents/astra-review-policy.mjs');
  const { finalRiskReviewerErrors: checkRoles } = await import('../../scripts/agents/final-risk-cost-policy.mjs');
  const enabledPolicy = { ...currentPolicy, openaiBuilderDecision: { ...currentPolicy.openaiBuilderDecision, independentReviewerRequired: true } };
  expect(checkRoles({ requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1' }, enabledPolicy))
    .toContain('Missing independently read-back builder/reviewer role evidence');
});
