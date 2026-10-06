import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { premiumExecutionState, selectFinalRiskReviewer, finalRiskReviewerErrors,
  FINAL_RISK_COST_POLICY_VERSION } from '../../scripts/agents/final-risk-cost-policy.mjs';
import { changeDigestOf, evaluateAstra, evaluateGithubAstra, loadFallbackSourceEvidence, resolveRoleReceiptWakeup, routing as currentRouting } from '../../scripts/agents/astra-review-policy.mjs';
import { buildFinalRiskPacket, decideFinalRiskRecovery, previousReviewFromCanonicalReviews } from '../../scripts/agents/final-risk-workflow.mjs';
import { evaluateReleasePreflight, releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { buildProductionDbFinalRiskEvidence, buildProductionDbFinalRiskEvidenceFromGithub } from '../../scripts/agents/production-db-final-risk-evidence.mjs';

// Fixtures are not claims that a model was run or a real release was admitted.
// Original #552 model/fallback fixtures replay their pre-role-proof policy explicitly.
// Live admission uses currentRouting; new regressions below explicitly require role evidence.
const routing = { ...currentRouting, openaiBuilderDecision: { independentReviewerRequired: false } };
const ref = 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/552';
const failureRef = 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/703#issuecomment-1';
const replacementRef = 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/703#pullrequestreview-1';
const start = '2026-09-17T01:00:00Z';
const failureTime = '2026-09-17T00:59:00Z';
const dispatch = { requestedAt: start, executionRef: 'fixture-execution-552' };
const history = { historyVerified: true, historyEvidenceRef: ref, reviewLineage: 'vibeaico-admin-rebuild#552', modelSelectionAvailable: true,
  provider: 'OPENAI', availableModels: ['gpt-6-astra', 'gpt-6.1-sol'], runtimeCatalog: { provider: 'OPENAI', models: ['gpt-6-astra', 'gpt-6.1-sol'], captureStartedAt: start, observedAt: start, evidenceRef: ref, providerEvidenceRef: ref } };
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
  repository: 'smallwei0301/vibeaico-admin-rebuild', submittedAt: start,
  actualModel: 'unknown', identityEvidence: 'UNKNOWN', executionEvidence: 'OPERATOR_ATTESTED',
  fallbackPolicyVersion: '2026-09-30.1', failureClass: 'IDENTITY_UNAVAILABLE',
  failureEvidenceRef: failureRef, failureDiagnosis: 'Fixture dispatch executed; runtime exposes no independent model identity',
  replacementReviewRef: replacementRef, playbookEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/blob/main/docs/AGENT-PLAYBOOK.md#pb-031',
  downgradeReason: 'REVIEWER_INFRASTRUCTURE_FAILURE' });
const context = { repository: 'smallwei0301/vibeaico-admin-rebuild', createdAt: start,
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), changeDigest: 'c'.repeat(64),
  policyVersion: routing.version, testBaseline: 'Fixture source tests passed', schemaBaseline: 'Fixture schema unchanged' };
const body = 'WORKSTREAM: PRODUCT_MAINLINE\nAGENT_LANE: TERRA_BUILD\nASTRA_RISK: PAYMENT_CONSISTENCY\nASTRA_RATIONALE: Synthetic payment boundary fixture\nFINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION';
const reviewBody = (payload: Record<string, unknown>) => '```astra-review\n' + JSON.stringify(payload) + '\n```';
const blobHash = (content: string) => createHash('sha1').update(`blob ${Buffer.byteLength(content)}\0`).update(content).digest('hex');
const sources = (review: Record<string, any> = { ...context, ...fallback() }) => {
  const content = '<a id="pb-031"></a>\nFixture canonical prevention';
  return { repository: context.repository, prNumber: 703, currentMainSha: 'a'.repeat(40),
    playbook: { mainSha: 'a'.repeat(40), content, blobSha: blobHash(content) },
    records: [{ ref: review.failureEvidenceRef, number: 703, kind: 'issuecomment', id: 1, trusted: true,
      body: review.failureDiagnosis, createdAt: failureTime, updatedAt: failureTime }, { ref: review.replacementReviewRef, number: 703, kind: 'pullrequestreview', id: 1,
      trusted: true, state: 'COMMENTED', createdAt: start, updatedAt: start, body: reviewBody({ ...review, verdict: 'PASS' }) }] };
};
const fallbackContext = (review: Record<string, any> = { ...context, ...fallback() }) => {
  const role = (kind: string) => ({ role: kind, repository: context.repository, headSha: context.headSha,
    changeDigest: review.changeDigest, actorId: `fixture-${kind}-actor`, sessionId: `fixture-${kind}-session`,
    executionRef: kind === 'REVIEW' ? review.executionRef : 'fixture-builder-execution',
    sourceRef: ref + (kind === 'REVIEW' ? '#issuecomment-102' : '#issuecomment-101'),
    startedAt: start, completedAt: start, freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED',
    provider: 'OPENAI', providerEvidenceRef: ref, requestedModel: review.requestedModel,
    runtimeCatalog: history.runtimeCatalog });
  return { ...context, roleEvidence: { trusted: true, builder: role('BUILD'), reviewer: role('REVIEW') },
    fallbackSourceEvidence: sources(review) };
};
const evaluate = (reviewer = {}, extra = {}, trusted = true) => evaluateAstra({ body, changedFiles: ['src/server/payment/fixture.ts'],
  context: fallbackContext({ ...context, ...reviewer, ...extra }),
  reviews: [{ trusted, id: 552, state: 'COMMENTED', commit_id: context.headSha, submitted_at: start,
    body: '```astra-review\n' + JSON.stringify({ ...context, ...reviewer, report: ref, findings: 'Synthetic findings reconciled', verdict: 'PASS', ...extra }) + '\n```' }] }, routing);

