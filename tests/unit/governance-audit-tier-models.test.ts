import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import { classifyWorkstream, evaluateAstra, evaluateGithubAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { parseLaneMetadata, validateLaneMetadata } from '../../scripts/agents/agent-wip-policy.mjs';

// Owner #360 removes governance model pinning. Model names below are test data,
// never claims that those models were dispatched or that unknown is verified.
const createdAt = '2026-09-11T00:00:00Z';
const changedFiles = ['scripts/agents/model-routing.json'];
const modelRow = 'REQUESTED_MODEL / ACTUAL_MODEL:';
const bodyWith = (line = 'requested=not_requested; actual=unknown') => [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'WORK_ORIGIN: AGENT',
  'AGENT_LANE: GOVERNANCE',
  'LANE_STATE: ACTIVE',
  'ACTIVE_CANDIDATE: false',
  'CLOSEABILITY_SCORE: 4',
  'SELECTION_REASON: GOVERNANCE',
  'REMAINING_AUTONOMOUS_STEPS: verify exact diff then merge and reread main',
  'OWNER_OR_EXTERNAL_BLOCKER: none',
  'TEST_LANE_REQUIRED: false',
  `${modelRow} ${line}`,
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Pure model governance with no Product runtime or provider behavior changes',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
].join('\n');
const evaluate = (body = bodyWith(), files = changedFiles) =>
  evaluateAstra({ body, changedFiles: files, context: { createdAt }, reviews: [] });

const context = {
  repository: 'smallwei0301/vibeaico-admin-rebuild', createdAt,
  baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40), changeDigest: 'c'.repeat(64),
  policyVersion: routing.version, testBaseline: 'source checks fixture', schemaBaseline: 'schema baseline fixture',
};
const productBody = (risk = 'TENANT_AUTH_BOUNDARY') => [
  'WORKSTREAM: PRODUCT_MAINLINE', 'AGENT_LANE: TERRA_BUILD',
  `${modelRow} requested=not_requested; actual=unknown`,
  `ASTRA_RISK: ${risk}`, 'ASTRA_RATIONALE: Product risk must not inherit a governance exemption',
  'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION',
].join('\n');
const review = (requestedModel = routing.models.finalRisk, actualModel = requestedModel) => ({
  trusted: true, state: 'COMMENTED', commit_id: context.headSha, id: 1,
  submitted_at: createdAt,
  body: '```astra-review\n' + JSON.stringify({
    ...context, requestedModel, actualModel, identityEvidence: 'OPERATOR_ATTESTED', verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/360',
    findings: 'Fixture only; all source checks satisfied',
  }) + '\n```',
});
const evaluateProduct = (reviews: Array<Record<string, any>> = [], risk = 'TENANT_AUTH_BOUNDARY') =>
  evaluateAstra({ body: productBody(risk), changedFiles: ['src/lib/product.ts'], context, reviews });

