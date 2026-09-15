import { describe, expect, it } from 'vitest';

import {
  closeRunLedgerV2,
  createHistoricalRunLedgerV3,
  createRunLedgerV2,
} from '../../scripts/agents/run-ledger-v2.mjs';
import {
  OBSERVED_SCORE_PROFILE,
  scoreRunCurrent,
  usesObservedScoreProfile,
} from '../../scripts/agents/score-run-current.mjs';

function claim(type: string, subject: string, claimedState: string, observedState = claimedState, evidenceRef = `github:${subject}`) {
  return { type, subject, claimedState, observedState, verification: 'VERIFIED', evidenceRef };
}

function historicalRun() {
  const run: any = createHistoricalRunLedgerV3('2026-09-02-observed-scorecard-history', '2026-09-02T00:00:00Z');
  run.status = 'COMPLETE';
  run.endedAt = '2026-09-02T01:00:00Z';
  run.main = { startSha: 'a', endSha: 'b' };
  run.inventory = {
    openIssuesStart: 2, openIssuesEnd: 1, openPrsStart: 1, openPrsEnd: 0,
    mainTerraPeak: 1, reserveTerraPeak: 0, activeCandidatePeak: 1, sharedTestPeak: 1,
    closureSweeps: 1, closureAdvancedOrClosed: 1,
  };
  run.modelUsage.weightedUsageImprovementPercent = 10;
  run.modelUsage.tasks = [{
    id: 'legacy-task', requestedModel: 'luna', actualModel: 'luna', role: 'truth', count: 1,
    contextClass: 'compact', accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null,
  }];
  run.delivery = {
    issuesStarted: 1, issuesClosed: 1, auditReady: 0, ownerBlockedComplete: 0,
    exactHeadCiOnly: 0, commitOnly: 0, unfinishedCarryover: 0, cycleTimeMinutes: 60,
  };
  run.ci = { fullCiRuns: 1, invalidReruns: 0, firstPassRatePercent: 100, sharedTestCollisions: 0 };
  run.quality = {
    acceptanceEvidenceCoveragePercent: 100, auditFirstPassRatePercent: 100,
    unresolvedP0: 0, unresolvedP1: 0, reopenedIssues: 0, postMergeRegressions: 0,
    safetyViolations: 0, hardFailReasons: [],
  };
  run.flow = {
    lunaTasks: 1, lunaAccepted: 1, lunaDelegationRatePercent: 100,
    duplicateAgentTasks: 0, ownershipCollisions: 0, waitTimeConvertedPercent: 100,
    solTouches: 1, solIssues: 1,
  };
  run.auditability = {
    evidenceFieldsCompletePercent: 100, exactHeadTestCoveragePercent: 100,
    stalePendingDescriptions: 0, preciseBlockersPercent: 100, scoreInputsCompletePercent: 100,
  };
  run.completionTruth = {
    status: 'VERIFIED', checkedAt: '2026-09-02T01:01:00Z', claims: [
      claim('ISSUE_CLOSED', 'issue#10', 'closed'),
      claim('RUN_COMPLETE', run.runId, 'complete', 'complete', 'github:issue#10'),
    ],
  };
  return run;
}

