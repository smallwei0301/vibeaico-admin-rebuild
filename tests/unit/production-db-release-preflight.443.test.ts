import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_DB_POLICY,
  evaluateApplyAdmission,
  evaluateAutomationReadiness,
  evaluateReleasePreflight,
  releaseEvidenceDigestOf,
} from '../../scripts/agents/production-db-release-preflight.mjs';

const NOW = '2026-09-14T10:00:00Z';
const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);

function packet(overrides: Record<string, unknown> = {}) {
  const value: any = {
    schemaVersion: 1,
    releaseId: 'release-20260914-001',
    repository: PRODUCTION_DB_POLICY.repository,
    productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'ADDITIVE',
    source: {
      status: 'SOURCE_VERIFIED',
      mainSha: MAIN,
      planDigest: PLAN,
      databaseMutationAuthorized: false,
    },
    consistency: {
      status: 'CONSISTENCY_VERIFIED',
      unexplainedDifferences: 0,
      observedAt: '2026-09-14T09:50:00Z',
      mainSha: MAIN,
      planDigest: PLAN,
    },
    test: {
      status: 'TEST_VERIFIED',
      policySkip: false,
      executedTests: 12,
      cleanup: 'PASSED',
      mainSha: MAIN,
      planDigest: PLAN,
      tenantBoundaryVerified: false,
      negativeRoleTestsPassed: false,
    },
    recovery: {
      status: 'RECOVERY_VERIFIED',
      backupObservedAt: '2026-09-14T09:30:00Z',
      restoreRehearsedAt: '2026-09-01T03:00:00Z',
      storageObjectsCovered: false,
      preimageBackupVerified: false,
    },
    finalRisk: {
      status: 'ASTRA_APPROVED',
      requestedModel: 'claude-fable-5-1',
      actualModel: 'claude-fable-5-1',
      planDigest: PLAN,
      evidenceDigest: '',
      reviewedAt: '2026-09-14T09:20:00Z',
      executionRef: 'github-review-execution-123',
      reviewId: 'review-123',
    },
    data: {
      paymentFactsTouched: false,
      batchSize: 100,
      maxRows: 1000,
    },
  };
  Object.assign(value, overrides);
  value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
  return value;
}

function lock(overrides: Record<string, unknown> = {}) {
  return Object.assign({
    status: 'LOCK_VERIFIED',
    releaseId: 'release-20260914-001',
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    planDigest: PLAN,
    acquiredAt: '2026-09-14T09:59:30Z',
    holder: 'workflow:123/job:456',
    liveBaselineRechecked: true,
  }, overrides);
}

function automationEvidence() {
  return {
    schemaVersion: 1,
    repository: PRODUCTION_DB_POLICY.repository,
    productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    mainSha: MAIN,
    databaseMutationAuthorized: false,
    sourceControls: {
      status: 'SOURCE_CONTROLS_VERIFIED',
      mainSha: MAIN,
      readOnlyPreflightMergedMain: true,
      scopedConsistencyAdapterMergedMain: true,
      backupObserverMergedMain: true,
      restoreRehearsalCallableMergedMain: true,
      sharedTestEvidenceEmitterMergedMain: true,
      exactHeadCiGreen: true,
    },
    finalRiskAdapter: {
      status: 'FINAL_RISK_ADAPTER_VERIFIED',
      mainSha: MAIN,
      liveGithubFetch: true,
      currentAllowedReviewerVerified: true,
      releaseBoundDigestVerified: true,
    },
    writer: {
      status: 'CONTROLLED_WRITER_VERIFIED',
      mainSha: MAIN,
      exactPendingSetVerified: true,
      singleUseReceiptVerified: true,
      databaseLockVerified: true,
      durablePreparedEnvelopeVerified: true,
      postcheckVerified: true,
      failureJournalVerified: true,
      bypassAuditClean: true,
      dedicatedScopedCredentialPresent: true,
      credentialProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
      credentialScope: 'DATABASE_READ_WRITE',
      classicPatFallbackAbsent: true,
      observerWriterCredentialSeparationVerified: true,
    },
    orchestrator: {
      status: 'TRUSTED_MAIN_ORCHESTRATOR_VERIFIED',
      mainSha: MAIN,
      trustedMainOnly: true,
      g3EvidenceConsumerWired: true,
      g4BackupEvidenceConsumerWired: true,
      g4RestoreEvidenceConsumerWired: true,
      finalRiskLiveFetchWired: true,
      preparedEnvelopePersistBeforeExecute: true,
      preparedEnvelopeReloadVerified: true,
      g7PostcheckWired: true,
      terminalResultPersisted: true,
    },
    counterexamples: {
      status: 'COUNTEREXAMPLES_VERIFIED',
      mainSha: MAIN,
      wrongProject: true,
      staleEvidence: true,
      unplannedDrift: true,
      emptyTest: true,
      fakeOrStaleReview: true,
      missingRecovery: true,
      receiptReplay: true,
      parallelWriter: true,
      partialApply: true,
      postcheckFail: true,
      lostRunnerCrashWindow: true,
    },
  };
}

