import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { premiumExecutionState, selectFinalRiskReviewer, finalRiskReviewerErrors,
  FINAL_RISK_COST_POLICY_VERSION } from '../../scripts/agents/final-risk-cost-policy.mjs';
import { changeDigestOf, evaluateAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { decideFinalRiskRecovery, preflightFinalRiskDispatch, observeFinalRiskDispatch } from '../../scripts/agents/final-risk-workflow.mjs';
import { evaluateReleasePreflight, releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';

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
const context = { repository: 'smallwei0301/vibeaico-admin-rebuild', createdAt: start,
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), changeDigest: 'c'.repeat(64),
  policyVersion: routing.version, testBaseline: 'Fixture source tests passed', schemaBaseline: 'Fixture schema unchanged' };
const body = 'WORKSTREAM: PRODUCT_MAINLINE\nAGENT_LANE: TERRA_BUILD\nASTRA_RISK: PAYMENT_CONSISTENCY\nASTRA_RATIONALE: Synthetic payment boundary fixture\nFINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION';
const evaluate = (reviewer = {}, extra = {}, trusted = true) => evaluateAstra({ body, changedFiles: ['src/server/payment/fixture.ts'], context,
  reviews: [{ trusted, id: 552, state: 'COMMENTED', commit_id: context.headSha, submitted_at: start,
    body: '```astra-review\n' + JSON.stringify({ ...context, ...reviewer, report: ref, findings: 'Synthetic findings reconciled', verdict: 'PASS', ...extra }) + '\n```' }] });

describe('prospective premium dispatch requires durable occupied budget readback', () => {
  const reservationRef = ref + '#issuecomment-123456';
  const currentFiles = [{ filename: 'src/server/payment/fixture.ts', status: 'modified', sha: 'd'.repeat(40) }];
  const request = () => ({ ...history, repository: context.repository, provider: 'OPENAI', body, scope: ['src/server/payment/fixture.ts'], headSha: context.headSha,
    changeDigest: changeDigestOf(currentFiles), executionRef: 'fixture-dispatch-once', requestedBy: 'fixture-main-agent', requestedModel: 'gpt-6-astra',
    availableModels: ['gpt-6-astra', 'gpt-6.1-sol', 'gpt-6-luna'], priorPremiumAttemptCount: 0,
    reservationRef, costReason: 'High consequence payment invariant needs adversarial premium review', now: '2026-09-17T01:00:03Z' });
  const adapter = (input = request(), patch = {}) => ({
    readCurrentSource: () => ({ trusted: true, repository: context.repository, headSha: context.headSha, body,
      changedFiles: currentFiles, changedFileCount: currentFiles.length, changeDigest: changeDigestOf(currentFiles),
      evidenceRef: ref, observedAt: '2026-09-17T01:00:02Z' }),
    readReservation: () => ({ trusted: true, ref: reservationRef,
    runtime: { provider: input.provider, models: input.availableModels, modelSelectionAvailable: true, observedAt: start, evidenceRef: 'fixture-runtime-catalog-observation' },
    lineageHistory: { complete: true, repository: input.repository, reviewLineage: input.reviewLineage, evidenceRef: ref,
      premiumReservations: [{ executionRef: input.executionRef, state: 'RESERVED', dispatched: false }] },
    observedAt: '2026-09-17T01:00:02Z', receipt: { ...input, risks: ['PAYMENT_CONSISTENCY'], state: 'RESERVED',
      lineageAttemptCount: 1, dispatched: false, reservedAt: start, ...patch } }) });
  it('admits only exact trusted readback and retains unknown actual', () => {
    const input = request(); const result = preflightFinalRiskDispatch(input, adapter(input));
    assert.equal(result.dispatchAllowed, true); assert.equal(result.actualModel, 'unknown');
    assert.equal(result.premiumRetryAllowed, false);
  });
  it('rejects missing pre-receipt and candidate-supplied trust claims', () => {
    assert.equal(preflightFinalRiskDispatch({ ...request(), receipt: { trusted: true } }).dispatchAllowed, false);
  });
  it('rejects forged high-risk body when independently observed current source is ordinary risk', () => {
    const input = { ...request(), scope: ['src/components/plain-copy.tsx'] };
    const ordinary = { trusted: true, repository: input.repository, headSha: input.headSha, changeDigest: input.changeDigest,
      body: 'WORKSTREAM: PRODUCT_MAINLINE\nASTRA_RISK: NONE\nASTRA_RATIONALE: Ordinary UI copy only',
      changedFiles: [{ filename: input.scope[0], status: 'modified', sha: 'd'.repeat(40) }], changedFileCount: 1,
      evidenceRef: ref, observedAt: '2026-09-17T01:00:02Z' };
    assert.equal(preflightFinalRiskDispatch(input, { ...adapter(input), readCurrentSource: () => ordinary }).dispatchAllowed, false);
  });
  it('rejects missing, incomplete, stale or candidate-provided current source', () => {
    const input = request(); const deps = adapter(input); const source = deps.readCurrentSource();
    assert.equal(preflightFinalRiskDispatch({ ...input, currentSource: source }, { readReservation: deps.readReservation }).dispatchAllowed, false);
    for (const patch of [{ trusted: false }, { repository: 'other/repo' }, { headSha: 'e'.repeat(40) },
      { changeDigest: 'f'.repeat(64) }, { changedFileCount: 2 }, { changedFiles: [] }, { body: 'ordinary' }, { observedAt: 'invalid' }]) {
      assert.equal(preflightFinalRiskDispatch(input, { ...deps, readCurrentSource: () => ({ ...source, ...patch }) }).dispatchAllowed, false);
    }
  });
  for (const patch of [{ lineageAttemptCount: 2 }, { dispatched: true }, { state: 'DISPATCHED' }, { scope: ['src/other.ts'] },
    { headSha: 'd'.repeat(40) }, { changeDigest: 'e'.repeat(64) }, { reviewLineage: 'other-lineage' },
    { executionRef: 'other-execution' }, { requestedBy: 'other-actor' }, { requestedModel: 'claude-fable-5-1' }, { costReason: 'different justification' }]) {
    it(`rejects replay/mismatch ${JSON.stringify(patch)}`, () => {
      assert.equal(preflightFinalRiskDispatch(request(), adapter(request(), patch)).dispatchAllowed, false);
    });
  }
  for (const patch of [{ reservationRef: undefined }, { reservationRef: '' }, { reservationRef: ref },
    { priorPremiumAttemptCount: 1 }, { historyVerified: false }, { availableModels: ['gpt-6.1-sol'] },
    { requestedModel: 'gpt-6.1-sol' }, { requestedModel: 'gpt-6-luna' }, { modelSelectionAvailable: false }]) {
    it(`rejects invalid request ${JSON.stringify(patch)}`, () => {
      assert.equal(preflightFinalRiskDispatch({ ...request(), ...patch }, adapter()).dispatchAllowed, false);
    });
  }
  it('ordinary Sol/Luna work needs no premium reservation and cannot call premium dispatch', () => {
    const input = { ...request(), body: 'WORKSTREAM: PRODUCT_MAINLINE\nASTRA_RISK: NONE\nASTRA_RATIONALE: Ordinary display copy only', scope: ['src/components/plain-copy.tsx'] };
    assert.equal(preflightFinalRiskDispatch(input, adapter(input)).dispatchAllowed, false);
    assert.equal(selectFinalRiskReviewer({ modelSelectionAvailable: false }, routing).action, 'REVIEW_WITH_CURRENT_AGENT');
  });
  it('cannot reset caller counters without trusted complete lineage readback', () => {
    const input = request();
    for (const lineageHistory of [undefined, { complete: false }, { complete: true, reviewLineage: input.reviewLineage, evidenceRef: ref, premiumReservations: [] },
      { complete: true, reviewLineage: input.reviewLineage, evidenceRef: ref, premiumReservations: [{ executionRef: input.executionRef, state: 'DISPATCHED', dispatched: true }] }]) {
      assert.equal(preflightFinalRiskDispatch(input, { readReservation: () => ({ ...adapter(input).readReservation(), lineageHistory }) }).dispatchAllowed, false);
    }
    assert.equal(preflightFinalRiskDispatch({ ...input, failureClass: 'ENVIRONMENT' }, adapter(input)).dispatchAllowed, false);
  });
  it('keeps provider-local selection and rejects foreign-repository reservation replay', () => {
    const input = request();
    assert.equal(preflightFinalRiskDispatch({ ...input, repository: 'other/repository' }, adapter(input)).dispatchAllowed, false);
    assert.equal(preflightFinalRiskDispatch({ ...input, provider: 'ANTHROPIC' }, adapter(input)).dispatchAllowed, false);
    const claude = { ...input, provider: 'ANTHROPIC', requestedModel: 'claude-fable-5-1', availableModels: ['claude-fable-5-1', 'claude-opus-5-5'] };
    assert.equal(preflightFinalRiskDispatch(claude, adapter(claude)).dispatchAllowed, true);
    const missingRuntime = { readReservation: () => ({ ...adapter(input).readReservation(), runtime: undefined }) };
    assert.equal(preflightFinalRiskDispatch(input, missingRuntime).dispatchAllowed, false);
  });
  it('observes startup timeout or first infra failure as fallback, never a release PASS', () => {
    const timed = observeFinalRiskDispatch({ ...history, dispatch: { ...dispatch, requestedModel: 'gpt-6-astra' }, now: '2026-09-17T01:05:00Z' });
    assert.equal(timed.selection.action, 'DOWNGRADE_REVIEWER_MODEL'); assert.equal(timed.executionReceipt.actualModel, 'unknown');
    assert.equal(timed.releaseApproved, false);
    assert.equal(observeFinalRiskDispatch({ ...history, failureClass: 'ENVIRONMENT' }).selection.action, 'DOWNGRADE_REVIEWER_MODEL');
  });
});

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
  it('rejects fake downgrade and mismatched release evidence', () => {
    const bad = packet(); bad.finalRisk.adversarialEvidence = '';
    assert.throws(() => evaluateReleasePreflight(bad, { now: start }), /FINAL_RISK_MODEL_UNVERIFIED/);
    const stale = packet(); stale.finalRisk.evidenceDigest = 'f'.repeat(64);
    assert.throws(() => evaluateReleasePreflight(stale, { now: start }), /FINAL_RISK_EVIDENCE_MISMATCH/);
  });
});