describe('MODEL_GOVERNANCE has no designated executor model (#360)', () => {
  it('removes the designated model and whitelist without changing Product risk version', () => {
    const governance = routing.workstreams.modelGovernance;
    for (const key of ['model', 'allowedModels', 'allowedModelsNote']) assert.equal(key in governance, false);
    assert.equal(governance.executorPolicy, 'ANY_AVAILABLE_MODEL');
    assert.equal(governance.modelIdentityPolicy, 'TRUTHFUL_NON_BLOCKING');
    assert.equal(governance.finalRiskRequired, false);
    assert.equal(routing.version, '2026-09-08.4');
    assert.deepEqual(routing.models.finalRiskAllowedModels, ['gpt-6-astra', 'claude-fable-5-1']);
  });

  for (const line of [
    'requested=not_requested; actual=unknown', 'requested=gpt-5.6-sol; actual=unknown',
    'requested=gpt-5.6-sol; actual=gpt-5.6-sol', 'requested=claude-opus-5; actual=claude-opus-5',
    'requested=claude-sonnet-5; actual=claude-sonnet-5', 'requested=gpt-5.6-terra; actual=gpt-5.6-terra',
    'requested=claude-haiku-4-5; actual=claude-haiku-4-5', 'requested=gpt-5.6-luna; actual=gpt-5.6-luna',
    'requested=claude-fable-5-1; actual=claude-fable-5-1',
    'requested=not_requested; actual=another-provider/model-v2',
    'requested=gpt-5.6-sol; actual=claude-sonnet-5',
  ]) {
    it(`does not use model identity as admission: ${line}`, () => {
      const body = bodyWith(line);
      assert.deepEqual(classifyWorkstream({ body, changedFiles, createdAt }).errors, []);
      assert.equal(evaluate(body).status, 'NOT_REQUIRED');
      const metadata = parseLaneMetadata({ number: 360, state: 'open', body });
      assert.deepEqual(validateLaneMetadata(metadata), []);
      assert.equal(metadata.requestedModel, line); // Preserve the original record, including unknown.
    });
  }

  it('keeps the existing model-record requirement without inventing a model', () => {
    const body = bodyWith().split('\n').filter(line => !line.startsWith(modelRow)).join('\n');
    const metadata = parseLaneMetadata({ number: 360, body });
    assert.ok(validateLaneMetadata(metadata).includes('REQUESTED_MODEL / ACTUAL_MODEL is required'));
    assert.equal(metadata.requestedModel, '');
  });

  for (const path of ['src/server/auth.ts', 'supabase/migrations/0099.sql', 'scripts/ci/production-deploy-canary.mjs', 'vercel.json']) {
    it(`still rejects Product paths under governance: ${path}`, () => {
      const result = evaluate(bodyWith(), [path]);
      assert.equal(result.status, 'ASTRA_PENDING');
      assert.ok(result.errors.some(error => error.includes('Product/non-governance')));
    });
  }

  for (const [from, to] of [
    ['WORKSTREAM: MODEL_GOVERNANCE', 'WORKSTREAM: invented'],
    ['AGENT_LANE: GOVERNANCE', 'AGENT_LANE: TERRA_BUILD'],
    ['ASTRA_RISK: NONE', 'ASTRA_RISK: TENANT_AUTH_BOUNDARY'],
    ['FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY', 'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION'],
    ['ASTRA_RATIONALE: Pure model governance with no Product runtime or provider behavior changes', 'ASTRA_RATIONALE: unknown'],
  ]) {
    it(`keeps non-model validation: ${to}`, () => assert.equal(evaluate(bodyWith().replace(from, to)).status, 'ASTRA_PENDING'));
  }

  it('requires a complete real changed-file inventory', async () => {
    assert.equal(evaluate(bodyWith(), []).status, 'ASTRA_PENDING');
    const current = { number: 360, body: bodyWith(), created_at: createdAt, changed_files: 2, head: { sha: context.headSha }, base: { sha: context.baseSha } };
    const listFiles = () => {};
    const github = { rest: { pulls: { listFiles } }, paginate: async () => [{ filename: changedFiles[0], status: 'modified', sha: 'd'.repeat(40) }] };
    await assert.rejects(evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current }), /Incomplete changed-file inventory/);
  });

  it('does not retrieve reviews or permissions for pure governance', async () => {
    const current = { number: 360, body: bodyWith(), created_at: createdAt, changed_files: 1, head: { sha: context.headSha }, base: { sha: context.baseSha } };
    const listFiles = () => {};
    let calls = 0;
    const github = { rest: { pulls: { listFiles } }, paginate: async (method: unknown) => {
      assert.equal(method, listFiles); calls += 1;
      return [{ filename: changedFiles[0], status: 'modified', sha: 'd'.repeat(40) }];
    } };
    const result = await evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current });
    assert.equal(result.status, 'NOT_REQUIRED');
    assert.equal(calls, 1);
  });

  for (const risk of routing.highRisk) {
    it(`still requires real Product review for ${risk}`, () => {
      const result = evaluateProduct([], risk);
      assert.equal(result.required, true);
      assert.equal(result.status, 'ASTRA_PENDING');
      assert.ok(result.errors.includes('No trusted Astra attestation for this head'));
    });
  }

  for (const model of routing.models.finalRiskAllowedModels) {
    it(`retains valid Product evidence for ${model}`, () => assert.equal(evaluateProduct([review(model)]).status, 'ASTRA_APPROVED'));
  }
  for (const [requested, actual] of [['unknown', 'unknown'], ['claude-sonnet-5', 'claude-sonnet-5'], ['gpt-6-astra', 'claude-fable-5-1']]) {
    it(`does not extend governance freedom to Product reviewer: ${requested}/${actual}`, () => {
      const result = evaluateProduct([review(requested, actual)]);
      assert.equal(result.status, 'ASTRA_PENDING');
      assert.ok(result.errors.includes('Astra model identity is unverified'));
    });
  }
  it('still rejects untrusted and changes-requested Product reviews', () => {
    assert.equal(evaluateProduct([{ ...review(), trusted: false }]).status, 'ASTRA_PENDING');
    assert.equal(evaluateProduct([{ ...review(), state: 'CHANGES_REQUESTED' }]).status, 'ASTRA_PENDING');
  });
});
