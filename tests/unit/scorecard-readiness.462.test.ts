import { describe, expect, it } from 'vitest';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { analyzeScorecardReadiness } from '../../scripts/agents/scorecard-readiness.mjs';

function task(id: string, requestedModel: 'luna' | 'terra' | 'sol', count = 1, accepted = true): any {
  return {
    id,
    requestedModel,
    actualModel: requestedModel,
    actualModelId: `test-${requestedModel}`,
    role: id,
    count,
    contextClass: 'compact',
    accepted,
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
  };
}

function activeRun(startedAt = '2026-09-15T00:00:00Z'): any {
  const run: any = createRunLedgerV2(
    '2026-09-15-readiness-test',
    startedAt,
    { closeoutOwner: 'PRODUCT_MAIN_SESSION' },
  );
  run.delivery.issuesStarted = 1;
  run.ci.fullCiRuns = 2;
  run.inventory.closureSweeps = 1;
  run.modelUsage.tasks = [
    task('scan', 'luna', 2, true),
    task('audit', 'sol', 1, true),
  ];
  run.flow.lunaTasks = 2;
  run.flow.lunaAccepted = 2;
  run.flow.solTouches = 1;
  return run;
}

describe('scorecard live readiness (#462)', () => {
  it('is healthy for an active OBSERVED_V1-style Run with consistent raw counters', () => {
    const result = analyzeScorecardReadiness(activeRun());

    expect(result.validLedger).toBe(true);
    expect(result.scoreProfileTarget).toBe('OBSERVED_V1');
    expect(result.liveCaptureStatus).toBe('LIVE_CAPTURE_READY');
    expect('liveReadinessPercent' in result).toBe(false);
    expect(result.rawCaptureGaps).toEqual([]);
    expect(result.consistencyWarnings).toEqual([]);
    expect(result.readyForContinuedCapture).toBe(true);
    expect(result.terminalOnlyPending).toContain('endedAt');
    expect(result.observed).toMatchObject({
      taskCount: 3,
      lunaTasks: 2,
      lunaAccepted: 2,
      solTaskCount: 1,
      recordedSolTouches: 1,
      fullCiRuns: 2,
      verifiedIssueClosedSubjects: 0,
      recordedIssuesClosed: 0,
    });
  });

  it('never relabels a pre-cutoff Run as OBSERVED_V1', () => {
    const result = analyzeScorecardReadiness(activeRun('2026-09-14T23:59:59Z'));

    expect(result.scoreProfileTarget).toBe('LEGACY_V2');
    expect(result.observedScoreEffectiveAt).toBe('2026-09-15T00:00:00Z');
  });

  it('fails early when Run activity exists but modelUsage.tasks was never captured', () => {
    const run = activeRun();
    run.modelUsage.tasks = [];
    run.flow.lunaTasks = 0;
    run.flow.lunaAccepted = 0;
    run.flow.solTouches = 0;

    const result = analyzeScorecardReadiness(run);

    expect(result.liveCaptureStatus).toBe('NEEDS_CAPTURE');
    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.rawCaptureGaps).toContain(
      'modelUsage.tasks has no observed task records despite recorded Run activity',
    );
  });

  it('detects drift between durable Luna task records and flow counters', () => {
    const run = activeRun();
    run.flow.lunaTasks = 9;
    run.flow.lunaAccepted = 8;
    run.flow.solTouches = 7;

    const result = analyzeScorecardReadiness(run);

    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.consistencyWarnings).toContain(
      'flow.lunaTasks=9 disagrees with modelUsage.tasks-derived 2',
    );
    expect(result.consistencyWarnings).toContain(
      'flow.lunaAccepted=8 disagrees with modelUsage.tasks-derived 2',
    );
    expect(result.consistencyWarnings).not.toContain(
      'flow.solTouches=7 disagrees with modelUsage.tasks-derived 1',
    );
    expect(result.observed).toMatchObject({ solTaskCount: 1, recordedSolTouches: 7 });
  });

  it('detects a recorded Issue close that has no verified Completion Truth claim', () => {
    const run = activeRun();
    run.delivery.issuesClosed = 1;

    const result = analyzeScorecardReadiness(run);

    expect(result.liveCaptureStatus).toBe('NEEDS_CAPTURE');
    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.consistencyWarnings).toContain(
      'verified ISSUE_CLOSED subjects=0 disagrees with delivery.issuesClosed=1',
    );
  });

  it('detects verified ISSUE_CLOSED evidence that is not reflected in the delivery counter', () => {
    const run = activeRun();
    run.completionTruth.claims.push({
      type: 'ISSUE_CLOSED',
      subject: 'issue#123',
      claimedState: 'closed',
      observedState: 'closed',
      verification: 'VERIFIED',
      evidenceRef: 'github:issue#123',
    });

    const result = analyzeScorecardReadiness(run);

    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.consistencyWarnings).toContain(
      'verified ISSUE_CLOSED subjects=1 disagrees with delivery.issuesClosed=0',
    );
  });

  it('does not require legacy manual percentage fields', () => {
    const run = activeRun();
    run.ci.firstPassRatePercent = null;
    run.quality.acceptanceEvidenceCoveragePercent = null;
    run.quality.auditFirstPassRatePercent = null;
    run.flow.lunaDelegationRatePercent = null;
    run.flow.waitTimeConvertedPercent = null;
    run.auditability.evidenceFieldsCompletePercent = null;
    run.auditability.exactHeadTestCoveragePercent = null;
    run.auditability.preciseBlockersPercent = null;
    run.auditability.scoreInputsCompletePercent = null;

    const result = analyzeScorecardReadiness(run);

    expect(result.readyForContinuedCapture).toBe(true);
    expect(result.liveCaptureStatus).toBe('LIVE_CAPTURE_READY');
    expect(result.rawCaptureGaps).toEqual([]);
    expect(result.consistencyWarnings).toEqual([]);
  });
});
