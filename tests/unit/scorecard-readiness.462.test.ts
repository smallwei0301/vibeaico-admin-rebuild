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

function activeRun(): any {
  const run: any = createRunLedgerV2(
    '2026-09-15-readiness-test',
    '2026-09-15T00:00:00Z',
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
    expect(result.rawCaptureGaps).toEqual([]);
    expect(result.consistencyWarnings).toEqual([]);
    expect(result.readyForContinuedCapture).toBe(true);
    expect(result.terminalOnlyPending).toContain('endedAt');
    expect(result.observed).toMatchObject({
      taskCount: 3,
      lunaTasks: 2,
      lunaAccepted: 2,
      solTouches: 1,
      fullCiRuns: 2,
    });
  });

  it('fails early when Run activity exists but modelUsage.tasks was never captured', () => {
    const run = activeRun();
    run.modelUsage.tasks = [];
    run.flow.lunaTasks = 0;
    run.flow.lunaAccepted = 0;
    run.flow.solTouches = 0;

    const result = analyzeScorecardReadiness(run);

    expect(result.readyForContinuedCapture).toBe(false);
    expect(result.rawCaptureGaps).toContain(
      'modelUsage.tasks has no observed task records despite recorded Run activity',
    );
  });

  it('detects drift between durable task records and flow counters', () => {
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
    expect(result.consistencyWarnings).toContain(
      'flow.solTouches=7 disagrees with modelUsage.tasks-derived 1',
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
    expect(result.rawCaptureGaps).toEqual([]);
    expect(result.consistencyWarnings).toEqual([]);
  });
});
