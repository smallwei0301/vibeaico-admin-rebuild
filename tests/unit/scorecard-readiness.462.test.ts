import { describe, expect, it } from 'vitest';
import { createRunLedgerV2 } from '../../scripts/agents/run-ledger-v2.mjs';
import { analyzeScorecardReadiness } from '../../scripts/agents/scorecard-readiness.mjs';

function activeRun(): any {
  const run: any = createRunLedgerV2(
    '2026-09-15-readiness-test',
    '2026-09-15T00:00:00Z',
    { closeoutOwner: 'PRODUCT_MAIN_SESSION' },
  );
  run.flow.lunaTasks = 4;
  run.flow.lunaAccepted = 3;
  return run;
}

function fillLiveInputs(run: any): void {
  run.ci.firstPassRatePercent = 75;
  run.quality.acceptanceEvidenceCoveragePercent = 80;
  run.quality.auditFirstPassRatePercent = 90;
  run.flow.lunaDelegationRatePercent = 75;
  run.flow.waitTimeConvertedPercent = 50;
  run.auditability.evidenceFieldsCompletePercent = 95;
  run.auditability.exactHeadTestCoveragePercent = 85;
  run.auditability.preciseBlockersPercent = 100;
}

describe('scorecard live readiness (#462)', () => {
  it('shows actionable live-capture gaps while the Run is still IN_PROGRESS', () => {
    const result = analyzeScorecardReadiness(activeRun());

    expect(result.validLedger).toBe(true);
    expect(result.liveReadinessPercent).toBe(0);
    expect(result.liveCaptureMissing).toContain('ci.firstPassRatePercent');
    expect(result.liveCaptureMissing).toContain('quality.acceptanceEvidenceCoveragePercent');
    expect(result.terminalOnlyPending).toContain('endedAt');
    expect(result.consistencyWarnings).toContain(
      'flow.lunaDelegationRatePercent can already be derived as 75% from lunaAccepted/lunaTasks',
    );
  });

  it('separates live-capture gaps from normal closeout-only gaps', () => {
    const run = activeRun();
    fillLiveInputs(run);

    const result = analyzeScorecardReadiness(run);

    expect(result.liveReadinessPercent).toBe(100);
    expect(result.liveCaptureMissing).toEqual([]);
    expect(result.readyForCloseoutDataCapture).toBe(true);
    expect(result.closeoutDerivedMissing).toContain('modelUsage.weightedUsageImprovementPercent');
    expect(result.closeoutDerivedMissing).toContain('auditability.scoreInputsCompletePercent');
    expect(result.terminalOnlyPending).toContain('completionTruth.status');
  });

  it('detects a stored score-input completeness value that disagrees with observable inputs', () => {
    const run = activeRun();
    fillLiveInputs(run);
    run.modelUsage.weightedUsageImprovementPercent = 5;
    run.auditability.scoreInputsCompletePercent = 10;

    const result = analyzeScorecardReadiness(run);

    expect(result.expectedScoreInputsCompletePercent).toBe(100);
    expect(result.consistencyWarnings).toContain(
      'auditability.scoreInputsCompletePercent=10 disagrees with observable 100%',
    );
  });
});
