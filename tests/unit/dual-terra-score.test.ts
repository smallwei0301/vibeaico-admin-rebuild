import { describe, expect, it } from 'vitest';

import {
  computeDualTerraReport,
  validateDualTerraRun,
} from '../../scripts/agents/score-dual-terra-run.mjs';

function completeRun() {
  return {
    schemaVersion: 1,
    runId: '2026-09-02-dual-terra-r01',
    status: 'COMPLETE',
    startedAt: '2026-09-02T00:00:00.000Z',
    endedAt: '2026-09-02T02:00:00.000Z',
    main: { startSha: 'a', endSha: 'b' },
    sources: { openIssueStart: 40, openIssueEnd: 38, openPrStart: 10, openPrEnd: 8 },
    baselines: { weightedUsagePerDeliveryUnit: 20, deliveryUnits: 1 },
    usage: {
      actualTokensAvailable: false,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      weeklyUsagePercentStart: null,
      weeklyUsagePercentEnd: null,
      source: 'INTERNAL_WEIGHTED_PROXY',
    },
    modelTasks: [
      {
        taskId: 'terra-1', role: 'terra', requestedModel: 'terra', actualModel: 'terra',
        contextSize: 'compact', lunaEligible: false, accepted: true,
        issue: 120, pr: 220, exactHead: 'head-1', result: 'COMPLETE',
      },
      {
        taskId: 'terra-2', role: 'terra', requestedModel: 'terra', actualModel: 'terra',
        contextSize: 'compact', lunaEligible: false, accepted: true,
        issue: 121, pr: 221, exactHead: 'head-2', result: 'COMPLETE',
      },
      {
        taskId: 'luna-closure', role: 'luna', requestedModel: 'luna', actualModel: 'luna',
        contextSize: 'compact', lunaEligible: true, accepted: true,
        issue: 122, pr: null, exactHead: 'main', result: 'PASS',
      },
      {
        taskId: 'sol-audit', role: 'sol', requestedModel: 'sol', actualModel: 'sol',
        contextSize: 'compact', lunaEligible: false, accepted: true,
        issue: 120, pr: 220, exactHead: 'head-1', result: 'CLOSE_APPROVED',
      },
    ],
    delivery: {
      issuesStarted: 2,
      issuesClosed: 2,
      closeApproved: 0,
      completeOwnerBlocked: 0,
      auditReady: 0,
      exactHeadGreenOnly: 0,
      commitOnly: 0,
      unfinishedCarryover: 0,
    },
    inventory: {
      dualTerraPilot: true,
      terraTarget: 2,
      mainTerraPeak: 2,
      reserveTerraPeak: 0,
      closurePeak: 1,
      testValidationPeak: 1,
      activeCandidatePeak: 2,
      closureSweepExecuted: true,
      closureOutcomes: 1,
      slot1ActiveMinutes: 70,
      slot2ActiveMinutes: 65,
      localIsolatedJobs: 2,
      localIsolatedSuccess: 2,
      localIsolatedFailure: 0,
      localCleanupSuccess: 2,
      remoteCanonicalWaitMinutes: 18,
      crossLaneContamination: 0,
      fallbackToSingleTerra: false,
    },
    ci: { fullRuns: 2, firstPassSuccesses: 2, invalidReruns: 0 },
    quality: {
      acceptanceRequirementCount: 10,
      acceptanceEvidenceCount: 10,
      auditAttempts: 1,
      firstPassAuditApprovals: 1,
      unresolvedP0: 0,
      unresolvedP1: 0,
      reopenedIssues: 0,
      postMergeRegressions: 0,
      safetyViolations: 0,
      hardFailReasons: [],
    },
    flow: {
      lunaTasks: 1,
      lunaAccepted: 1,
      duplicateTasks: 0,
      ownershipCollisions: 0,
      waitingOpportunities: 2,
      waitingConvertedToUsefulWork: 2,
    },
    evidence: {
      issueCount: 2,
      issueWithEvidenceCount: 2,
      prCount: 2,
      prWithEvidenceCount: 2,
      exactHeadCount: 2,
      exactHeadWithEvidenceCount: 2,
      testRunIdsComplete: true,
      prBodiesCurrent: true,
      ownerBlockersPrecise: true,
      reportReproducible: true,
      usageSourceDeclared: true,
    },
  };
}

describe('dual Terra pilot scorecard', () => {
  it('accepts a clean two-slot sample without rewriting the legacy scorecard', () => {
    const run = completeRun();
    expect(validateDualTerraRun(run)).toEqual([]);
    const report = computeDualTerraReport(run);
    expect(report.pilotStatus).toBe('QUALIFIED_RUN');
    expect(report.fallbackRequired).toBe(false);
    expect(report.completion.usedBothSlots).toBe(true);
    expect(report.completion.score).toBe(25);
  });

  it('does not count a one-slot run as one of the three dual samples', () => {
    const run = completeRun();
    run.inventory.mainTerraPeak = 1;
    const report = computeDualTerraReport(run);
    expect(report.pilotStatus).toBe('INCOMPLETE_SAMPLE');
    expect(report.fallbackRequired).toBe(false);
    expect(report.qualifiedSample).toBe(false);
  });

  it('falls back when local cleanup is incomplete', () => {
    const run = completeRun();
    run.inventory.localCleanupSuccess = 1;
    const report = computeDualTerraReport(run);
    expect(report.pilotStatus).toBe('FALLBACK_REQUIRED');
    expect(report.fallbackRequired).toBe(true);
    expect(report.recommendations[0]).toContain('退回一條完整 Terra');
  });

  it('treats cross-lane contamination as a hard failure', () => {
    const run = completeRun();
    run.inventory.crossLaneContamination = 1;
    const report = computeDualTerraReport(run);
    expect(report.hardFailed).toBe(true);
    expect(report.grade).toBe('F-HARD');
    expect(report.hardFailReasons).toContain('cross-lane contamination detected');
  });

  it('requires all pilot measurement fields', () => {
    const run = completeRun();
    delete (run.inventory as Partial<typeof run.inventory>).slot2ActiveMinutes;
    expect(validateDualTerraRun(run)).toContain('inventory.slot2ActiveMinutes is required');
  });
});