describe('Production DB release preflight', () => {
  it('accepts a bounded additive release into READY_FOR_LOCK without authorizing a DB mutation', () => {
    const result = evaluateReleasePreflight(packet(), { now: NOW });
    expect(result.status).toBe('READY_FOR_LOCK');
    expect(result.databaseMutationAuthorized).toBe(false);
    expect(result.nextRequiredGate).toBe('G6_WRITER_LOCK_AND_LIVE_RECHECK');
  });

  it('rejects a different repository or Production project', () => {
    expect(() => evaluateReleasePreflight(packet({ repository: 'other/repo' }), { now: NOW }))
      .toThrow(/WRONG_REPOSITORY/);
    expect(() => evaluateReleasePreflight(packet({ productionProjectRef: 'other-project' }), { now: NOW }))
      .toThrow(/WRONG_PROJECT/);
  });

  it('rejects destructive or unknown release tiers rather than relying on a human waiver', () => {
    expect(() => evaluateReleasePreflight(packet({ riskTier: 'DESTRUCTIVE' }), { now: NOW }))
      .toThrow(/UNSUPPORTED_RISK_TIER/);
  });

  it('requires fresh scoped consistency evidence and zero unexplained drift', () => {
    const stale = packet();
    stale.consistency.observedAt = '2026-09-14T09:30:00Z';
    expect(() => evaluateReleasePreflight(stale, { now: NOW })).toThrow(/STALE_EVIDENCE/);

    const drift = packet();
    drift.consistency.unexplainedDifferences = 1;
    expect(() => evaluateReleasePreflight(drift, { now: NOW })).toThrow(/UNEXPLAINED_DRIFT/);
  });

  it('does not treat a policy skip or zero executed tests as TEST evidence', () => {
    const skipped = packet();
    skipped.test.policySkip = true;
    expect(() => evaluateReleasePreflight(skipped, { now: NOW })).toThrow(/TEST_POLICY_SKIP/);

    const empty = packet();
    empty.test.executedTests = 0;
    expect(() => evaluateReleasePreflight(empty, { now: NOW })).toThrow(/EMPTY_TEST_EVIDENCE/);
  });

  it('requires a current allowlisted Final Risk identity and the same reviewed plan', () => {
    const wrongModel = packet();
    wrongModel.finalRisk.actualModel = 'claude-opus-5';
    expect(() => evaluateReleasePreflight(wrongModel, { now: NOW })).toThrow(/FINAL_RISK_MODEL_UNVERIFIED/);

    const stalePlan = packet();
    stalePlan.finalRisk.planDigest = 'c'.repeat(64);
    expect(() => evaluateReleasePreflight(stalePlan, { now: NOW })).toThrow(/FINAL_RISK_PLAN_MISMATCH/);
  });

  it('invalidates Final Risk when any reviewed release evidence changes', () => {
    const changed = packet();
    changed.consistency.observedAt = '2026-09-14T09:51:00Z';
    expect(() => evaluateReleasePreflight(changed, { now: NOW })).toThrow(/FINAL_RISK_EVIDENCE_MISMATCH/);
  });

  it('adds tenant and negative-role evidence only for AUTHZ changes', () => {
    const authz = packet({ riskTier: 'AUTHZ' });
    expect(() => evaluateReleasePreflight(authz, { now: NOW })).toThrow(/TENANT_BOUNDARY_TEST_REQUIRED/);
    authz.test.tenantBoundaryVerified = true;
    expect(() => evaluateReleasePreflight(authz, { now: NOW })).toThrow(/FINAL_RISK_EVIDENCE_MISMATCH/);
    authz.finalRisk.evidenceDigest = releaseEvidenceDigestOf(authz);
    expect(() => evaluateReleasePreflight(authz, { now: NOW })).toThrow(/NEGATIVE_ROLE_TEST_REQUIRED/);
    authz.test.negativeRoleTestsPassed = true;
    authz.finalRisk.evidenceDigest = releaseEvidenceDigestOf(authz);
    expect(evaluateReleasePreflight(authz, { now: NOW }).status).toBe('READY_FOR_LOCK');
  });

  it('uses bounded extra checks for BACKFILL instead of forcing them on every migration', () => {
    const backfill = packet({ riskTier: 'BACKFILL' });
    expect(() => evaluateReleasePreflight(backfill, { now: NOW })).toThrow(/PRODUCTION_BACKUP_RESTORE_REQUIRED/);

    backfill.recovery.restoreRehearsalKind = 'PRODUCTION_BACKUP_CLONE';
    backfill.recovery.productionBackupRestored = true;
    backfill.finalRisk.evidenceDigest = releaseEvidenceDigestOf(backfill);
    expect(() => evaluateReleasePreflight(backfill, { now: NOW })).toThrow(/PREIMAGE_BACKUP_REQUIRED/);

    backfill.recovery.preimageBackupVerified = true;
    backfill.finalRisk.evidenceDigest = releaseEvidenceDigestOf(backfill);
    backfill.data.batchSize = 1001;
    expect(() => evaluateReleasePreflight(backfill, { now: NOW })).toThrow(/BACKFILL_BATCH_LIMIT/);
    backfill.data.batchSize = 100;
    backfill.data.maxRows = 10001;
    expect(() => evaluateReleasePreflight(backfill, { now: NOW })).toThrow(/BACKFILL_RELEASE_LIMIT/);
    backfill.data.maxRows = 1000;
    backfill.data.paymentFactsTouched = true;
    expect(() => evaluateReleasePreflight(backfill, { now: NOW })).toThrow(/PAYMENT_FACTS_FORBIDDEN/);
    backfill.data.paymentFactsTouched = false;

    expect(evaluateReleasePreflight(backfill, { now: NOW }).status).toBe('READY_FOR_LOCK');
  });

  it('requires a fresh project-bound lock and a post-lock live recheck for apply admission', () => {
    const ready = evaluateApplyAdmission(packet(), lock(), { now: NOW });
    expect(ready.status).toBe('READY_FOR_CONTROLLED_APPLY');
    expect(ready.databaseMutationAuthorized).toBe(false);

    expect(() => evaluateApplyAdmission(packet(), lock({ liveBaselineRechecked: false }), { now: NOW }))
      .toThrow(/LIVE_RECHECK_REQUIRED/);
    expect(() => evaluateApplyAdmission(packet(), lock({ acquiredAt: '2026-09-14T09:58:00Z' }), { now: NOW }))
      .toThrow(/STALE_EVIDENCE/);
    expect(() => evaluateApplyAdmission(packet(), lock({ projectRef: 'wrong-project' }), { now: NOW }))
      .toThrow(/LOCK_PROJECT_MISMATCH/);
  });
});

