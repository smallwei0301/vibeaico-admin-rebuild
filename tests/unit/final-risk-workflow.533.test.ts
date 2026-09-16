import { describe, expect, it } from 'vitest';

import { changeDigestOf, routing } from '../../scripts/agents/astra-review-policy.mjs';
import {
  buildFinalRiskPacket,
  decideFinalRiskRecovery,
  evaluateFinalRiskReadiness,
  planFinalRiskReview,
} from '../../scripts/agents/final-risk-workflow.mjs';

const records = [
  { filename: 'src/server/payment/a.ts', previous_filename: '', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'src/server/payment/b.ts', previous_filename: '', status: 'modified', sha: '2'.repeat(40) },
];

const body = `
WORKSTREAM: PRODUCT_MAINLINE
ASTRA_RISK: PAYMENT_CONSISTENCY
ASTRA_TEST_BASELINE: local-payment-regression-42
ASTRA_SCHEMA_BASELINE: schema-main-42
`;

const baseInput = () => ({
  body,
  repository: 'smallwei0301/vibeaico-admin-rebuild',
  prNumber: 533,
  exactHead: 'a'.repeat(40),
  changeDigest: changeDigestOf(records),
  changedFileRecords: records,
  sourceFrozen: true,
  sourceCiStatus: 'PASS',
  testEvidenceStatus: 'PASS',
  coreRegressionStatus: 'PASS',
  policyVersion: routing.version,
  evidenceRefs: ['ci://42', 'test://payment-regression-42'],
  triageSummary: 'Payment state transition changed.\nReview concurrency and rollback.',
});

const deps = {
  preflightEvaluator: () => ({ valid: true, errors: [], metadata: {} }),
};

describe('Final Risk fail-early workflow (#533)', () => {
  it('fails before dispatch when source is not frozen', () => {
    const result = evaluateFinalRiskReadiness({ ...baseInput(), sourceFrozen: false }, deps);
    expect(result.ready).toBe(false);
    expect(result.nextAction).toBe('RETURN_TO_PRECHECK');
    expect(result.errors).toContain('source is not frozen');
  });

  it('fails before dispatch when metadata preflight is red', () => {
    const result = evaluateFinalRiskReadiness(baseInput(), {
      preflightEvaluator: () => ({ valid: false, errors: ['AMBIGUOUS_FIELD: LANE_STATE'] }),
    });
    expect(result.ready).toBe(false);
    expect(result.errors.join('\n')).toContain('AMBIGUOUS_FIELD');
  });

  it('fails before dispatch when changeDigest does not match changed blobs', () => {
    const result = evaluateFinalRiskReadiness({ ...baseInput(), changeDigest: 'f'.repeat(64) }, deps);
    expect(result.ready).toBe(false);
    expect(result.errors).toContain('changeDigest does not match changed-file blobs');
  });

  it('fails cheaply when the triage packet exceeds its bounded context', () => {
    const result = evaluateFinalRiskReadiness({
      ...baseInput(),
      triageSummary: Array.from({ length: 31 }, (_, i) => `line ${i}`).join('\n'),
    }, deps);
    expect(result.ready).toBe(false);
    expect(result.errors.join('\n')).toContain('exceeds 30 lines');
  });

  it('builds an initial FULL packet only after all cheap gates pass', () => {
    const result = buildFinalRiskPacket(baseInput(), deps);
    expect(result.ready).toBe(true);
    expect(result.reviewMode).toBe('FULL');
    expect(result.nextAction).toBe('DISPATCH_FINAL_RISK_REVIEWER');
    expect(result.packet?.scope.changedFiles).toEqual([
      'src/server/payment/a.ts',
      'src/server/payment/b.ts',
    ]);
  });
});

