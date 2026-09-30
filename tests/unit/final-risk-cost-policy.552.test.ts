import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { premiumExecutionState, selectFinalRiskReviewer, finalRiskReviewerErrors,
  FINAL_RISK_COST_POLICY_VERSION } from '../../scripts/agents/final-risk-cost-policy.mjs';
import { evaluateAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { decideFinalRiskRecovery, previousReviewFromCanonicalReviews } from '../../scripts/agents/final-risk-workflow.mjs';
import { evaluateReleasePreflight, releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbFinalRiskEvidence } from '../../scripts/agents/production-db-final-risk-evidence.mjs';

// Fixtures are not claims that a model was run or a real release was admitted.
const ref = 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/552';
const start = '2026-09-17T01:00:00Z';
const dispatch = { requestedAt: start, executionRef: 'fixture-execution-552' };
const history = { historyVerified: true, historyEvidenceRef: ref, reviewLineage: 'vibeaico-admin-rebuild#552', modelSelectionAvailable: true };
const audit = () => ({ reviewerTier: 'AUDIT', requestedModel: 'gpt-5.6-sol', actualModel: 'gpt-5.6-sol',
  identityEvidence: 'OPERATOR_ATTESTED', costPolicyVersion: FINAL_RISK_COST_POLICY_VERSION,
  downgradeReason: 'PREMIUM_REVIEW_COMPLETED', downgradeEvidenceRef: ref,
  reviewLineage: history.reviewLineage, executionRef: 'fixture-audit-execution-552',
  adversarialEvidence: 'Fixture counterexamples: stale digest, missing proof, unresolved finding all rejected',
  priorFindingsReviewed: true, unresolvedFindingCount: 0 });
const current = () => ({ ...audit(), reviewerTier: 'CURRENT_AGENT', requestedModel: 'not_requested', actualModel: 'unknown',
  identityEvidence: 'UNKNOWN', executionEvidence: 'OPERATOR_ATTESTED', modelSelectionAvailable: false,
  downgradeReason: 'MODEL_SELECTION_UNAVAILABLE' });
const fallback = () => ({ ...audit(), reviewerTier: 'EVIDENCE_FALLBACK', requestedModel: 'gpt-6.1-sol',
  repository: 'smallwei0301/vibeaico-admin-rebuild',
  actualModel: 'unknown', identityEvidence: 'UNKNOWN', executionEvidence: 'OPERATOR_ATTESTED',
  fallbackPolicyVersion: '2026-09-30.1', failureClass: 'IDENTITY_UNAVAILABLE',
  failureEvidenceRef: ref, failureDiagnosis: 'Fixture dispatch executed; runtime exposes no independent model identity',
  replacementReviewRef: ref, playbookEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/blob/main/docs/AGENT-PLAYBOOK.md#pb-031',
  downgradeReason: 'REVIEWER_INFRASTRUCTURE_FAILURE' });
const context = { repository: 'smallwei0301/vibeaico-admin-rebuild', createdAt: start,
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), changeDigest: 'c'.repeat(64),
  policyVersion: routing.version, testBaseline: 'Fixture source tests passed', schemaBaseline: 'Fixture schema unchanged' };
const body = 'WORKSTREAM: PRODUCT_MAINLINE\nAGENT_LANE: TERRA_BUILD\nASTRA_RISK: PAYMENT_CONSISTENCY\nASTRA_RATIONALE: Synthetic payment boundary fixture\nFINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION';
const evaluate = (reviewer = {}, extra = {}, trusted = true) => evaluateAstra({ body, changedFiles: ['src/server/payment/fixture.ts'], context,
  reviews: [{ trusted, id: 552, state: 'COMMENTED', commit_id: context.headSha, submitted_at: start,
    body: '```astra-review\n' + JSON.stringify({ ...context, ...reviewer, report: ref, findings: 'Synthetic findings reconciled', verdict: 'PASS', ...extra }) + '\n```' }] });