function observedRun() {
  let run: any = createRunLedgerV2(
    '2026-09-15-observed-scorecard',
    '2026-09-15T00:00:00Z',
    { closeoutOwner: 'PRODUCT_MAIN_SESSION' },
  );
  run.main.startSha = 'a'.repeat(40);
  run.inventory.openIssuesStart = 10;
  run.inventory.openPrsStart = 3;
  run.inventory.mainTerraPeak = 1;
  run.inventory.activeCandidatePeak = 2;
  run.inventory.sharedTestPeak = 1;
  run.inventory.closureSweeps = 2;
  run.inventory.closureAdvancedOrClosed = 1;
  run.modelUsage.tasks = [{
    id: 'scout-1', requestedModel: 'luna', actualModel: 'luna', role: 'truth', count: 1,
    contextClass: 'compact', accepted: true, inputTokens: null, outputTokens: null, cachedTokens: null,
  }];
  run.delivery.issuesStarted = 1;
  run.delivery.issuesClosed = 1;
  run.delivery.unfinishedCarryover = 0;
  run.ci.fullCiRuns = 1;
  run.flow.lunaTasks = 1;
  run.flow.lunaAccepted = 1;
  run.flow.solTouches = 1;
  run.flow.solIssues = 1;

  run = closeRunLedgerV2(run, {
    status: 'COMPLETE',
    endedAt: '2026-09-15T01:00:00Z',
    mainEndSha: 'b'.repeat(40),
    openIssuesEnd: 9,
    openPrsEnd: 2,
    evidenceRef: 'github:issue#460',
  });
  run.completionTruth = {
    status: 'VERIFIED',
    checkedAt: '2026-09-15T01:01:00Z',
    claims: [
      claim('ISSUE_CLOSED', 'issue#460', 'closed'),
      claim('RUN_COMPLETE', run.runId, 'complete', 'complete', 'github:issue#460'),
    ],
  };
  return run;
}

describe('Issue #460 observed-first scorecard', () => {
  it('preserves historical v2 replay before the observed-profile cutoff', () => {
    const run = historicalRun();
    const result = scoreRunCurrent(run);
    expect(usesObservedScoreProfile(run)).toBe(false);
    expect(result.scoreProfile).toBe('LEGACY_V2');
    expect(result.scoreStatus).toBe('GRADED_V2');

    run.quality.acceptanceEvidenceCoveragePercent = null;
    const incomplete = scoreRunCurrent(run);
    expect(incomplete.scoreStatus).toBe('NOT_GRADED');
    expect(incomplete.gradingGaps).toContain('quality.acceptanceEvidenceCoveragePercent is missing');
  });

  it('grades a new terminal Product Run from observed facts even when legacy manual percentages are null', () => {
    const run = observedRun();
    expect(run.modelUsage.weightedUsageImprovementPercent).toBeNull();
    expect(run.ci.firstPassRatePercent).toBeNull();
    expect(run.quality.acceptanceEvidenceCoveragePercent).toBeNull();
    expect(run.flow.lunaDelegationRatePercent).toBeNull();
    expect(run.auditability.scoreInputsCompletePercent).toBeNull();

    const result = scoreRunCurrent(run);
    expect(usesObservedScoreProfile(run)).toBe(true);
    expect(result.scoreProfile).toBe(OBSERVED_SCORE_PROFILE);
    expect(result.scoreStatus).toBe('GRADED_OBSERVED_V1');
    expect(result.comparisonEligible).toBe(true);
    expect(result.productionPendingUnits).toBe(1);
    expect(result.observedMetrics?.cycleTimeMinutes).toBe(60);
    expect(result.observedMetrics?.lunaAcceptancePercent).toBe(100);
  });

  it('keeps new runs ungraded until Completion Truth is VERIFIED', () => {
    const run = observedRun();
    run.completionTruth = { status: 'NOT_CHECKED', checkedAt: null, claims: [] };
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('NOT_GRADED');
    expect(result.comparisonEligible).toBe(false);
    expect(result.gradingGaps).toContain('completionTruth.status must be VERIFIED');
  });

  it('does not grade a new terminal Run that has no observed task records', () => {
    const run = observedRun();
    run.modelUsage.tasks = [];
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('NOT_GRADED');
    expect(result.comparisonEligible).toBe(false);
    expect(result.gradingGaps).toContain('modelUsage.tasks has no observed task records');
  });

  it('still hard-fails safety violations', () => {
    const run = observedRun();
    run.quality.safetyViolations = 1;
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('HARD_FAIL');
    expect(result.grade).toBe('F-HARD');
  });

  it('still hard-fails contradictory completion claims', () => {
    const run = observedRun();
    run.completionTruth.claims[0].observedState = 'open';
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('HARD_FAIL');
    expect(result.grade).toBe('F-HARD');
    expect(result.hardFailures.some((item: string) => item.includes('contradicts live evidence'))).toBe(true);
  });
});