describe('Final Risk delta routing (#533)', () => {
  const previousReview = {
    verdict: 'FIX_REQUIRED',
    changeDigest: '9'.repeat(64),
    riskClass: 'PAYMENT_CONSISTENCY',
    policyVersion: routing.version,
    changedFiles: ['src/server/payment/a.ts', 'src/server/payment/b.ts'],
    findings: [
      { id: 'F1', paths: ['src/server/payment/a.ts'], summary: 'race window' },
    ],
    supportFiles: ['src/server/payment/b.ts'],
  };

  it('uses DELTA only for a finding fix inside the previously reviewed universe', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      changedFiles: ['src/server/payment/a.ts', 'src/server/payment/b.ts'],
      deltaFiles: ['src/server/payment/a.ts'],
      previousReview,
    });
    expect(result.mode).toBe('DELTA');
    expect(result.reason).toBe('FINDING_FIX_ONLY');
  });

  it('forces FULL reset when a new file enters the high-risk scope', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      changedFiles: [
        'src/server/payment/a.ts',
        'src/server/payment/b.ts',
        'src/server/payment/new-boundary.ts',
      ],
      deltaFiles: ['src/server/payment/new-boundary.ts'],
      previousReview,
    });
    expect(result.mode).toBe('FULL');
    expect(result.resetReasons.join('\n')).toContain('new changed-file scope');
  });

  it('forces FULL reset when the high-risk boundary expands', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      changedFiles: ['src/server/payment/a.ts', 'src/server/payment/b.ts'],
      deltaFiles: ['src/server/payment/a.ts'],
      previousReview,
      hotBoundaryExpanded: true,
    });
    expect(result.mode).toBe('FULL');
    expect(result.resetReasons).toContain('high-risk boundary expanded');
  });

  it('lets reviewer demand a FULL reset even when mechanical delta checks pass', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      changedFiles: ['src/server/payment/a.ts', 'src/server/payment/b.ts'],
      deltaFiles: ['src/server/payment/a.ts'],
      previousReview,
      reviewerRequestedFullReset: true,
    });
    expect(result.mode).toBe('FULL');
    expect(result.resetReasons).toContain('reviewer requested FULL reset');
  });

  it('reuses an existing PASS only when semantic digest is unchanged', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      changedFiles: ['src/server/payment/a.ts', 'src/server/payment/b.ts'],
      previousReview: {
        ...previousReview,
        verdict: 'PASS',
        changeDigest: baseInput().changeDigest,
      },
    });
    expect(result.mode).toBe('REUSE');
  });
});

describe('Final Risk circuit breaker fallback (#533)', () => {
  const allowed = ['claude-fable-5-1', 'gpt-6-astra'];

  it('allows exactly one cheap retry for the first transient failure', () => {
    const result = decideFinalRiskRecovery({
      failureClass: 'TIMEOUT',
      sameClassAttempts: 1,
      currentModel: 'claude-fable-5-1',
      allowedModels: allowed,
    });
    expect(result.action).toBe('RETRY_SAME_MODEL_ONCE');
  });

  it('switches reviewer model after the same transient failure happens twice', () => {
    const result = decideFinalRiskRecovery({
      failureClass: 'TIMEOUT',
      sameClassAttempts: 2,
      currentModel: 'claude-fable-5-1',
      attemptedModels: ['claude-fable-5-1'],
      allowedModels: allowed,
    });
    expect(result.breaker).toBe('OPEN_FOR_CURRENT_MODEL');
    expect(result.action).toBe('SWITCH_REVIEWER_MODEL');
    expect(result.nextModel).toBe('gpt-6-astra');
  });

  it('parks only the blocked candidate and refills BUILD when all reviewers are exhausted', () => {
    const result = decideFinalRiskRecovery({
      failureClass: 'MODEL_DISPATCH',
      sameClassAttempts: 2,
      currentModel: 'gpt-6-astra',
      attemptedModels: allowed,
      allowedModels: allowed,
      independentSliceAvailable: true,
    });
    expect(result.breaker).toBe('OPEN');
    expect(result.action).toBe('PARK_CURRENT_AND_REFILL_BUILD');
  });

  it('keeps closure/triage alive when there is no independent BUILD slice', () => {
    const result = decideFinalRiskRecovery({
      failureClass: 'SAFETY_CLASSIFIER',
      sameClassAttempts: 2,
      currentModel: 'gpt-6-astra',
      attemptedModels: allowed,
      allowedModels: allowed,
      independentSliceAvailable: false,
    });
    expect(result.breaker).toBe('OPEN');
    expect(result.action).toBe('PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
    expect(result.action).not.toContain('STOP');
  });

  it('treats a real reviewer finding as source work, not an infrastructure retry', () => {
    const result = decideFinalRiskRecovery({ failureClass: 'CONTENT_FINDING', sameClassAttempts: 5 });
    expect(result.action).toBe('RETURN_TO_SOURCE_FIX');
    expect(result.breaker).toBe('CLOSED');
  });

  it('returns invalid input to cheap precheck rather than spending reviewer attempts', () => {
    const result = decideFinalRiskRecovery({ failureClass: 'READINESS', sameClassAttempts: 9 });
    expect(result.action).toBe('RETURN_TO_PRECHECK');
  });
});
