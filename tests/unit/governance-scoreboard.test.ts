import fs from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  computeMetricDataQuality,
  computeModelReviewMetrics,
  evaluateGovernanceScoreboard,
  validateReviewEvidence,
} from '../../scripts/metrics/governance-scoreboard.mjs';

const root = process.cwd();
const readJson = (file: string) => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));

function completeRun() {
  return {
    runId: '2026-09-10-governance-r01',
    status: 'COMPLETE',
    startedAt: '2026-09-10T00:00:00Z',
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
      solTouches: 0,
      solIssues: 0,
    },
    auditability: {
      evidenceFieldsCompletePercent: 100,
      exactHeadTestCoveragePercent: 100,
      preciseBlockersPercent: 100,
      scoreInputsCompletePercent: 100,
    },
  };
}

const emptyEvidence = (runId = '2026-09-10-governance-r01') => ({
  contractVersion: 1,
  runId,
  records: [],
});

const baseReview = {
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

describe('governance scoreboard model identity truth', () => {
  it('does not count actualModel=unknown as verified identity', () => {
    const evidence = {
      contractVersion: 1,
      runId: '2026-09-10-governance-r01',
      records: [{
        ...baseReview,
        actualModel: 'unknown',
        identityEvidence: 'UNKNOWN',
      }],
    };
    expect(validateReviewEvidence(evidence)).toEqual([]);
    expect(computeModelReviewMetrics(evidence)).toMatchObject({
      providerVerified: 0,
      operatorAttested: 0,
      identityUnknown: 1,
      modelReviewIdentityCoveragePercent: 0,
      assignedIdentityCoveragePercent: 0,
    });
  });

  it('keeps operator attestation separate from provider verification', () => {
    const evidence = { contractVersion: 1, runId: '2026-09-10-governance-r01', records: [baseReview] };
    expect(validateReviewEvidence(evidence)).toEqual([]);
    expect(computeModelReviewMetrics(evidence)).toMatchObject({
      providerVerified: 0,
      operatorAttested: 1,
      modelReviewIdentityCoveragePercent: 0,
      assignedIdentityCoveragePercent: 100,
    });
  });

  it('requires a provider execution reference before identity is provider-verified', () => {
    const invalid = {
      contractVersion: 1,
      runId: '2026-09-10-governance-r01',
      records: [{ ...baseReview, identityEvidence: 'PROVIDER_VERIFIED' }],
    };
    expect(validateReviewEvidence(invalid).join('\n')).toContain('providerExecutionRef is required');

    const valid = {
      contractVersion: 1,
      runId: '2026-09-10-governance-r01',
      records: [{
        ...baseReview,
        identityEvidence: 'PROVIDER_VERIFIED',
        providerExecutionRef: 'provider:execution:abc123',
      }],
    };
    expect(validateReviewEvidence(valid)).toEqual([]);
    expect(computeModelReviewMetrics(valid).modelReviewIdentityCoveragePercent).toBe(100);
  });

  it('rejects pretending unknown actual model is operator or provider verified', () => {
    const evidence = {
      contractVersion: 1,
      runId: '2026-09-10-governance-r01',
      records: [{ ...baseReview, actualModel: 'unknown' }],
    };
    expect(validateReviewEvidence(evidence).join('\n')).toContain('actualModel=unknown requires identityEvidence=UNKNOWN');
  });
});

describe('governance scoreboard flow and data quality', () => {
  const policy = readJson('docs/metrics/governance-scoreboard-policy.json');

  it('reconstructs the historical r01 Sol work instead of trusting ledger zeroes', () => {
    const run = readJson('docs/metrics/agent-runs/2026-09-09-governance-loop-r01.json');
    const evidence = readJson('docs/metrics/review-evidence/2026-09-09-governance-loop-r01.json');
    const result = evaluateGovernanceScoreboard(run, evidence, policy);

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
    expect(result.ledgerFlow).toEqual({ solTouches: 0, solIssues: 0 });
    expect(result.solFlowMismatch).toBe(true);
    expect(result.comparisonEligible).toBe(false);
  });

  it('allows a complete low-risk terminal Run with no unnecessary model review', () => {
    const run = completeRun();
    const result = evaluateGovernanceScoreboard(run, emptyEvidence(), policy, { enforce: true });
    expect(computeMetricDataQuality(run).percent).toBe(100);
    expect(result.errors).toEqual([]);
    expect(result.comparisonEligible).toBe(true);
  });

  it('fails a new terminal Run below the 95 percent data-quality floor', () => {
    const run = completeRun();
    run.quality.acceptanceEvidenceCoveragePercent = null as unknown as number;
    run.auditability.scoreInputsCompletePercent = 94.7;
    const result = evaluateGovernanceScoreboard(run, emptyEvidence(), policy, { enforce: true });
    expect(result.metricDataQuality.percent).toBe(94.7);
    expect(result.errors.join('\n')).toContain('below 95%');
  });

  it('fails a new terminal Run when ledger Sol counts disagree with durable reviews', () => {
    const run = completeRun();
    run.flow.solTouches = 1;
    run.flow.solIssues = 1;
    const result = evaluateGovernanceScoreboard(run, emptyEvidence(), policy, { enforce: true });
    expect(result.errors).toContain('terminal Run Sol flow must match durable review evidence');
  });

  it('guards every post-policy terminal Run committed to the repo', () => {
    const ledgerDir = path.join(root, 'docs/metrics/agent-runs');
    const evidenceDir = path.join(root, 'docs/metrics/review-evidence');
    const effectiveAt = Date.parse(policy.effectiveAt);

    for (const name of fs.readdirSync(ledgerDir).filter((item) => item.endsWith('.json'))) {
      const run = JSON.parse(fs.readFileSync(path.join(ledgerDir, name), 'utf8'));
      const terminal = run.status === 'COMPLETE' || run.status === 'OWNER_BLOCKED';
      if (!terminal || Date.parse(run.startedAt) < effectiveAt) continue;

      const evidencePath = path.join(evidenceDir, `${run.runId}.json`);
      expect(fs.existsSync(evidencePath), `${run.runId} must have durable review evidence`).toBe(true);
      const evidence = JSON.parse(fs.readFileSync(evidencePath, 'utf8'));
      const result = evaluateGovernanceScoreboard(run, evidence, policy, { enforce: true });
      expect(result.errors, `${run.runId}: ${result.errors.join('; ')}`).toEqual([]);
    }
  });
});
