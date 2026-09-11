import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeGovernanceReviewMetrics,
  computeMetricDataQuality,
  computeModelReviewMetrics,
  evaluateGovernanceScoreboard,
  renderGovernanceScoreboard,
  validateBlockingFindingReconciliation,
  validateReviewEvidence,
} from '../../scripts/metrics/governance-scoreboard.mjs';

const root = process.cwd();
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const policy = readJson('docs/metrics/governance-scoreboard-policy.json');

function completeRun(overrides: Record<string, unknown> = {}) {
  return {
    runId: '2026-09-11-governance-r01',
    status: 'COMPLETE',
    startedAt: '2026-09-11T06:00:00Z',
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
      solTouches: null,
      solIssues: null,
    },
    auditability: {
      evidenceFieldsCompletePercent: 100,
      exactHeadTestCoveragePercent: 100,
      preciseBlockersPercent: 100,
      scoreInputsCompletePercent: 100,
    },
    ...overrides,
  };
}

const v2Evidence = (runId = '2026-09-11-governance-r01') => ({
  contractVersion: 2,
  runId,
  records: [],
});

const legacyBaseReview = {
  id: 'github:pr#999/review#1',
  subject: 'pr#999',
  role: 'FINAL_RISK',
  requestedModel: 'gpt-6-astra',
  actualModel: 'gpt-6-astra',
  identityEvidence: 'OPERATOR_ATTESTED',
  executionRef: 'github:pr#999/review#1',
  providerExecutionRef: null,
  reviewedSha: 'a'.repeat(40),
  changeDigest: null,
  verdict: 'PASS',
};

const governanceReview = (overrides: Record<string, unknown> = {}) => ({
  id: 'github:pr#363/review#1',
  subject: 'pr#363',
  role: 'GOVERNANCE_REVIEW',
  executionRef: 'github:pr#363/review#1',
  reviewedSha: 'a'.repeat(40),
  changeDigest: null,
  verdict: 'PASS',
  ...overrides,
});

describe('historical Governance Scoreboard v1 remains reproducible', () => {
  it('keeps legacy model identity validation for old evidence only', () => {
    const evidence = {
      contractVersion: 1,
      runId: 'legacy-run',
      records: [{ ...legacyBaseReview, actualModel: 'unknown', identityEvidence: 'UNKNOWN' }],
    };
    expect(validateReviewEvidence(evidence)).toEqual([]);
    expect(computeModelReviewMetrics(evidence)).toMatchObject({
      providerVerified: 0,
      operatorAttested: 0,
      identityUnknown: 1,
      modelReviewIdentityCoveragePercent: 0,
    });
  });

  it('still requires provider execution reference for historical PROVIDER_VERIFIED evidence', () => {
    const invalid = {
      contractVersion: 1,
      runId: 'legacy-run',
      records: [{ ...legacyBaseReview, identityEvidence: 'PROVIDER_VERIFIED' }],
    };
    expect(validateReviewEvidence(invalid).join('\n')).toContain('providerExecutionRef is required');
  });

  it('reconstructs historical r01 without rewriting its 19-field baseline', () => {
    const run = readJson('docs/metrics/agent-runs/2026-09-09-governance-loop-r01.json');
    const evidence = readJson('docs/metrics/review-evidence/2026-09-09-governance-loop-r01.json');
    const result = evaluateGovernanceScoreboard(run, evidence, policy);

    expect(result.contractVersion).toBe(1);
    expect(validateReviewEvidence(evidence)).toEqual([]);
    expect(result.reviews).toMatchObject({
      totalReviews: 6,
      solTouches: 4,
      solSubjects: 2,
      finalRiskTouches: 2,
      providerVerified: 0,
      operatorAttested: 2,
      identityUnknown: 4,
    });
    expect(result.metricDataQuality).toMatchObject({ present: 13, total: 19, percent: 68.4 });
    expect(result.legacyFlow).toEqual({ solTouches: 0, solIssues: 0 });
    expect(result.legacyFlowMismatch).toBe(true);
    expect(result.comparisonEligible).toBe(false);
  });
});

