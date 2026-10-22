import { describe, expect, it } from 'vitest';

import {
  closeRunLedgerV2,
  createHistoricalRunLedgerV3,
  createRunLedgerV2,
  validateRunLedgerV2,
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
      claim('SOURCE_VERIFIED', 'issue#10', 'success'),
      claim('MERGED_TO_MAIN', 'issue#10', 'merged'),
      claim('AUTO_VERCEL_DEPLOYED', 'issue#10', 'ready'),
      claim('PRODUCTION_SCHEMA_READY', 'issue#10', 'ready'),
      claim('AUTHENTICATED_PRODUCTION_ACCEPTED', 'issue#10', 'accepted'),
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
  // Grading now enforces readiness consistency, so the recorded peaks above must be
  // derivable from these lifecycle events (BUILD 1, candidates 2, shared TEST 1).
  const head = 'c'.repeat(40);
  const event = (id: string, at: string, kind: string, pr: number, issue: number) => (
    { id, at, kind, pr, issue, head, workstream: 'PRODUCT_MAINLINE', reason: 'fixture' }
  );
  run.wipLifecycle.events = [
    event('build-460', '2026-09-15T00:10:00Z', 'BUILD_ENTER', 11, 460),
    event('verify-461', '2026-09-15T00:20:00Z', 'VERIFY_ENTER', 12, 461),
    event('verify-461-exit', '2026-09-15T00:25:00Z', 'VERIFY_EXIT', 12, 461),
    event('build-460-exit', '2026-09-15T00:30:00Z', 'BUILD_EXIT', 11, 460),
    event('test-460', '2026-09-15T00:40:00Z', 'TEST_ENTER', 11, 460),
    event('test-460-exit', '2026-09-15T00:50:00Z', 'TEST_EXIT', 11, 460),
  ];
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

  // Set before closeout: closeRunLedgerV2 now preflights that a COMPLETE
  // candidate would actually score (see run-ledger-v2.mjs's grading
  // preflight). Individual it() blocks below still freely mutate
  // completionTruth afterward to exercise scoreRunCurrent's own gap/
  // hard-fail detection on top of an already-closed envelope.
  run.completionTruth = {
    status: 'VERIFIED',
    checkedAt: '2026-09-15T01:01:00Z',
    claims: [
      claim('ISSUE_CLOSED', 'issue#460', 'closed'),
      claim('RUN_COMPLETE', run.runId, 'complete', 'complete', 'github:issue#460'),
    ],
  };

  run = closeRunLedgerV2(run, {
    status: 'COMPLETE',
    endedAt: '2026-09-15T01:00:00Z',
    mainEndSha: 'b'.repeat(40),
    openIssuesEnd: 9,
    openPrsEnd: 2,
    evidenceRef: 'github:issue#460',
  });
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

  it('keeps a Run that started before the cutoff on LEGACY_V2 even if it ends after the cutoff', () => {
    const run = observedRun();
    run.startedAt = '2026-09-14T23:59:59Z';
    const result = scoreRunCurrent(run);
    expect(usesObservedScoreProfile(run)).toBe(false);
    expect(result.scoreProfile).toBe('LEGACY_V2');
    expect(result.scoreStatus).toBe('NOT_GRADED');
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
    expect(result.observedMetrics?.observedTaskCount).toBe(1);
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

// tour-platform PR #1908 Codex review: grading must not trust counters that the
// readiness check already flags, and a v4 Run window must be a real ISO interval.
describe('OBSERVED_V1 grading enforces readiness consistency and the Run window', () => {
  it('does not grade closure conversion above 100% (closureAdvancedOrClosed > closureSweeps)', () => {
    const run = observedRun();
    run.inventory.closureSweeps = 1;
    run.inventory.closureAdvancedOrClosed = 100;
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('NOT_GRADED');
    expect(result.comparisonEligible).toBe(false);
    expect(result.total).toBeNull();
    expect(result.gradingGaps).toContain('readiness: inventory.closureAdvancedOrClosed=100 exceeds closureSweeps=1');
  });

  it('does not award WIP points from peaks that disagree with wipLifecycle events', () => {
    const run = observedRun();
    run.wipLifecycle.events = [];
    const result = scoreRunCurrent(run);
    expect(result.scoreStatus).toBe('NOT_GRADED');
    expect(result.comparisonEligible).toBe(false);
    expect(result.gradingGaps).toContain('readiness: inventory.activeCandidatePeak=2 disagrees with wipLifecycle-derived 0');
  });

  it('rejects a final v4 Run whose endedAt precedes startedAt', () => {
    const run = observedRun();
    run.endedAt = '2026-09-14T23:00:00Z';
    run.closeout.closedAt = run.endedAt;
    expect(validateRunLedgerV2(run)).toContain('final v4 Run requires endedAt at or after startedAt');
    expect(() => scoreRunCurrent(run)).toThrow(/endedAt at or after startedAt/);
  });

  it('rejects a malformed v4 startedAt instead of silently selecting LEGACY_V2', () => {
    const run = createRunLedgerV2('2026-09-15-bad-start', 'not-a-date', { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
    expect(validateRunLedgerV2(run)).toContain('deliveryTruthVersion=4 requires startedAt as an ISO UTC timestamp');
    expect(() => scoreRunCurrent(run)).toThrow(/startedAt as an ISO UTC timestamp/);
  });

  it.each(['2026-02-30T00:00:00Z', '2026-09-15T24:00:00Z', '2026-09-15T23:59:60Z'])(
    'rejects a calendar-invalid v4 startedAt %j that Date.parse would normalize',
    (startedAt) => {
      const run = createRunLedgerV2('2026-09-15-impossible-start', startedAt, { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
      expect(validateRunLedgerV2(run)).toContain('deliveryTruthVersion=4 requires startedAt as an ISO UTC timestamp');
    },
  );

  it('rejects a calendar-invalid final endedAt', () => {
    const run = observedRun();
    run.endedAt = '2026-09-31T01:00:00Z';
    run.closeout.closedAt = run.endedAt;
    expect(validateRunLedgerV2(run)).toContain('final v4 Run requires endedAt as an ISO UTC timestamp');
  });

  it.each([
    'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/460',
    'issue 460',
    'issue:460',
  ])('still grades a consistent Run whose ISSUE_CLOSED subject is written as %j', (subject) => {
    const run = observedRun();
    run.completionTruth.claims[0].subject = subject;
    const result = scoreRunCurrent(run);
    expect(result.gradingGaps).toEqual([]);
    expect(result.scoreStatus).toBe('GRADED_OBSERVED_V1');
  });

  it('refuses closeout of an otherwise complete Run whose counters are inconsistent', () => {
    let run: any = createRunLedgerV2('2026-09-15-closure-overflow', '2026-09-15T00:00:00Z', { closeoutOwner: 'PRODUCT_MAIN_SESSION' });
    const reference = observedRun();
    run = { ...structuredClone(reference), runId: run.runId, status: run.status, endedAt: null, closeout: run.closeout };
    run.main.endSha = null;
    run.inventory.openIssuesEnd = null;
    run.inventory.openPrsEnd = null;
    run.inventory.closureSweeps = 1;
    run.inventory.closureAdvancedOrClosed = 100;
    run.completionTruth.claims = run.completionTruth.claims.map((item: any) => (
      item.type === 'RUN_COMPLETE' ? { ...item, subject: run.runId } : item
    ));
    expect(() => closeRunLedgerV2(run, {
      status: 'COMPLETE',
      endedAt: '2026-09-15T01:00:00Z',
      mainEndSha: 'b'.repeat(40),
      openIssuesEnd: 9,
      openPrsEnd: 2,
      evidenceRef: 'github:issue#460',
    })).toThrow(/CLOSEOUT_WOULD_NOT_GRADE[\s\S]*closureAdvancedOrClosed=100 exceeds closureSweeps=1/);
  });
});