describe('Owner #552 startup timeout is exactly 300 seconds without execution proof', () => {
  it('waits before 300 seconds and downgrades at the boundary', () => {
    assert.equal(premiumExecutionState(dispatch, '2026-09-17T01:04:59Z').state, 'WAITING');
    assert.equal(premiumExecutionState(dispatch, '2026-09-17T01:05:00Z').state, 'START_TIMEOUT');
    assert.equal(selectFinalRiskReviewer({ ...history, dispatch, now: '2026-09-17T01:05:00Z' }, routing).action, 'DOWNGRADE_REVIEWER_MODEL');
  });
  for (const event of ['QUEUED', 'ACCEPTED', 'AGENT_SAYS_RUNNING']) {
    it(`does not treat ${event} as executing`, () => {
      assert.equal(premiumExecutionState({ ...dispatch, runningEvidence: { event, executionRef: dispatch.executionRef,
        observedAt: '2026-09-17T01:00:01Z', evidenceRef: ref } }, '2026-09-17T01:05:00Z').state, 'START_TIMEOUT');
    });
  }
  it('does not impose a five-minute total review limit on proven execution', () => {
    const running = { ...dispatch, runningEvidence: { event: 'TOKEN_GENERATED', executionRef: dispatch.executionRef,
      observedAt: '2026-09-17T01:00:03Z', evidenceRef: ref } };
    assert.equal(premiumExecutionState(running, '2026-09-17T01:10:00Z').state, 'RUNNING');
    assert.equal(selectFinalRiskReviewer({ ...history, dispatch: running, now: '2026-09-17T01:10:00Z' }, routing).action, 'CONTINUE_EXISTING_REVIEW');
  });
  it('rejects wrong execution id, late/future proof and malformed start time', () => {
    for (const [executionRef, observedAt] of [['other-task', '2026-09-17T01:00:01Z'], [dispatch.executionRef, '2026-09-17T01:05:01Z'], [dispatch.executionRef, '2026-09-17T02:00:00Z']]) {
      assert.equal(premiumExecutionState({ ...dispatch, runningEvidence: { event: 'RUNNING', executionRef, observedAt, evidenceRef: ref } }, '2026-09-17T01:05:00Z').state, 'START_TIMEOUT');
    }
    assert.equal(premiumExecutionState({ ...dispatch, requestedAt: 'unknown' }, start).state, 'INVALID_EXECUTION_EVIDENCE');
  });
});

