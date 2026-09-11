import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  CORE_METRIC_PATHS_V2,
  computeMetricDataQuality,
  evaluateGovernanceScoreboard,
  governanceContractVersionForRun,
  isGovernanceRun,
  renderGovernanceScoreboard,
  validateBlockingFindingReconciliation,
  validateReviewEvidence,
} from '../../scripts/metrics/governance-scoreboard.mjs';

const root = process.cwd();
const policy = JSON.parse(
  fs.readFileSync(path.join(root, 'docs/metrics/governance-scoreboard-policy.json'), 'utf8'),
);

function completeV2Run() {
  return {
    runId: '2026-09-12-governance-r01',
    status: 'COMPLETE',
    startedAt: '2026-09-12T00:00:00Z',
    closeout: { ownerRole: 'GOVERNANCE_MAIN_SESSION' },
    delivery: { cycleTimeMinutes: 60 },
    ci: { fullCiRuns: 1, invalidReruns: 0, firstPassRatePercent: 100 },
    quality: {
      acceptanceEvidenceCoveragePercent: 100,
      auditFirstPassRatePercent: 100,
      unresolvedP0: 0,
      unresolvedP1: 0,
      reopenedIssues: 0,
      postMergeRegressions: 0,
      safetyViolations: 0,
    },
    flow: {
      duplicateAgentTasks: 0,
      ownershipCollisions: 0,
      waitTimeConvertedPercent: 100,
    },
    auditability: {
      evidenceFieldsCompletePercent: 100,
      exactHeadTestCoveragePercent: 100,
      preciseBlockersPercent: 100,
      scoreInputsCompletePercent: 100,
    },
  };
}

const v2Review = (overrides: Record<string, unknown> = {}) => ({
  id: 'github:pr#378/review#1',
  subject: 'pr#378',
  role: 'GOVERNANCE_REVIEW',
  executionRef: 'github:pr#378/review#1',
  reviewedSha: 'a'.repeat(40),
  changeDigest: null,
  verdict: 'PASS',
  ...overrides,
});

const v2Evidence = (records: unknown[] = []) => ({
  contractVersion: 2,
  runId: '2026-09-12-governance-r01',
  records,
});

