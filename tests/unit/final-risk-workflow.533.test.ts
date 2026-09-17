import { describe, expect, it } from 'vitest';

import { changeDigestOf, routing } from '../../scripts/agents/astra-review-policy.mjs';
import {
  buildFinalRiskPacket,
  decideFinalRiskRecovery,
  evaluateFinalRiskReadiness,
  planFinalRiskReview,
  previousReviewFromCanonicalReviews,
} from '../../scripts/agents/final-risk-workflow.mjs';

const records = [
  { filename: 'src/server/payment/a.ts', previous_filename: '', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'src/server/payment/b.ts', previous_filename: '', status: 'modified', sha: '2'.repeat(40) },
];
const previousRecords = [
  { ...records[0], sha: '3'.repeat(40) },
  records[1],
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

const previousReview = {
  verdict: 'FIX_REQUIRED',
  changeDigest: changeDigestOf(previousRecords),
  riskClass: 'PAYMENT_CONSISTENCY',
  policyVersion: routing.version,
  changedFileRecords: previousRecords,
  findingDetails: [
    { id: 'F1', paths: ['src/server/payment/a.ts'], summary: 'race window' },
  ],
  supportFiles: ['src/server/payment/b.ts'],
};

function canonicalReview(overrides: Record<string, unknown> = {}, submittedAt = '2026-09-16T01:00:00Z') {
  const payload = {
    repository: baseInput().repository,
    baseSha: 'b'.repeat(40),
    headSha: 'c'.repeat(40),
    changeDigest: changeDigestOf(previousRecords),
    policyVersion: routing.version,
    testBaseline: 'prior test baseline passed',
    schemaBaseline: 'prior schema baseline matched',
    requestedModel: routing.models.finalRisk,
    actualModel: routing.models.finalRisk,
    identityEvidence: 'OPERATOR_ATTESTED',
    verdict: 'FIX_REQUIRED',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/533',
    findings: 'F1: race window must be fixed',
    riskClass: 'PAYMENT_CONSISTENCY',
    changedFileRecords: previousRecords,
    findingDetails: [{ id: 'F1', paths: ['src/server/payment/a.ts'], summary: 'race window' }],
    supportFiles: ['src/server/payment/b.ts'],
    ...overrides,
  };
  return {
    trusted: true,
    state: 'COMMENTED',
    commit_id: 'c'.repeat(40),
    submitted_at: submittedAt,
    id: Number(submittedAt.replace(/\D/g, '').slice(-8)) || 1,
    body: `\`\`\`astra-review\n${JSON.stringify(payload)}\n\`\`\``,
  };
}

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
    expect('reviewMode' in result && result.reviewMode).toBe('FULL');
    expect(result.packet?.scope.changedFiles).toEqual([
      'src/server/payment/a.ts',
      'src/server/payment/b.ts',
    ]);
    expect(result.packet?.attestationPersistence.copyExactly.changedFileRecords).toEqual(records);
  });
});

describe('Final Risk delta routing (#533)', () => {
  it('uses DELTA only for a blob-derived finding fix inside the previously reviewed universe', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      deltaFiles: ['src/server/payment/a.ts'],
      previousReview,
    });
    expect(result.mode).toBe('DELTA');
    expect(result.deltaFiles).toEqual(['src/server/payment/a.ts']);
  });

  it('does not reset merely because GitHub returns the same file universe in another order', () => {
    const result = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      previousReview: { ...previousReview, changedFileRecords: [...previousRecords].reverse() },
    });
    expect(result.mode).toBe('DELTA');
  });

  it('forces FULL reset when caller under-reports the blob-derived delta', () => {
    const result = planFinalRiskReview({ ...baseInput(), riskClass: 'PAYMENT_CONSISTENCY', deltaFiles: ['src/server/payment/b.ts'], previousReview });
    expect(result.mode).toBe('FULL');
    expect(result.resetReasons).toContain('declared delta does not match blob-derived delta');
  });

  it('forces FULL reset when a new file enters the high-risk scope', () => {
    const expandedRecords = [...records, { filename: 'src/server/payment/new-boundary.ts', previous_filename: '', status: 'added', sha: '4'.repeat(40) }];
    const result = planFinalRiskReview({ ...baseInput(), riskClass: 'PAYMENT_CONSISTENCY', changedFileRecords: expandedRecords, previousReview });
    expect(result.mode).toBe('FULL');
    expect(result.resetReasons).toContain('changed-file universe changed');
  });

  it('forces FULL reset when the high-risk boundary expands or reviewer asks for it', () => {
    const boundary = planFinalRiskReview({ ...baseInput(), riskClass: 'PAYMENT_CONSISTENCY', previousReview, hotBoundaryExpanded: true });
    const reviewer = planFinalRiskReview({ ...baseInput(), riskClass: 'PAYMENT_CONSISTENCY', previousReview, reviewerRequestedFullReset: true });
    expect(boundary.resetReasons).toContain('high-risk boundary expanded');
    expect(reviewer.resetReasons).toContain('reviewer requested FULL reset');
  });

  it('reuses PASS only when digest, risk and policy are unchanged', () => {
    const reused = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      previousReview: { ...previousReview, verdict: 'PASS', changeDigest: baseInput().changeDigest },
    });
    const stale = planFinalRiskReview({
      ...baseInput(),
      riskClass: 'PAYMENT_CONSISTENCY',
      previousReview: { ...previousReview, verdict: 'PASS', changeDigest: baseInput().changeDigest, policyVersion: 'older-policy' },
    });
    expect(reused.mode).toBe('REUSE');
    expect(stale.mode).toBe('FULL');
  });
});