describe('Owner #552 single premium consultation and immediate downgrade', () => {
  it('requires durable empty history before reserving the first premium consultation', () => {
    assert.equal(selectFinalRiskReviewer(history, routing).action, 'RESERVE_ONE_PREMIUM_CONSULTATION');
    assert.equal(selectFinalRiskReviewer({}, routing).nextModel, 'gpt-6.1-sol');
    assert.equal(selectFinalRiskReviewer({ ...history, historyVerified: false }, routing).reason, 'HISTORY_UNAVAILABLE');
  });
  it('does not reset the budget for source fixes, a new digest, or session changes', () => {
    for (const snapshot of [{ previousPremiumReview: true }, { previousReview: { verdict: 'FIX_REQUIRED' } },
      { attemptedModels: ['claude-fable-5-1'] }, { premiumAttempts: [{ executionRef: 'historical-attempt' }] }]) {
      const result = selectFinalRiskReviewer({ ...history, ...snapshot, changeDigest: 'd'.repeat(64), session: 'new' }, routing);
      assert.equal(result.action, 'DOWNGRADE_REVIEWER_MODEL');
      assert.equal(result.nextModel, 'gpt-6.1-sol');
      assert.equal(result.premiumRetryAllowed, false);
    }
  });
  for (const failureClass of ['TIMEOUT', 'MODEL_DISPATCH', 'RATE_LIMIT', 'TOOLING', 'ENVIRONMENT']) {
    it(`downgrades the first ${failureClass}, never Fable to Astra`, () => {
      const result = decideFinalRiskRecovery({ failureClass, sameClassAttempts: 1, currentModel: 'claude-fable-5-1' });
      assert.equal(result.action, 'DOWNGRADE_REVIEWER_MODEL');
      assert.equal(result.nextModel, 'gpt-6.1-sol');
    });
  }
  it('uses Opus when Sol is unavailable, current agent only when selector is unavailable', () => {
    assert.equal(selectFinalRiskReviewer({ premiumUnavailable: true, availableModels: ['claude-opus-5'] }, routing).nextModel, 'claude-opus-5');
    assert.equal(selectFinalRiskReviewer({ modelSelectionAvailable: false }, routing).action, 'REVIEW_WITH_CURRENT_AGENT');
    assert.equal(selectFinalRiskReviewer({ premiumUnavailable: true, availableModels: [] }, routing).action, 'PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
  });
  it('returns findings to source repair, never turns a failed review into PASS', () => {
    const result = decideFinalRiskRecovery({ failureClass: 'CONTENT_FINDING' });
    assert.equal(result.action, 'RETURN_TO_SOURCE_FIX');
    assert.equal(result.nextReviewTier, 'AUDIT_OR_CURRENT_AGENT');
  });
  it('does not use downgrade to evade a real safety refusal', () => {
    assert.equal(selectFinalRiskReviewer({ failureClass: 'SAFETY_CLASSIFIER', modelSelectionAvailable: false }, routing).reviewerTier, 'NONE');
  });
});

describe('WIP admission remains evidence-bound with cheaper reviewers', () => {
  for (const reviewer of [audit(), { ...audit(), requestedModel: 'gpt-6.1-sol', actualModel: 'gpt-6.1-sol' },
    { ...audit(), requestedModel: 'claude-opus-5-5', actualModel: 'claude-opus-5-5' }, { ...audit(), requestedModel: 'claude-opus-5', actualModel: 'claude-opus-5' }, current()]) {
    it(`accepts a truthful ${reviewer.reviewerTier}/${reviewer.actualModel} adversarial review`, () => {
      assert.deepEqual(finalRiskReviewerErrors(reviewer, routing), []);
      assert.equal(evaluate(reviewer).status, 'ASTRA_APPROVED');
    });
  }
  for (const patch of [{ adversarialEvidence: '' }, { downgradeEvidenceRef: 'unknown' }, { downgradeReason: 'because cheap' },
    { costPolicyVersion: 'old' }, { priorFindingsReviewed: false }, { unresolvedFindingCount: 1 },
    { actualModel: 'gpt-5.6-terra' }, { executionRef: '' }, { reviewerTier: 'INVENTED' }]) {
    it(`rejects incomplete/unresolved downgrade ${JSON.stringify(patch)}`, () => {
      assert.equal(evaluate({ ...audit(), ...patch }).status, 'ASTRA_PENDING');
    });
  }
  it('does not add Sol to the unconditional premium allowlist', () => {
    assert.equal(evaluate({ requestedModel: 'gpt-5.6-sol', actualModel: 'gpt-5.6-sol', identityEvidence: 'OPERATOR_ATTESTED' }).status, 'ASTRA_PENDING');
  });
  it('keeps digest, verdict and trusted author checks after downgrade', () => {
    assert.equal(evaluate(audit(), { changeDigest: 'd'.repeat(64) }).status, 'ASTRA_PENDING');
    assert.equal(evaluate(audit(), { verdict: 'FIX_REQUIRED' }).status, 'ASTRA_PENDING');
    assert.equal(evaluate(audit(), {}, false).status, 'ASTRA_PENDING');
  });
  it('unknown current model is not misreported as a verified identity', () => {
    assert.equal(evaluate({ ...current(), identityEvidence: 'OPERATOR_ATTESTED' }).status, 'ASTRA_PENDING');
    assert.equal(evaluate({ ...current(), modelSelectionAvailable: true }).status, 'ASTRA_PENDING');
    assert.equal(evaluate({ ...current(), executionEvidence: 'UNKNOWN' }).status, 'ASTRA_PENDING');
  });
  it('preserves valid existing premium PASS without forcing another consultation', () => {
    assert.equal(evaluate({ requestedModel: 'gpt-6-astra', actualModel: 'gpt-6-astra', identityEvidence: 'OPERATOR_ATTESTED' }).status, 'ASTRA_APPROVED');
  });
});

describe('DB release uses the same downgrade gate without granting DB write permission', () => {
  const packet = () => {
    const identity = { mainSha: 'a'.repeat(40), planDigest: 'b'.repeat(64) };
    const value = { schemaVersion: 1, releaseId: 'fixture-release-552', repository: context.repository,
      productionProjectRef: 'egehnijjpgijmccagxac', ...identity, riskTier: 'ADDITIVE',
      source: { ...identity, status: 'SOURCE_VERIFIED', databaseMutationAuthorized: false },
      consistency: { ...identity, status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: start },
      test: { ...identity, status: 'TEST_VERIFIED', policySkip: false, executedTests: 5, cleanup: 'PASSED' },
      recovery: { status: 'RECOVERY_VERIFIED', productionProjectRef: 'egehnijjpgijmccagxac', databaseMutationAuthorized: false,
        backupObservedAt: start, restoreRehearsedAt: start, storageObjectsCovered: false },
      finalRisk: { ...audit(), status: 'ASTRA_APPROVED', planDigest: identity.planDigest, evidenceDigest: '', reviewedAt: start, reviewId: 'fixture-review-552' } };
    value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
    return value;
  };
  it('accepts lower-tier evidence only for read-only READY_FOR_LOCK', () => {
    const result = evaluateReleasePreflight(packet(), { now: start });
    assert.equal(result.status, 'READY_FOR_LOCK');
    assert.equal(result.databaseMutationAuthorized, false);
  });
  it('accepts documented unknown identity without granting DB mutation authority', () => {
    const value = packet(); Object.assign(value.finalRisk, fallback());
    assert.equal(evaluateReleasePreflight(value, { now: start }).databaseMutationAuthorized, false);
  });
  it('preserves validated fallback through the DB evidence adapter', () => {
    const value = packet();
    const payload = { ...context, ...fallback(), report: ref, findings: 'Fixture findings reconciled', verdict: 'PASS',
      productionDbReviewScope: 'PRODUCTION_DB_RELEASE', productionDbReleaseId: value.releaseId,
      productionDbPlanDigest: value.planDigest, productionDbEvidenceDigest: releaseEvidenceDigestOf(value) };
    const evidence: Record<string, unknown> = buildProductionDbFinalRiskEvidence({ body, changedFiles: ['src/server/payment/fixture.ts'], context,
      releasePacket: value, reviews: [{ trusted: true, id: 700, state: 'COMMENTED', commit_id: context.headSha,
        submitted_at: start, body: '```astra-review\n' + JSON.stringify(payload) + '\n```' }] });
    assert.deepEqual(finalRiskReviewerErrors(evidence, routing), []);
    assert.equal(evidence.failureDiagnosis, payload.failureDiagnosis);
    assert.equal(evidence.databaseMutationAuthorized, false);
  });
  it('rejects fake downgrade and mismatched release evidence', () => {
    const bad = packet(); bad.finalRisk.adversarialEvidence = '';
    assert.throws(() => evaluateReleasePreflight(bad, { now: start }), /FINAL_RISK_MODEL_UNVERIFIED/);
    const stale = packet(); stale.finalRisk.evidenceDigest = 'f'.repeat(64);
    assert.throws(() => evaluateReleasePreflight(stale, { now: start }), /FINAL_RISK_EVIDENCE_MISMATCH/);
  });
});

describe('Owner #700 infrastructure fallback is evidence-based, not review bypass', () => {
  it('admits a real replacement review despite unavailable identity telemetry', () => {
    assert.deepEqual(finalRiskReviewerErrors(fallback(), routing), []);
    assert.equal(evaluate(fallback()).status, 'ASTRA_APPROVED');
    const diagnosed = { ...history, failureEvidenceRef: ref, failureDiagnosis: fallback().failureDiagnosis };
    assert.equal(selectFinalRiskReviewer({ ...diagnosed, failureClass: 'IDENTITY_UNAVAILABLE' }, routing).action, 'REVIEW_WITH_EVIDENCE_FALLBACK');
    assert.equal(decideFinalRiskRecovery({ ...diagnosed, failureClass: 'IDENTITY_UNAVAILABLE' }).action, 'REVIEW_WITH_EVIDENCE_FALLBACK');
    assert.equal(selectFinalRiskReviewer({ ...diagnosed, premiumUnavailable: true, availableModels: [] }, routing).action, 'REVIEW_WITH_EVIDENCE_FALLBACK');
  });
  for (const patch of [{ failureClass: 'CONTENT_FINDING' }, { failureClass: 'SAFETY_REFUSAL' },
    { failureDiagnosis: '' }, { failureEvidenceRef: 'unknown' }, { replacementReviewRef: '' },
    { playbookEvidenceRef: ref }, { fallbackPolicyVersion: 'old' }, { executionEvidence: 'UNKNOWN' },
    { identityEvidence: 'OPERATOR_ATTESTED' }, { unresolvedFindingCount: 1 }, { priorFindingsReviewed: false }]) {
    it(`rejects unsafe/incomplete fallback ${JSON.stringify(patch)}`, () => {
      assert.equal(evaluate({ ...fallback(), ...patch }).status, 'ASTRA_PENDING');
    });
  }
  it('retains exact digest, trusted submitter and substantive verdict gates', () => {
    assert.equal(evaluate(fallback(), { verdict: 'FIX_REQUIRED' }).status, 'ASTRA_PENDING');
    assert.equal(evaluate(fallback(), { changeDigest: 'd'.repeat(64) }).status, 'ASTRA_PENDING');
    assert.equal(evaluate(fallback(), {}, false).status, 'ASTRA_PENDING');
  });
  it('rejects known builder identity or mismatched requested/actual audit models', () => {
    for (const actualModel of ['gpt-5.6-terra', 'claude-opus-5-5']) {
      assert.equal(evaluate({ ...fallback(), actualModel, identityEvidence: 'OPERATOR_ATTESTED' }).status, 'ASTRA_PENDING');
    }
    assert.equal(evaluate({ ...fallback(), actualModel: 'gpt-6.1-sol', identityEvidence: 'OPERATOR_ATTESTED' }).status, 'ASTRA_APPROVED');
  });
  it('requires canonical Playbook in this review repository', () => {
    for (const playbookEvidenceRef of [fallback().playbookEvidenceRef.replace('smallwei0301', 'other-owner'),
      fallback().playbookEvidenceRef.replace('/main/', '/feature/'), fallback().playbookEvidenceRef.replace('#pb-031', '')]) {
      assert.equal(evaluate({ ...fallback(), playbookEvidenceRef }).status, 'ASTRA_PENDING');
    }
    assert.notDeepEqual(finalRiskReviewerErrors({ ...fallback(), repository: '' }, routing), []);
  });
  it('rejects fabricated, partial and encoded Playbook fragments across shared admission', () => {
    for (const fragment of ['does-not-exist', 'pb-03', 'pb-031-fake', 'pb%2D031', 'pb-031?fake']) {
      const invalid = { ...fallback(), playbookEvidenceRef: fallback().playbookEvidenceRef.replace('#pb-031', `#${fragment}`) };
      assert.equal(evaluate(invalid).status, 'ASTRA_PENDING');
      assert.notDeepEqual(finalRiskReviewerErrors(invalid, routing), []);
    }
  });
  it('allows semantic reuse only after shared fallback validation', () => {
    const payload = { ...context, ...fallback(), report: ref, findings: 'Fixture findings reconciled', verdict: 'PASS',
      riskClass: 'GOVERNANCE_GATE', changedFileRecords: [{ filename: 'scripts/agents/fixture.mjs' }] };
    const record = (value: typeof payload) => [{ trusted: true, id: 700, state: 'COMMENTED', commit_id: context.headSha,
      submitted_at: start, body: '```astra-review\n' + JSON.stringify(value) + '\n```' }];
    assert.equal(previousReviewFromCanonicalReviews(record(payload), context.repository)?.canonicalTrustEligible, true);
    assert.equal(previousReviewFromCanonicalReviews(record({ ...payload, unresolvedFindingCount: 1 }), context.repository)?.canonicalTrustEligible, false);
  });
});