describe('Governance Scoreboard contract v2 activation', () => {
  it('makes the repository policy v2 and preserves the historical v1 boundary', () => {
    expect(policy.contractVersion).toBe(2);
    expect(policy.reviewEvidenceContractVersion).toBe(2);
    expect(policy.governanceReviewRole).toBe('GOVERNANCE_REVIEW');
    expect(Date.parse(policy.effectiveAt)).not.toBeNaN();
    expect(Date.parse(policy.historicalContracts['1'].effectiveAt)).not.toBeNaN();
    expect(policy.historicalRunsAreReadOnly).toBe(true);
  });

  it('uses exactly 17 model-neutral core metrics in v2', () => {
    expect(CORE_METRIC_PATHS_V2).toHaveLength(17);
    expect(CORE_METRIC_PATHS_V2).not.toContain('flow.solTouches');
    expect(CORE_METRIC_PATHS_V2).not.toContain('flow.solIssues');

    const run = completeV2Run();
    expect(computeMetricDataQuality(run, 2)).toEqual({
      present: 17,
      total: 17,
      missing: [],
      percent: 100,
    });
  });

  it('accepts v2 governance review evidence without model identity fields', () => {
    const evidence = v2Evidence([v2Review()]);
    expect(validateReviewEvidence(evidence)).toEqual([]);

    const withLegacyRole = v2Evidence([v2Review({ role: 'SOL_AUDIT' })]);
    expect(validateReviewEvidence(withLegacyRole).join('\n')).toContain('role is invalid for contract v2');
  });

  it('does not let duplicate executionRef inflate v2 review evidence', () => {
    const evidence = v2Evidence([
      v2Review(),
      v2Review({ id: 'github:pr#378/review#2' }),
    ]);
    expect(validateReviewEvidence(evidence).join('\n')).toContain('executionRef is duplicated');
  });

  it('ignores legacy Sol counters and model identity for v2 comparison eligibility', () => {
    const run = completeV2Run();
    Object.assign(run.flow, { solTouches: 99, solIssues: 99 });
    const evidence = v2Evidence([v2Review()]);
    const result = evaluateGovernanceScoreboard(run, evidence, policy, { enforce: true });

    expect(result.contractVersion).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.solFlowMismatch).toBeNull();
    expect(result.ledgerFlow).toBeNull();
    expect(result.comparisonEligible).toBe(true);

    const rendered = renderGovernanceScoreboard(run, result);
    expect(rendered).not.toContain('Sol flow');
    expect(rendered).not.toContain('Model review identity coverage');
    expect(rendered).not.toContain('provider verified');
    expect(rendered).toContain('Governance review evidence');
  });

  it('fails a new terminal v2 Run below the 95 percent data-quality floor', () => {
    const run = completeV2Run();
    run.quality.acceptanceEvidenceCoveragePercent = null as unknown as number;
    run.auditability.scoreInputsCompletePercent = 94.1;
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy, { enforce: true });

    expect(result.metricDataQuality).toMatchObject({ present: 16, total: 17, percent: 94.1 });
    expect(result.errors.join('\n')).toContain('below 95%');
    expect(result.comparisonEligible).toBe(false);
  });

  it('still requires blocking findings to reconcile to a final-head PASS', () => {
    const run = completeV2Run();
    const evidence: any = {
      ...v2Evidence(),
      finalReviewedSha: 'b'.repeat(40),
      records: [
        v2Review({
          id: 'github:pr#378/review#fix',
          executionRef: 'github:pr#378/review#fix',
          reviewedSha: 'a'.repeat(40),
          verdict: 'FIX_REQUIRED',
        }),
        v2Review({
          id: 'github:pr#378/review#pass',
          executionRef: 'github:pr#378/review#pass',
          reviewedSha: 'b'.repeat(40),
          verdict: 'PASS',
        }),
      ],
    };

    expect(validateBlockingFindingReconciliation(evidence).join('\n')).toContain('requires reconciliation');
    expect(evaluateGovernanceScoreboard(run, evidence, policy, { enforce: true }).errors.join('\n'))
      .toContain('requires reconciliation');

    evidence.records[0].reconciliation = {
      status: 'RESOLVED_ON_FINAL_HEAD',
      byRecordId: 'github:pr#378/review#pass',
    };
    const fixed = evaluateGovernanceScoreboard(run, evidence, policy, { enforce: true });
    expect(validateBlockingFindingReconciliation(evidence)).toEqual([]);
    expect(fixed.errors).toEqual([]);
    expect(fixed.comparisonEligible).toBe(true);
  });

  it('keeps Product Runs outside the Governance Scoreboard gate', () => {
    const run = {
      ...completeV2Run(),
      runId: '2026-09-12-product-delivery-r01',
      closeout: { ownerRole: 'PRODUCT_MAIN_SESSION' },
    };
    const result = evaluateGovernanceScoreboard(
      run,
      { contractVersion: 1, runId: run.runId, records: [] },
      policy,
      { enforce: true },
    );

    expect(isGovernanceRun(run)).toBe(false);
    expect(result.governanceRun).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.comparisonEligible).toBe(false);
    expect(renderGovernanceScoreboard(run, result)).toContain('Applicable: **NO**');
  });

  it('selects v1 for historical runs and v2 after the v2 effectiveAt', () => {
    const historical = {
      ...completeV2Run(),
      runId: '2026-09-10-governance-r01',
      startedAt: '2026-09-10T00:00:00Z',
    };
    expect(governanceContractVersionForRun(historical, policy)).toBe(1);
    expect(governanceContractVersionForRun(completeV2Run(), policy)).toBe(2);
    expect(computeMetricDataQuality(historical, 1).total).toBe(19);
  });

  it.each([undefined, '', 'not-a-date'])('fails closed for an invalid v2 startedAt: %s', (startedAt) => {
    const run = completeV2Run();
    (run as { startedAt?: string }).startedAt = startedAt;
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy, { enforce: true });
    expect(result.errors.join('\n')).toContain('terminal Run requires a valid startedAt timestamp');
    expect(result.comparisonEligible).toBe(false);
  });
});