describe('prospective independent role and provider admission regressions', () => {
  const requiredPolicy = { ...routing, openaiBuilderDecision: { independentReviewerRequired: true } };
  const role = (kind: string) => ({ role: kind, repository: context.repository, headSha: context.headSha,
    changeDigest: context.changeDigest, actorId: `fixture-${kind}-actor`, sessionId: `fixture-${kind}-session`,
    executionRef: kind === 'REVIEW' ? current().executionRef : 'fixture-builder-execution',
    startedAt: start, completedAt: start, freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED' });
  const roleContext = () => ({ ...context, roleEvidence: { trusted: true,
    builder: { ...role('BUILD'), sourceRef: ref + '#issuecomment-101' },
    reviewer: { ...role('REVIEW'), sourceRef: ref + '#issuecomment-102' } } });
  it('rejects same runtime actor/session and missing or payload-self-reported builder proof', () => {
    const ctx = roleContext(); ctx.roleEvidence.reviewer.actorId = ctx.roleEvidence.builder.actorId;
    assert.ok(finalRiskReviewerErrors(current(), requiredPolicy, ctx).length);
    const sameSession = roleContext(); sameSession.roleEvidence.reviewer.sessionId = sameSession.roleEvidence.builder.sessionId;
    assert.ok(finalRiskReviewerErrors(current(), requiredPolicy, sameSession).length);
    assert.ok(finalRiskReviewerErrors({ ...current(), roleEvidence: roleContext().roleEvidence }, requiredPolicy, context).length);
  });
  it('accepts distinct same-Sol role actors and truthful unknown CURRENT_AGENT model', () => {
    const ctx = roleContext();
    assert.deepEqual(finalRiskReviewerErrors(current(), requiredPolicy, ctx), []);
    assert.deepEqual(finalRiskReviewerErrors({ ...audit(), executionRef: ctx.roleEvidence.reviewer.executionRef,
      requestedModel: 'gpt-6.1-sol', actualModel: 'gpt-6.1-sol' }, requiredPolicy, ctx), []);
  });
  it('rejects foreign or stale role evidence and non-fresh review context', () => {
    for (const patch of [{ repository: 'other/repository' }, { headSha: 'd'.repeat(40) }, { changeDigest: 'e'.repeat(64) }, { freshContext: false }]) {
      const ctx = roleContext(); Object.assign(ctx.roleEvidence.reviewer, patch);
      assert.ok(finalRiskReviewerErrors(current(), requiredPolicy, ctx).length);
    }
  });
  it('never reserves premium on missing provider/catalog or cross-provider catalog alone', () => {
    for (const extra of [{}, { provider: 'ANTHROPIC' }, { provider: 'unknown', availableModels: ['gpt-6-astra'] }, { provider: 'ANTHROPIC', availableModels: ['gpt-6-astra'] }]) {
      assert.notEqual(selectFinalRiskReviewer({ ...history, provider: undefined, availableModels: undefined, runtimeCatalog: undefined, ...extra }, requiredPolicy).action, 'RESERVE_ONE_PREMIUM_CONSULTATION');
    }
  });
  it('uses only the explicitly observed provider-local premium model', () => {
    for (const [provider, model] of [['OPENAI', 'gpt-6-astra'], ['ANTHROPIC', 'claude-fable-5-1']]) {
      const result = selectFinalRiskReviewer({ ...history, provider, availableModels: [model],
        runtimeCatalog: { provider, models: [model], captureStartedAt: start, observedAt: start, evidenceRef: ref, providerEvidenceRef: ref } }, requiredPolicy);
      assert.equal(result.action, 'RESERVE_ONE_PREMIUM_CONSULTATION'); assert.equal(result.nextModel, model);
    }
  });
  it('keeps first-infra and 300-second audit fallback provider-local and never guesses missing catalogs', () => {
    const model = 'claude-opus-5-5';
    const anthro = { ...history, provider: 'ANTHROPIC', availableModels: [model],
      runtimeCatalog: { provider: 'ANTHROPIC', models: [model], captureStartedAt: start, observedAt: start, evidenceRef: ref, providerEvidenceRef: ref } };
    assert.equal(selectFinalRiskReviewer({ ...anthro, failureClass: 'ENVIRONMENT' }, requiredPolicy).nextModel, model);
    assert.equal(selectFinalRiskReviewer({ ...anthro, dispatch, now: '2026-09-17T01:05:00Z' }, requiredPolicy).nextModel, model);
    for (const provider of ['ANTHROPIC', 'unknown']) {
      assert.equal(selectFinalRiskReviewer({ ...history, provider, runtimeCatalog: undefined, failureClass: 'ENVIRONMENT' }, requiredPolicy).nextModel, null);
    }
    assert.equal(selectFinalRiskReviewer({ modelSelectionAvailable: false }, requiredPolicy).action, 'REVIEW_WITH_CURRENT_AGENT');
  });
});

describe('compatible identity rejection summary retains tier diagnostics', () => {
  it('reports both the established summary and current AUDIT rejection details', () => {
    const result = evaluate({ ...audit(), actualModel: 'unknown' });
    assert.equal(result.status, 'ASTRA_PENDING');
    assert.ok(result.errors.includes('Astra model identity is unverified'));
    assert.ok(result.errors.some(error => error !== 'Astra model identity is unverified' && /audit|AUDIT|model/i.test(error)));
  });
});

function githubFixture(options: Record<string, any> = {}) {
  const files = [{ filename: 'src/server/payment/fixture.ts', status: 'modified', sha: '1'.repeat(40) }];
  const payload = { ...context, ...fallback(), changeDigest: changeDigestOf(files), verdict: 'PASS', report: ref,
    findings: 'Fixture replacement findings reconciled', reviewerExecutionReceipt: ref + '#issuecomment-102', ...options.payload };
  const user = { login: 'fixture-maintainer', id: 123, type: 'User' };
  const review = { id: 1, node_id: 'fixture-review-node-1', state: 'COMMENTED', body: reviewBody(payload), user,
    commit_id: context.headSha, submitted_at: start, html_url: replacementRef, ...options.review };
  const listFiles = () => {}, listReviews = () => {};
  const calls: Record<string, any>[] = [];
  let mainReads = 0;
  const content = options.content ?? sources().playbook.content;
  const github = { graphql: async (_query: string, args: { id: string }) => {
    if (options.graphqlFailure) throw new Error('GraphQL unavailable');
    const record = args.id === options.failureReview?.node_id ? options.failureReview : review;
    return { node: { id: record.node_id, fullDatabaseId: String(record.id), url: record.html_url, body: record.body,
      state: record.state, submittedAt: record.submitted_at, updatedAt: record.submitted_at, ...options.graphqlNode,
      ...(args.id === options.failureReview?.node_id ? options.failureGraphqlNode : {}) } };
  }, paginate: async (fn: unknown) => fn === listFiles ? files : [review],
    rest: { pulls: { listFiles, listReviews, get: async () => ({ data: current }),
      getReview: async (args: any) => {
        calls.push(args);
        if (options.missingRecord) throw new Error('404');
        return { data: args.review_id === options.failureReview?.id ? options.failureReview : review };
      } }, issues: { getComment: async (args: any) => {
        calls.push(args);
        if (options.missingRecord) throw new Error('404');
        if ([101, 102].includes(args.comment_id)) {
          const kind = args.comment_id === 101 ? 'BUILD' : 'REVIEW';
          const receipt = { role: kind, repository: context.repository, headSha: context.headSha,
            changeDigest: payload.changeDigest, actorId: `fixture-${kind}-actor`, sessionId: `fixture-${kind}-session`,
            executionRef: kind === 'REVIEW' ? payload.executionRef : 'fixture-builder-execution',
            startedAt: start, completedAt: start, freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED',
            provider: 'OPENAI', providerEvidenceRef: ref, requestedModel: payload.requestedModel, runtimeCatalog: history.runtimeCatalog,
            ...options.rolePatch?.[kind] };
          if (options.missingRole) throw new Error('404 role');
          return { data: { id: args.comment_id, html_url: ref + '#issuecomment-' + args.comment_id, user,
            updated_at: start, body: '```agent-role-execution\n' + JSON.stringify(receipt) + '\n```' } };
        }
        if (args.comment_id === 3) return { data: { id: 3, html_url: failureRef.replace('issuecomment-1', 'issuecomment-3'), user,
          created_at: start, updated_at: start, body: reviewBody(payload), ...options.replacementComment } };
        return { data: { id: 1, html_url: failureRef, user, body: payload.failureDiagnosis, created_at: failureTime, updated_at: failureTime, ...options.comment } };
      } }, repos: {
      getCommit: async (args: any) => {
        calls.push(args); mainReads++;
        return { data: { sha: options.movedMain && mainReads > 1 ? 'd'.repeat(40) : 'a'.repeat(40) } };
      }, getContent: async (args: any) => {
        calls.push(args);
        if (options.missingPlaybook) throw new Error('404');
        return { data: { type: 'file', encoding: 'base64', content: Buffer.from(content).toString('base64'),
          sha: options.blobSha ?? blobHash(content) } };
      }, getCollaboratorPermissionLevel: async () => ({ data: { permission: options.permission ?? 'write' } }),
    } } };
  const current = { number: 703, changed_files: files.length, base: { sha: context.baseSha }, head: { sha: context.headSha },
    body: body + `\nBUILDER_EXECUTION_RECEIPT: ${ref}#issuecomment-101\nASTRA_TEST_BASELINE: ${context.testBaseline}\nASTRA_SCHEMA_BASELINE: ${context.schemaBaseline}`, created_at: start };
  return { github, current, calls, payload, reviews: [{ ...review, trusted: true }] };
}

describe('Owner #552 startup timeout is exactly 300 seconds without execution proof', () => {
  it('carries diagnosed failure through normal prepare into a validator-complete reviewer contract', () => {
    const records = [{ filename: 'src/server/payment/fixture.ts', previous_filename: '', status: 'modified', sha: '1'.repeat(40) }];
    const deps = { preflightEvaluator: () => ({ valid: true, errors: [], metadata: {} }) };
    const input = { ...history, body: body + '\nASTRA_TEST_BASELINE: fixture-tests-pass\nASTRA_SCHEMA_BASELINE: fixture-schema-unchanged',
      repository: context.repository, prNumber: 703, exactHead: context.headSha,
      changedFileRecords: records, changeDigest: changeDigestOf(records),
      sourceFrozen: true, sourceCiStatus: 'PASS', testEvidenceStatus: 'PASS', coreRegressionStatus: 'PASS', policyVersion: routing.version,
      triageSummary: 'Fixture payment boundary independent review', evidenceRefs: [ref], failureClass: 'IDENTITY_UNAVAILABLE',
      failureEvidenceRef: failureRef,
      failureDiagnosis: 'Dispatch executed but independent provider identity telemetry is unavailable.',
      reviewLineage: 'issue-700-independent-review' };
    const result = buildFinalRiskPacket(input, deps);
    expect(result.nextAction).toBe('REVIEW_WITH_EVIDENCE_FALLBACK');
    const persistence = result.packet!.attestationPersistence;
    expect(result.packet!.reviewerRoute.failureDiagnosis).toBe(input.failureDiagnosis);
    expect(persistence.copyExactly).toMatchObject({ failureClass: input.failureClass,
      failureEvidenceRef: input.failureEvidenceRef, failureDiagnosis: input.failureDiagnosis });
    const reviewerFacts = {
      executionRef: 'independent-review-execution-1', adversarialEvidence: 'Negative controls challenged and findings reconciled.',
      priorFindingsReviewed: true, unresolvedFindingCount: 0,
      replacementReviewRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/703#pullrequestreview-1',
      playbookEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/blob/main/docs/AGENT-PLAYBOOK.md#pb-031',
      executionEvidence: 'OPERATOR_ATTESTED', requestedModel: 'gpt-6.1-sol', actualModel: 'unknown', identityEvidence: 'UNKNOWN',
      reviewerExecutionReceipt: ref + '#issuecomment-102',
    };
    for (const field of persistence.reviewerStructuredFields.filter((field: string) => !['findingDetails', 'supportFiles'].includes(field))) {
      expect(reviewerFacts).toHaveProperty(field);
    }
    const review = { ...context, submittedAt: start, repository: result.packet!.repository, changeDigest: result.packet!.changeDigest, ...persistence.copyExactly, ...reviewerFacts };
    const role = (kind: string) => ({ role: kind, repository: review.repository, headSha: context.headSha,
      changeDigest: review.changeDigest, actorId: `fixture-${kind}-actor`, sessionId: `fixture-${kind}-session`,
      executionRef: kind === 'REVIEW' ? review.executionRef : 'fixture-builder-execution',
      startedAt: start, completedAt: start, freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED', provider: 'OPENAI', providerEvidenceRef: ref,
      requestedModel: review.requestedModel, runtimeCatalog: history.runtimeCatalog,
      sourceRef: ref + (kind === 'REVIEW' ? '#issuecomment-102' : '#issuecomment-101') });
    const currentContext = { ...context, changeDigest: review.changeDigest,
      fallbackSourceEvidence: sources({ ...context, ...review }),
      roleEvidence: { trusted: true, builder: role('BUILD'), reviewer: role('REVIEW') } };
    expect(finalRiskReviewerErrors(review, currentRouting, currentContext)).toEqual([]);
    expect(finalRiskReviewerErrors(review, currentRouting, { ...currentContext, roleEvidence: undefined })).not.toEqual([]);
    expect(finalRiskReviewerErrors({ ...review, replacementReviewRef: '' }, routing, fallbackContext({ ...context, ...review }))).not.toEqual([]);
    expect(buildFinalRiskPacket({ ...input, failureDiagnosis: '' }, deps).nextAction).toBe('PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
  });
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
    assert.equal(selectFinalRiskReviewer({}, routing).nextModel, null);
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
      const result = decideFinalRiskRecovery({ ...history, failureClass, sameClassAttempts: 1, currentModel: 'claude-fable-5-1' });
      assert.equal(result.action, 'DOWNGRADE_REVIEWER_MODEL');
      assert.equal(result.nextModel, 'gpt-6.1-sol');
    });
  }
  it('uses Opus when Sol is unavailable, current agent only when selector is unavailable', () => {
    assert.equal(selectFinalRiskReviewer({ ...history, provider: 'ANTHROPIC', premiumUnavailable: true, availableModels: ['claude-opus-5'],
      runtimeCatalog: { provider: 'ANTHROPIC', models: ['claude-opus-5'], captureStartedAt: start, observedAt: start, evidenceRef: ref, providerEvidenceRef: ref } }, routing).nextModel, 'claude-opus-5');
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
    if (currentRouting.openaiBuilderDecision?.independentReviewerRequired === true) {
      // Old DB packet contains no prospective independently captured roles; never invent them.
      assert.throws(() => evaluateReleasePreflight(packet(), { now: start }), /FINAL_RISK_MODEL_UNVERIFIED/);
      return;
    }
    const result = evaluateReleasePreflight(packet(), { now: start });
    assert.equal(result.status, 'READY_FOR_LOCK');
    assert.equal(result.databaseMutationAuthorized, false);
  });
  it('rejects documented unknown identity at current DB admission without independent roles', () => {
    const value = packet(); Object.assign(value.finalRisk, context, fallback(), { fallbackSourceEvidence: sources() });
    assert.throws(() => evaluateReleasePreflight(value, { now: start }), /FINAL_RISK_MODEL_UNVERIFIED/);
  });
  it('preserves legacy validated fallback through the DB evidence adapter without live role approval', () => {
    const value = packet();
    const payload = { ...context, ...fallback(), report: ref, findings: 'Fixture findings reconciled', verdict: 'PASS',
      productionDbReviewScope: 'PRODUCTION_DB_RELEASE', productionDbReleaseId: value.releaseId,
      productionDbPlanDigest: value.planDigest, productionDbEvidenceDigest: releaseEvidenceDigestOf(value) };
    const evidence: Record<string, unknown> = buildProductionDbFinalRiskEvidence({ body, changedFiles: ['src/server/payment/fixture.ts'], context: fallbackContext(payload),
      releasePacket: value, reviews: [{ trusted: true, id: 700, state: 'COMMENTED', commit_id: context.headSha,
        submitted_at: start, body: '```astra-review\n' + JSON.stringify(payload) + '\n```' }] }, routing);
    assert.deepEqual(finalRiskReviewerErrors(evidence, routing, fallbackContext(payload)), []);
    assert.equal(evidence.failureDiagnosis, payload.failureDiagnosis);
    assert.equal(evidence.databaseMutationAuthorized, false);
  });
  it('rejects fake downgrade and mismatched release evidence', () => {
    const bad = packet(); bad.finalRisk.adversarialEvidence = '';
    assert.throws(() => evaluateReleasePreflight(bad, { now: start }), /FINAL_RISK_MODEL_UNVERIFIED/);
    const stale = packet(); stale.finalRisk.evidenceDigest = 'f'.repeat(64);
    assert.throws(() => evaluateReleasePreflight(stale, { now: start }), currentRouting.openaiBuilderDecision?.independentReviewerRequired === true
      ? /FINAL_RISK_MODEL_UNVERIFIED/ : /FINAL_RISK_EVIDENCE_MISMATCH/);
  });
  it('keeps current DB source admission closed without role/runtime context', async () => {
    const value = packet();
    const f = githubFixture({ payload: { productionDbReviewScope: 'PRODUCTION_DB_RELEASE', productionDbReleaseId: value.releaseId,
      productionDbPlanDigest: value.planDigest, productionDbEvidenceDigest: releaseEvidenceDigestOf(value) } });
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({ github: f.github, owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild', prNumber: 703, releasePacket: value })).rejects.toThrow('FINAL_RISK_NOT_APPROVED');
  });
});

describe('PR703 trusted source readback (#4146547160/#4146547172)', () => {
  it('uses immutable observed-main bytes and actual same-repository review/comment reads', async () => {
    const f = githubFixture();
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status)
      .toBe('ASTRA_APPROVED');
    expect(f.calls).toContainEqual({ owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', ref: 'a'.repeat(40), path: 'docs/AGENT-PLAYBOOK.md' });
    expect(f.calls).toContainEqual({ owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', pull_number: 703, review_id: 1 });
    expect(f.calls).toContainEqual({ owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', comment_id: 1 });
  });
  for (const options of [{ missingRecord: true }, { missingPlaybook: true }, { permission: 'read' },
    { movedMain: true }, { blobSha: 'f'.repeat(40) }, { content: 'No canonical anchor; candidate checkout has pb-031' },
    { comment: { id: 2 } }, { comment: { html_url: failureRef.replace('/703#', '/704#') } },
    { comment: { body: 'Unrelated comment is not failure diagnosis' } }, { review: { state: 'DISMISSED' } },
    { review: { body: reviewBody({ ...context, ...fallback(), verdict: 'FIX_REQUIRED' }) } },
    { payload: { failureEvidenceRef: 'https://github.com/attacker/fake/issues/1' } },
    { payload: { replacementReviewRef: ref } }, { payload: { replacementReviewRef: replacementRef.replace('smallwei0301', 'attacker') } }]) {
    it(`fails closed across the live guard: ${JSON.stringify(options)}`, async () => {
      const f = githubFixture(options);
      expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status)
        .toBe('ASTRA_PENDING');
    });
  }
  it('does not trust candidate-supplied source receipts or reuse without trusted readback', async () => {
    const f = githubFixture({ payload: { fallbackSourceEvidence: sources() } });
    expect(evaluateAstra({ body: f.current.body, changedFiles: ['src/server/payment/fixture.ts'],
      context: { ...context, changeDigest: f.payload.changeDigest }, reviews: f.reviews }).status).toBe('ASTRA_PENDING');
    expect(previousReviewFromCanonicalReviews(f.reviews, context.repository)?.canonicalTrustEligible).toBe(false);
    const proof = await loadFallbackSourceEvidence({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', reviews: f.reviews, prNumber: f.current.number });
    assert.ok(proof);
    expect(finalRiskReviewerErrors(f.payload, routing, { ...fallbackContext(f.payload), fallbackSourceEvidence: proof })).toEqual([]);
    for (const records of [[], proof.records.map((r: any) => ({ ...r, trusted: false }))]) {
      expect(finalRiskReviewerErrors(f.payload, routing, { ...fallbackContext(f.payload), fallbackSourceEvidence: { ...proof, records } })).not.toEqual([]);
    }
    expect(finalRiskReviewerErrors(f.payload, routing, { ...fallbackContext(f.payload), fallbackSourceEvidence: { ...proof, currentMainSha: 'd'.repeat(40) } })).not.toEqual([]);
  });
});

describe('Owner #700 infrastructure fallback is evidence-based, not review bypass', () => {
  it('admits a real replacement review despite unavailable identity telemetry', () => {
    assert.deepEqual(finalRiskReviewerErrors({ ...context, ...fallback() }, routing, fallbackContext()), []);
    assert.equal(evaluate(fallback()).status, 'ASTRA_APPROVED');
    const diagnosed = { ...history, failureEvidenceRef: ref, failureDiagnosis: fallback().failureDiagnosis };
    assert.equal(selectFinalRiskReviewer({ ...diagnosed, failureClass: 'IDENTITY_UNAVAILABLE' }, routing).action, 'REVIEW_WITH_EVIDENCE_FALLBACK');
    assert.equal(decideFinalRiskRecovery({ ...diagnosed, failureClass: 'IDENTITY_UNAVAILABLE' }).action, 'REVIEW_WITH_EVIDENCE_FALLBACK');
    assert.equal(selectFinalRiskReviewer({ ...diagnosed, premiumUnavailable: true, availableModels: [] }, routing).action, 'PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE');
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
    assert.equal(previousReviewFromCanonicalReviews(record(payload), context.repository, sources(payload), fallbackContext(payload).roleEvidence)?.canonicalTrustEligible, true);
    assert.equal(previousReviewFromCanonicalReviews(record({ ...payload, unresolvedFindingCount: 1 }), context.repository, sources(payload), fallbackContext(payload).roleEvidence)?.canonicalTrustEligible, false);
  });
});

// Current-main composition regressions: fallback only replaces unavailable identity, not role/provider proof.
describe('PR703 current-main role and provider preservation', () => {
  for (const options of [
    { missingRole: true },
    { rolePatch: { REVIEW: { actorId: 'fixture-BUILD-actor' } } },
    { rolePatch: { REVIEW: { sessionId: 'fixture-BUILD-session' } } },
    { rolePatch: { REVIEW: { executionRef: 'fixture-builder-execution' } } },
    { rolePatch: { REVIEW: { freshContext: false } } },
    { rolePatch: { REVIEW: { headSha: 'e'.repeat(40) } } },
    { rolePatch: { REVIEW: { changeDigest: 'f'.repeat(64) } } },
    { rolePatch: { REVIEW: { repository: 'other/repository' } } },
  ]) {
    it(`retains live role rejection with valid fallback sources: ${JSON.stringify(options)}`, async () => {
      const f = githubFixture(options);
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors.some((error: string) => /role|actor|session|independent/i.test(error))).toBe(true);
    });
  }
  it('does not let a diagnosed identity failure bypass provider-local catalog admission', () => {
    const input = { ...history, failureClass: 'IDENTITY_UNAVAILABLE', failureEvidenceRef: failureRef, failureDiagnosis: fallback().failureDiagnosis };
    for (const patch of [{ provider: undefined }, { runtimeCatalog: undefined }, { provider: 'ANTHROPIC' },
      { availableModels: [] }, { availableModels: ['claude-opus-5-5'] },
      { provider: 'ANTHROPIC', runtimeCatalog: { ...history.runtimeCatalog, provider: 'ANTHROPIC' } }]) {
      expect(selectFinalRiskReviewer({ ...input, ...patch }, currentRouting).reviewerTier).toBe('NONE');
    }
    expect(selectFinalRiskReviewer(input, currentRouting).reviewerTier).toBe('EVIDENCE_FALLBACK');
    expect(selectFinalRiskReviewer({ ...input, modelSelectionAvailable: false }, currentRouting).reviewerTier).toBe('CURRENT_AGENT');
  });
});

describe('fallback selector declaration is not a wildcard', () => {
  for (const modelSelectionAvailable of [true, undefined]) {
    it(`rejects not_requested without explicit no-selector proof (${modelSelectionAvailable})`, async () => {
      const f = githubFixture({ payload: { requestedModel: 'not_requested', modelSelectionAvailable } });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Replacement must retain qualified audit model selection');
    });
  }
});

// Codex P1s 4193325304 / 4193325317: live admission, not only selector routing.
describe('fallback binds trusted provider catalog and ordered separate records', () => {
  for (const actualModel of ['unknown', 'claude-opus-5-5']) {
    it(`rejects Claude requests in an attested OPENAI runtime (${actualModel})`, async () => {
      const f = githubFixture({ payload: { requestedModel: 'claude-opus-5-5', actualModel,
        identityEvidence: actualModel === 'unknown' ? 'UNKNOWN' : 'OPERATOR_ATTESTED' } });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.errors).toContain('Missing trusted provider-local fallback runtime evidence');
      expect(result.status).toBe('ASTRA_PENDING');
    });
  }
  for (const patch of [{ provider: undefined }, { runtimeCatalog: undefined }, { providerEvidenceRef: 'unrelated-observation' },
    { requestedModel: 'claude-opus-5-5' }, { runtimeCatalog: { ...history.runtimeCatalog, models: ['gpt-6-astra'] } },
    { runtimeCatalog: { ...history.runtimeCatalog, provider: 'ANTHROPIC' } },
    { runtimeCatalog: { ...history.runtimeCatalog, observedAt: '2026-09-17T01:00:01Z' } },
    { runtimeCatalog: { ...history.runtimeCatalog, captureStartedAt: '2026-09-17T01:00:01Z' } }]) {
    it(`rejects missing/mismatched runtime evidence: ${JSON.stringify(patch)}`, async () => {
      const f = githubFixture({ rolePatch: { REVIEW: patch } });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Missing trusted provider-local fallback runtime evidence');
    });
  }
  it('accepts an observed provider-local Anthropic audit request without claiming actual identity', async () => {
    const model = 'claude-opus-5-5';
    const f = githubFixture({ payload: { requestedModel: model }, rolePatch: { REVIEW: { provider: 'ANTHROPIC',
      requestedModel: model, runtimeCatalog: { ...history.runtimeCatalog, provider: 'ANTHROPIC', models: [model] } } } });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_APPROVED');
  });
  it('rejects one canonical comment serving as both diagnosis and replacement', async () => {
    const f = githubFixture({ payload: { replacementReviewRef: failureRef } });
    const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
    expect(result.status).toBe('ASTRA_PENDING');
    expect(result.errors).toContain('Failure diagnosis must be saved separately before replacement review');
  });
  for (const comment of [{ created_at: undefined }, { updated_at: undefined }, { updated_at: 'invalid' },
    { updated_at: '2026-09-17T01:00:01Z' }, { created_at: '2026-09-17T01:00:01Z' }, { updated_at: start }]) {
    it(`rejects unproven or reordered failure persistence: ${JSON.stringify(comment)}`, async () => {
      const f = githubFixture({ comment });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Failure diagnosis must be saved separately before replacement review');
    });
  }
  it('does not turn payload runtime fields into trusted role evidence', async () => {
    const f = githubFixture({ rolePatch: { REVIEW: { runtimeCatalog: undefined } },
      payload: { runtimeCatalog: history.runtimeCatalog, provider: 'OPENAI', providerEvidenceRef: ref } });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_PENDING');
  });
});

// Codex P2s 4193818720 / 4193818727: content edits must not backdate evidence.
describe('fallback source content is fixed before canonical submission', () => {
  for (const updated_at of [undefined, 'invalid', '2026-09-17T00:59:59Z', '2026-09-17T01:00:01Z']) {
    it(`rejects missing, reversed or post-canonical replacement edit: ${updated_at}`, async () => {
      const f = githubFixture({ payload: { replacementReviewRef: failureRef.replace('issuecomment-1', 'issuecomment-3'), submittedAt: '2099-01-01T00:00:00Z' },
        replacementComment: { updated_at } });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Replacement evidence must be saved before canonical review submission');
    });
  }
  it('accepts replacement comment saved before canonical submission', async () => {
    const f = githubFixture({ payload: { replacementReviewRef: failureRef.replace('issuecomment-1', 'issuecomment-3') } });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_APPROVED');
  });
  it('rejects missing canonical submission even if the payload invents it', async () => {
    const f = githubFixture({ payload: { submittedAt: start }, review: { submitted_at: undefined } });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_PENDING');
  });
  it('accepts failure PR review with REST submitted_at and real GraphQL updatedAt', async () => {
    const failureReview = { id: 2, node_id: 'fixture-failure-node-2', html_url: ref.replace('issues/552', 'pull/703') + '#pullrequestreview-2',
      user: { login: 'fixture-maintainer', id: 123, type: 'User' }, state: 'COMMENTED',
      submitted_at: failureTime, body: fallback().failureDiagnosis };
    const f = githubFixture({ failureReview, payload: { failureEvidenceRef: failureReview.html_url } });
    const proof = await loadFallbackSourceEvidence({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', reviews: f.reviews, prNumber: f.current.number });
    expect(proof?.records[0]).toMatchObject({ createdAt: failureTime, updatedAt: failureTime });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_APPROVED');
  });
  for (const updatedAt of [undefined, '2026-09-17T01:00:01Z']) {
    it(`rejects failure PR review without a pre-review save: ${updatedAt}`, async () => {
      const failureReview = { id: 2, node_id: 'fixture-failure-node-2', html_url: ref.replace('issues/552', 'pull/703') + '#pullrequestreview-2',
        user: { login: 'fixture-maintainer', id: 123, type: 'User' }, state: 'COMMENTED',
        submitted_at: failureTime, body: fallback().failureDiagnosis };
      const f = githubFixture({ failureReview, failureGraphqlNode: { updatedAt }, payload: { failureEvidenceRef: failureReview.html_url } });
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Failure diagnosis must be saved separately before replacement review');
    });
  }
  for (const graphqlNode of [{ id: 'other-node' }, { fullDatabaseId: '999' }, { url: ref }, { body: 'edited concurrently' },
    { state: 'DISMISSED' }, { submittedAt: failureTime }, { updatedAt: undefined }, { updatedAt: 'invalid' },
    { updatedAt: '2026-09-17T01:00:01Z' }]) {
    it(`rejects mismatched or stale GraphQL review readback: ${JSON.stringify(graphqlNode)}`, async () => {
      const f = githubFixture({ graphqlNode });
      expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_PENDING');
    });
  }
  it('accepts current 64-bit review identifiers without deprecated databaseId', async () => {
    const failureReview = { id: 5426584185, node_id: 'fixture-large-review-node',
      html_url: ref.replace('issues/552', 'pull/703') + '#pullrequestreview-5426584185',
      user: { login: 'fixture-maintainer', id: 123, type: 'User' }, state: 'COMMENTED',
      submitted_at: failureTime, body: fallback().failureDiagnosis };
    const f = githubFixture({ failureReview, payload: { failureEvidenceRef: failureReview.html_url } });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_APPROVED');
  });
  it('fails closed on unavailable GraphQL, rather than inventing an update time', async () => {
    const f = githubFixture({ graphqlFailure: true });
    expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_PENDING');
  });
});

// Fresh Codex P1s4194135501/4194135508: existing native PR wakeup and full contract binding.
describe('fallback stays within native PR wakeup and canonical reviewer contract', () => {
  for (const field of ['failureEvidenceRef', 'replacementReviewRef']) {
    for (const number of [552, 704]) {
      it(`rejects cross-Issue/PR ${field}=${number} before admission`, async () => {
        const f = githubFixture({ payload: { [field]: (field === 'failureEvidenceRef' ? failureRef : replacementRef).replace('/703#', `/${number}#`) } });
        expect((await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current })).status).toBe('ASTRA_PENDING');
      });
    }
  }
  it('does not let payload PR number supply missing trusted current PR identity', async () => {
    const f = githubFixture({ payload: { prNumber: 703 } });
    expect(await loadFallbackSourceEvidence({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', reviews: f.reviews })).toBeUndefined();
  });
  it('native comment edit/delete wakes the consuming PR and edited source rejects', async () => {
    const f = githubFixture();
    const native = { ...f.current, state: 'open', base: { ...f.current.base, repo: { full_name: context.repository } } };
    const list = () => {}, listReviews = () => {};
    const github = { paginate: async (fn: unknown) => fn === list ? [native] : f.reviews,
      rest: { pulls: { get: async () => ({ data: native }), list, listReviews },
        repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'write' } }) } } };
    expect(await resolveRoleReceiptWakeup({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild',
      repository: context.repository, issueNumber: 703, commentId: 1, nativePr: true }))
      .toEqual({ numbers: [703], associationIncomplete: false });
    const edited = githubFixture({ comment: { updated_at: '2026-09-17T01:00:01Z' } });
    expect((await evaluateGithubAstra({ github: edited.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: edited.current })).status).toBe('ASTRA_PENDING');
  });
  for (const patch of [{ identityEvidence: 'OPERATOR_ATTESTED' }, { executionEvidence: 'UNKNOWN' },
    { reviewerTier: 'AUDIT' }, { fallbackPolicyVersion: 'old' }, { costPolicyVersion: 'old' },
    { modelSelectionAvailable: false }, { downgradeReason: 'MODEL_UNAVAILABLE' },
    { downgradeEvidenceRef: ref + '/foreign' }, { reviewLineage: 'other-lineage' },
    { failureClass: 'TOOLING' }, { failureDiagnosis: 'different diagnosis' },
    { failureEvidenceRef: ref + '#issuecomment-9' }, { replacementReviewRef: replacementRef },
    { playbookEvidenceRef: ref }, { reviewerExecutionReceipt: ref + '#issuecomment-103' },
    { headSha: 'd'.repeat(40) }, { baseSha: 'd'.repeat(40) }, { policyVersion: 'old-policy' },
    { testBaseline: 'different tested baseline' }, { schemaBaseline: 'different schema baseline' }]) {
    it(`rejects mismatched replacement reviewer contract: ${JSON.stringify(patch)}`, async () => {
      const options: Record<string, any> = { payload: { replacementReviewRef: failureRef.replace('issuecomment-1', 'issuecomment-3') } };
      const f = githubFixture(options);
      options.replacementComment = { body: reviewBody({ ...f.payload, ...patch }) };
      const result = await evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: f.current });
      expect(result.status).toBe('ASTRA_PENDING');
      expect(result.errors).toContain('Missing durable failure diagnosis/replacement review');
    });
  }
});