describe('Governance Scoreboard v2 is model-agnostic', () => {
  it('accepts governance review evidence with no model identity fields', () => {
    const evidence = {
      contractVersion: 2,
      runId: '2026-09-11-governance-r01',
      records: [governanceReview()],
    };
    expect(validateReviewEvidence(evidence)).toEqual([]);
    expect(computeGovernanceReviewMetrics(evidence)).toEqual({
      totalReviews: 1,
      uniqueSubjects: 1,
      blockingReviews: 0,
      passReviews: 1,
      pendingReviews: 0,
    });
  });

  it('does not allow a model-specific legacy review role in v2 evidence', () => {
    const evidence = {
      contractVersion: 2,
      runId: '2026-09-11-governance-r01',
      records: [governanceReview({ role: 'SOL_AUDIT' })],
    };
    expect(validateReviewEvidence(evidence).join('\n')).toContain('role must be GOVERNANCE_REVIEW');
  });

  it('rejects duplicate executionRef and never lets it inflate governance review counts', () => {
    const evidence = {
      contractVersion: 2,
      runId: '2026-09-11-governance-r01',
      records: [
        governanceReview(),
        governanceReview({ id: 'github:pr#363/review#2', reviewedSha: 'b'.repeat(40) }),
      ],
    };
    expect(validateReviewEvidence(evidence).join('\n')).toContain('executionRef is duplicated');
    expect(computeGovernanceReviewMetrics(evidence).totalReviews).toBe(1);
  });

  it('uses 17 model-neutral core metrics and ignores legacy Sol flow fields', () => {
    const run = completeRun();
    expect(computeMetricDataQuality(run, 2)).toMatchObject({ present: 17, total: 17, percent: 100 });
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy, { enforce: true });
    expect(result.contractVersion).toBe(2);
    expect(result.errors).toEqual([]);
    expect(result.comparisonEligible).toBe(true);
  });

  it('renders no governance model identity or Sol utilization analysis in v2', () => {
    const run = completeRun();
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy);
    const rendered = renderGovernanceScoreboard(run, result);
    expect(rendered).toContain('v2 model-agnostic governance');
    expect(rendered).toContain('Review evidence records');
    expect(rendered).not.toContain('provider verified');
    expect(rendered).not.toContain('Assigned/attested');
    expect(rendered).not.toContain('Sol flow');
    expect(rendered).not.toContain('Final Risk touches');
  });

  it('requires evidence contract v2 for post-policy terminal governance runs', () => {
    const legacyEvidence = { contractVersion: 1, runId: '2026-09-11-governance-r01', records: [] };
    const result = evaluateGovernanceScoreboard(completeRun(), legacyEvidence, policy, { enforce: true });
    expect(result.errors.join('\n')).toContain('requires review evidence contractVersion 2');
    expect(result.comparisonEligible).toBe(false);
  });
});