describe('Production DB AUTOMATION_READY verifier #447', () => {
  it('activates policy mode only when every canonical source/runtime/counterexample condition is verified on one main SHA', () => {
    const result = evaluateAutomationReadiness(automationEvidence());
    expect(result).toMatchObject({
      status: 'AUTOMATION_READY',
      automationReady: true,
      authorizationMode: 'POLICY_GATED_ACTIVE',
      perRunOwnerApproval: 'NOT_REQUIRED',
      mainSha: MAIN,
      blockers: [],
      databaseMutationAuthorized: false,
    });
  });

  it('cannot be self-declared ready when the dedicated writer credential is not evidenced', () => {
    const evidence: any = automationEvidence();
    evidence.automationReady = true;
    evidence.writer.dedicatedScopedCredentialPresent = false;
    const result = evaluateAutomationReadiness(evidence);
    expect(result.automationReady).toBe(false);
    expect(result.authorizationMode).toBe('POLICY_APPROVED_AUTOMATION_PENDING');
    expect(result.blockers).toContain('WRITER_DEDICATEDSCOPEDCREDENTIALPRESENT_REQUIRED');
    expect(result.databaseMutationAuthorized).toBe(false);
  });

  it('requires durable PREPARE persistence/reload before the orchestrator can count as verified', () => {
    const evidence: any = automationEvidence();
    evidence.orchestrator.preparedEnvelopePersistBeforeExecute = false;
    evidence.orchestrator.preparedEnvelopeReloadVerified = false;
    const result = evaluateAutomationReadiness(evidence);
    expect(result.automationReady).toBe(false);
    expect(result.blockers).toContain('ORCHESTRATOR_PREPAREDENVELOPEPERSISTBEFOREEXECUTE_REQUIRED');
    expect(result.blockers).toContain('ORCHESTRATOR_PREPAREDENVELOPERELOADVERIFIED_REQUIRED');
  });

  it.each(['parallelWriter', 'partialApply', 'postcheckFail', 'lostRunnerCrashWindow'])('requires the %s counterexample to fail closed before activation', (name) => {
    const evidence: any = automationEvidence();
    evidence.counterexamples[name] = false;
    const result = evaluateAutomationReadiness(evidence);
    expect(result.automationReady).toBe(false);
    expect(result.blockers).toContain(`COUNTEREXAMPLE_${name.toUpperCase()}_REQUIRED`);
  });

  it('requires every readiness evidence group to be bound to the same exact main SHA', () => {
    const evidence: any = automationEvidence();
    evidence.finalRiskAdapter.mainSha = 'c'.repeat(40);
    const result = evaluateAutomationReadiness(evidence);
    expect(result.automationReady).toBe(false);
    expect(result.blockers).toContain('FINAL_RISK_ADAPTER_MAIN_SHA_MISMATCH');
  });

  it('never turns repository readiness evidence itself into a Production mutation credential', () => {
    const evidence: any = automationEvidence();
    evidence.databaseMutationAuthorized = true;
    const result = evaluateAutomationReadiness(evidence);
    expect(result.automationReady).toBe(false);
    expect(result.blockers).toContain('AUTOMATION_EVIDENCE_SELF_AUTHORIZED_MUTATION');
    expect(result.databaseMutationAuthorized).toBe(false);
  });
});