describe('Final Risk canonical handoff persistence (#533)', () => {
  it('reconstructs DELTA eligibility from a trusted GitHub astra-review after session handoff', () => {
    const review = canonicalReview();
    const restored = previousReviewFromCanonicalReviews([review], baseInput().repository);
    expect(restored?.canonicalTrustEligible).toBe(true);
    expect(restored?.changedFileRecords).toEqual(previousRecords);
    expect(restored?.findingDetails[0].paths).toEqual(['src/server/payment/a.ts']);

    const result = buildFinalRiskPacket({ ...baseInput(), reviews: [review] }, deps);
    expect('reviewMode' in result && result.reviewMode).toBe('DELTA');
    expect('previousReviewSource' in result && result.previousReviewSource).toBe('CANONICAL_GITHUB_REVIEW');
    expect(result.packet?.scope.deltaFiles).toEqual(['src/server/payment/a.ts']);
  });

  it('fails closed to FULL when legacy review lacks structured manifest/finding evidence', () => {
    const review = canonicalReview({ changedFileRecords: undefined, findingDetails: undefined, supportFiles: undefined });
    const result = buildFinalRiskPacket({ ...baseInput(), reviews: [review] }, deps);
    expect('reviewMode' in result && result.reviewMode).toBe('FULL');
    expect('plan' in result && result.plan.resetReasons).toContain('previous reviewed blob manifest is unavailable or invalid');
  });

  it('does not use an older good review when the newest canonical review is ineligible', () => {
    const older = canonicalReview({}, '2026-09-16T01:00:00Z');
    const newest = canonicalReview({ actualModel: 'untrusted-reviewer' }, '2026-09-16T01:05:00Z');
    const restored = previousReviewFromCanonicalReviews([older, newest], baseInput().repository);
    expect(restored?.canonicalTrustEligible).toBe(false);
    const result = buildFinalRiskPacket({ ...baseInput(), reviews: [older, newest] }, deps);
    expect('reviewMode' in result && result.reviewMode).toBe('FULL');
    expect('plan' in result && result.plan.resetReasons).toContain('previous canonical review is not eligible for semantic reuse');
  });
});

describe('Final Risk circuit breaker fallback (#533)', () => {
  const allowed = ['claude-fable-5-1', 'gpt-6-astra'];

  it('downgrades on the first fault without retrying either premium model', () => {
    const first = decideFinalRiskRecovery({ failureClass: 'TIMEOUT', sameClassAttempts: 1, currentModel: 'claude-fable-5-1', allowedModels: allowed });
    const second = decideFinalRiskRecovery({ failureClass: 'TIMEOUT', sameClassAttempts: 2, currentModel: 'claude-fable-5-1', attemptedModels: ['claude-fable-5-1'], allowedModels: allowed });
    expect(first.action).toBe('DOWNGRADE_REVIEWER_MODEL');
    expect(second.action).toBe('DOWNGRADE_REVIEWER_MODEL');
    expect(first.nextModel).toBe('gpt-5.6-sol');
    expect(second.nextModel).toBe('gpt-5.6-sol');
  });

  it('parks only the blocked candidate and keeps the loop productive after reviewer paths are exhausted', () => {
    const refill = decideFinalRiskRecovery({ failureClass: 'MODEL_DISPATCH', sameClassAttempts: 2, currentModel: 'gpt-6-astra', attemptedModels: [...allowed, 'gpt-5.6-sol', 'claude-opus-5'], independentSliceAvailable: true });
    const closure = decideFinalRiskRecovery({ failureClass: 'SAFETY_CLASSIFIER', sameClassAttempts: 2, currentModel: 'gpt-6-astra', attemptedModels: [...allowed, 'gpt-5.6-sol', 'claude-opus-5'], independentSliceAvailable: false });
    expect(refill.action).toBe('PARK_CURRENT_AND_REFILL_BUILD');
    expect(closure.action).toBe('PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
    expect(closure.action).not.toContain('STOP');
  });

  it('routes real findings and cheap precheck failures without spending infrastructure retries', () => {
    expect(decideFinalRiskRecovery({ failureClass: 'CONTENT_FINDING', sameClassAttempts: 5 }).action).toBe('RETURN_TO_SOURCE_FIX');
    expect(decideFinalRiskRecovery({ failureClass: 'READINESS', sameClassAttempts: 9 }).action).toBe('RETURN_TO_PRECHECK');
  });
});