describe('Governance Scoreboard v2 blocking finding reconciliation', () => {
  function blockingEvidence(): any {
    return {
      contractVersion: 2,
      runId: '2026-09-11-governance-r01',
      finalReviewedSha: 'b'.repeat(40),
      records: [
        governanceReview({
          id: 'github:pr#363/review#fix',
          executionRef: 'github:pr#363/review#fix',
          reviewedSha: 'a'.repeat(40),
          verdict: 'FIX_REQUIRED',
        }),
        governanceReview({
          id: 'github:pr#363/review#pass',
          executionRef: 'github:pr#363/review#pass',
          reviewedSha: 'b'.repeat(40),
          verdict: 'PASS',
        }),
      ],
    };
  }

  it('fails terminal closeout when an ancestor FIX_REQUIRED was never reconciled', () => {
    const evidence = blockingEvidence();
    const result = evaluateGovernanceScoreboard(completeRun(), evidence, policy, { enforce: true });
    expect(validateBlockingFindingReconciliation(evidence).join('\n')).toContain('requires reconciliation');
    expect(result.errors.join('\n')).toContain('requires reconciliation');
    expect(result.comparisonEligible).toBe(false);
  });

  it('does not accept a PASS on an intermediate head as final-head reconciliation', () => {
    const evidence = blockingEvidence();
    evidence.finalReviewedSha = 'c'.repeat(40);
    evidence.records[0].reconciliation = {
      status: 'RESOLVED_ON_FINAL_HEAD',
      byRecordId: 'github:pr#363/review#pass',
    };
    expect(validateBlockingFindingReconciliation(evidence).join('\n')).toContain('final reviewed head');
  });

  it('allows closeout after the blocker points to a final-head PASS of the same role', () => {
    const evidence = blockingEvidence();
    evidence.records[0].reconciliation = {
      status: 'RESOLVED_ON_FINAL_HEAD',
      byRecordId: 'github:pr#363/review#pass',
    };
    expect(validateBlockingFindingReconciliation(evidence)).toEqual([]);
    const result = evaluateGovernanceScoreboard(completeRun(), evidence, policy, { enforce: true });
    expect(result.errors).toEqual([]);
    expect(result.comparisonEligible).toBe(true);
  });
});

describe('Governance Scoreboard v2 data quality and fail-closed timestamps', () => {
  it('fails a new terminal Run below the 95 percent data-quality floor', () => {
    const run: any = completeRun();
    run.quality.acceptanceEvidenceCoveragePercent = null;
    run.auditability.scoreInputsCompletePercent = 94.1;
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy, { enforce: true });
    expect(result.metricDataQuality).toMatchObject({ present: 16, total: 17, percent: 94.1 });
    expect(result.errors.join('\n')).toContain('below 95%');
  });

  it('marks a mismatched score-input completeness as not comparable', () => {
    const run: any = completeRun();
    run.auditability.scoreInputsCompletePercent = 0;
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy);
    expect(result.comparisonEligible).toBe(false);
    expect(result.comparisonErrors.join('\n')).toContain('must equal computed 100');
  });

  it.each([undefined, '', 'not-a-date'])('fails closed when terminal startedAt is invalid: %s', (startedAt) => {
    const run: any = completeRun();
    run.startedAt = startedAt;
    const result = evaluateGovernanceScoreboard(run, v2Evidence(), policy, { enforce: true });
    expect(result.errors.join('\n')).toContain('terminal Run requires a valid startedAt timestamp');
    expect(result.comparisonEligible).toBe(false);
  });

  it('guards every post-v2-policy terminal Run committed to the repo', () => {
    const ledgerDir = path.join(root, 'docs/metrics/agent-runs');
    const evidenceDir = path.join(root, 'docs/metrics/review-evidence');
    const effectiveAt = Date.parse(policy.effectiveAt);

    for (const name of fs.readdirSync(ledgerDir).filter((item) => item.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(ledgerDir, name), 'utf8'));
      const terminal = run.status === 'COMPLETE' || run.status === 'OWNER_BLOCKED';
      if (!terminal || !Number.isFinite(Date.parse(run.startedAt)) || Date.parse(run.startedAt) < effectiveAt) continue;

      const evidencePath = path.join(evidenceDir, `${run.runId}.json`);
      expect(fs.existsSync(evidencePath), `${run.runId} must have durable review evidence`).toBe(true);
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      expect(evidence.contractVersion, `${run.runId} must use governance evidence contract v2`).toBe(2);
      const result = evaluateGovernanceScoreboard(run, evidence, policy, { enforce: true });
      expect(result.errors, `${run.runId}: ${result.errors.join('; ')}`).toEqual([]);
    }
  });
});
