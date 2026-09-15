import { describe, expect, it, vi } from 'vitest';

import {
  assertPolicyGatedAutomationActive,
  attachProductionDbFinalRisk,
  buildProductionDbBaseReleasePacket,
  createProductionDbOrchestratorState,
  executeProductionDbPreparedRelease,
  finalizeProductionDbRelease,
  prepareProductionDbRelease,
} from '../../scripts/agents/production-db-release-orchestrator.mjs';
import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const RELEASE = 'release-20260915-orchestrator';
const PROD = 'egehnijjpgijmccagxac';
const NOW = '2026-09-15T00:30:00Z';

function plan() {
  return {
    schemaVersion: 1,
    releaseId: RELEASE,
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: PROD,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'ADDITIVE',
    migrations: [{
      repoFile: '0109_issue_41_schema_precondition_assertions',
      path: 'supabase/migrations/0109_issue_41_schema_precondition_assertions.sql',
      sha256: 'c'.repeat(64),
      riskTier: 'SCHEMA_REPAIR',
      ledgerVersion: '20260915003000',
    }],
  };
}

function automationReady(overrides: Record<string, any> = {}) {
  return {
    schemaVersion: 1,
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: PROD,
    mainSha: MAIN,
    databaseMutationAuthorized: false,
    sourceControls: {
      status: 'SOURCE_CONTROLS_VERIFIED', mainSha: MAIN,
      readOnlyPreflightMergedMain: true,
      scopedConsistencyAdapterMergedMain: true,
      backupObserverMergedMain: true,
      restoreRehearsalCallableMergedMain: true,
      sharedTestEvidenceEmitterMergedMain: true,
      exactHeadCiGreen: true,
    },
    finalRiskAdapter: {
      status: 'FINAL_RISK_ADAPTER_VERIFIED', mainSha: MAIN,
      liveGithubFetch: true,
      currentAllowedReviewerVerified: true,
      releaseBoundDigestVerified: true,
    },
    writer: {
      status: 'CONTROLLED_WRITER_VERIFIED', mainSha: MAIN,
      exactPendingSetVerified: true,
      singleUseReceiptVerified: true,
      databaseLockVerified: true,
      durablePreparedEnvelopeVerified: true,
      postcheckVerified: true,
      failureJournalVerified: true,
      bypassAuditClean: true,
      dedicatedScopedCredentialPresent: true,
      classicPatFallbackAbsent: true,
      observerWriterCredentialSeparationVerified: true,
      credentialProjectRef: PROD,
      credentialScope: 'DATABASE_READ_WRITE',
    },
    orchestrator: {
      status: 'TRUSTED_MAIN_ORCHESTRATOR_VERIFIED', mainSha: MAIN,
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
      status: 'COUNTEREXAMPLES_VERIFIED', mainSha: MAIN,
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
    ...overrides,
  };
}

function sourceEvidence() {
  return { status: 'SOURCE_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false };
}
function consistencyEvidence() {
  return {
    status: 'CONSISTENCY_VERIFIED', mainSha: MAIN, planDigest: PLAN,
    unexplainedDifferences: 0, observedAt: '2026-09-15T00:25:00Z', databaseMutationAuthorized: false,
  };
}
function testEvidence() {
  return {
    status: 'TEST_VERIFIED', mainSha: MAIN, planDigest: PLAN,
    policySkip: false, executedTests: 12, cleanup: 'PASSED', databaseMutationAuthorized: false,
  };
}
function recoveryEvidence() {
  return {
    status: 'RECOVERY_VERIFIED', mainSha: MAIN, planDigest: PLAN,
    backupObservedAt: '2026-09-15T00:20:00Z',
    restoreRehearsedAt: '2026-09-14T00:00:00Z',
    restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
    productionBackupRestored: false,
    storageObjectsCovered: false,
    preimageBackupVerified: false,
    databaseMutationAuthorized: false,
  };
}

function basePacket() {
  return buildProductionDbBaseReleasePacket({
    plan: plan(),
    sourceEvidence: sourceEvidence(),
    consistencyEvidence: consistencyEvidence(),
    testEvidence: testEvidence(),
    recoveryEvidence: recoveryEvidence(),
  });
}

describe('Production DB trusted-main release orchestrator #447', () => {
  it('computes readiness from evidence and ignores a self-authored automationReady boolean', () => {
    expect(() => assertPolicyGatedAutomationActive({
      automationEvidence: { automationReady: true },
      plan: plan(),
    })).toThrow(/AUTOMATION_NOT_READY/);

    expect(assertPolicyGatedAutomationActive({
      automationEvidence: automationReady(),
      plan: plan(),
    })).toMatchObject({
      automationReady: true,
      status: 'AUTOMATION_READY',
      authorizationMode: 'POLICY_GATED_ACTIVE',
      databaseMutationAuthorized: false,
    });
  });

  it('blocks readiness evidence bound to another main SHA', () => {
    const other = 'd'.repeat(40);
    const evidence = automationReady({ mainSha: other });
    evidence.sourceControls.mainSha = other;
    evidence.finalRiskAdapter.mainSha = other;
    evidence.writer.mainSha = other;
    evidence.orchestrator.mainSha = other;
    evidence.counterexamples.mainSha = other;
    expect(() => assertPolicyGatedAutomationActive({ automationEvidence: evidence, plan: plan() }))
      .toThrow(/AUTOMATION_MAIN_MISMATCH/);
  });

  it('builds the base packet only from exact source/G2/G3/G4 evidence', () => {
    expect(basePacket()).toMatchObject({
      schemaVersion: 1,
      releaseId: RELEASE,
      productionProjectRef: PROD,
      mainSha: MAIN,
      planDigest: PLAN,
      source: { status: 'SOURCE_VERIFIED', databaseMutationAuthorized: false },
      consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0 },
      test: { status: 'TEST_VERIFIED', policySkip: false, cleanup: 'PASSED' },
      recovery: { status: 'RECOVERY_VERIFIED', storageObjectsCovered: false },
    });

    expect(() => buildProductionDbBaseReleasePacket({
      plan: plan(), sourceEvidence: sourceEvidence(), consistencyEvidence: consistencyEvidence(),
      testEvidence: { ...testEvidence(), planDigest: 'e'.repeat(64) }, recoveryEvidence: recoveryEvidence(),
    })).toThrow(/TEST_PLAN_MISMATCH/);
  });

  it('attaches Final Risk only when it reviews the exact base evidence bundle', () => {
    const base = basePacket();
    const evidenceDigest = releaseEvidenceDigestOf(base);
    const finalRisk = {
      status: 'ASTRA_APPROVED', requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1',
      planDigest: PLAN, evidenceDigest, reviewedAt: '2026-09-15T00:28:00Z',
      executionRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/999#pullrequestreview-1',
      reviewId: '1', releaseId: RELEASE, databaseMutationAuthorized: false,
    };
    expect(attachProductionDbFinalRisk({ basePacket: base, finalRiskEvidence: finalRisk, now: NOW }))
      .toMatchObject({ finalRisk: { status: 'ASTRA_APPROVED', evidenceDigest } });

    expect(() => attachProductionDbFinalRisk({
      basePacket: base,
      finalRiskEvidence: { ...finalRisk, planDigest: 'e'.repeat(64) },
      now: NOW,
    })).toThrow(/FINAL_RISK_PLAN_MISMATCH/);
  });

  it('creates PRE_APPLY journal and an ISSUED receipt bound to the current GitHub run only after readiness', () => {
    const state = createProductionDbOrchestratorState({
      automationEvidence: automationReady(),
      plan: plan(),
      githubRunId: '34930000000',
      githubRunAttempt: 2,
      now: NOW,
    });
    expect(state.journal).toMatchObject({
      releaseId: RELEASE, mainSha: MAIN, planDigest: PLAN, status: 'PRE_APPLY',
    });
    expect(state.receipt).toMatchObject({
      releaseId: RELEASE, mainSha: MAIN, planDigest: PLAN, projectRef: PROD,
      githubRunId: '34930000000', githubRunAttempt: 2, status: 'ISSUED',
      databaseMutationAuthorized: false,
    });
  });

  it('fails before git or Production network when automation readiness is incomplete', async () => {
    const fetchSpy = vi.fn();
    const runnerSpy = vi.fn();
    const pending = automationReady();
    pending.writer.dedicatedScopedCredentialPresent = false;

    await expect(prepareProductionDbRelease({
      automationEvidence: pending,
      plan: plan(),
      releasePacket: {}, journal: {}, receipt: {}, token: 'never-used',
      fetchImpl: fetchSpy as unknown as typeof fetch,
      runner: runnerSpy as any,
    })).rejects.toThrow(/AUTOMATION_NOT_READY/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runnerSpy).not.toHaveBeenCalled();

    await expect(executeProductionDbPreparedRelease({
      automationEvidence: pending,
      plan: plan(),
      releasePacket: {}, prepared: {}, token: 'never-used',
      fetchImpl: fetchSpy as unknown as typeof fetch,
      runner: runnerSpy as any,
    })).rejects.toThrow(/AUTOMATION_NOT_READY/);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(runnerSpy).not.toHaveBeenCalled();
  });

  it('finalizes G7 only from an APPLIED_CONFIRMED journal and a clean Production readback', () => {
    const state = createProductionDbOrchestratorState({
      automationEvidence: automationReady(), plan: plan(), githubRunId: '1', githubRunAttempt: 1, now: NOW,
    });
    const applied = {
      status: 'APPLY_NEEDS_SCHEMA_POSTCHECK', releaseId: RELEASE, mainSha: MAIN, planDigest: PLAN,
      journal: {
        ...state.journal,
        status: 'APPLIED_CONFIRMED',
        events: [
          ...state.journal.events,
          { status: 'APPLYING', at: '2026-09-15T00:30:01Z', evidenceRef: 'writer:prepared' },
          { status: 'APPLIED_CONFIRMED', at: '2026-09-15T00:30:02Z', evidenceRef: 'readback:applied' },
        ],
      },
    };
    const report = {
      observedMainSha: MAIN,
      status: 'MATCH',
      environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'MATCH' },
      differences: [],
      exceptionSummary: { expired: 0, unmatched: 0 },
      safety: { authorizesDatabaseWrite: false },
    };
    expect(finalizeProductionDbRelease({ plan: plan(), applyResult: applied, postcheckReport: report, now: '2026-09-15T00:30:03Z' }))
      .toMatchObject({ status: 'PRODUCTION_SCHEMA_READY', journal: { status: 'PRODUCTION_SCHEMA_READY' } });
  });
});
