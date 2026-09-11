import assert from 'node:assert/strict';
import { describe, it } from 'vitest';
import {
  classifyWorkstream,
  evaluateAstra,
  routing,
} from '../../scripts/agents/astra-review-policy.mjs';

const createdAt = '2026-09-11T00:00:00Z';
const changedFiles = ['scripts/agents/astra-review-policy.mjs'];
const bodyWithModels = (line = '') => [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'AGENT_LANE: GOVERNANCE',
  `REQUESTED_MODEL / ACTUAL_MODEL: ${line}`,
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Only governance model declaration parsing changes; no Product behavior changes',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
].join('\n');

const valid = [
  ['Sol', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol'],
  ['Opus', 'requested=claude-opus-5; actual=claude-opus-5'],
  ['independently allowed models', 'requested=gpt-5.6-sol; actual=claude-opus-5'],
  ['reverse independently allowed models', 'requested=claude-opus-5; actual=gpt-5.6-sol'],
  ['reversed field order', 'actual=gpt-5.6-sol; requested=gpt-5.6-sol'],
  ['horizontal whitespace and field case', ' REQUESTED \t= gpt-5.6-sol ;\t ACTUAL = gpt-5.6-sol '],
  ['comma separator', 'requested=gpt-5.6-sol, actual=gpt-5.6-sol'],
  ['slash separator', 'requested=gpt-5.6-sol / actual=gpt-5.6-sol'],
  ['space separator', 'requested=gpt-5.6-sol actual=gpt-5.6-sol'],
];

const invalid = [
  ['slash suffix', 'requested=gpt-5.6-sol/preview; actual=gpt-5.6-sol/preview'],
  ['requested slash suffix', 'requested=gpt-5.6-sol/preview; actual=gpt-5.6-sol'],
  ['actual slash suffix', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol/preview'],
  ['colon suffix', 'requested=claude-opus-5:unknown; actual=claude-opus-5:unknown'],
  ['requested colon suffix', 'requested=claude-opus-5:unknown; actual=claude-opus-5'],
  ['actual colon suffix', 'requested=claude-opus-5; actual=claude-opus-5:unknown'],
  ['dash suffix control', 'requested=gpt-5.6-sol-preview; actual=gpt-5.6-sol-preview'],
  ['date suffix control', 'requested=claude-opus-5-20260911; actual=claude-opus-5-20260911'],
  ['duplicate actual conflicts', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol; actual=UNKNOWN'],
  ['duplicate actual agrees', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol; actual=gpt-5.6-sol'],
  ['duplicate requested conflicts', 'requested=gpt-5.6-sol; requested=UNKNOWN; actual=gpt-5.6-sol'],
  ['duplicate requested agrees', 'requested=gpt-5.6-sol; requested=gpt-5.6-sol; actual=gpt-5.6-sol'],
  ['space-separated duplicate', 'requested=gpt-5.6-sol actual=gpt-5.6-sol actual=UNKNOWN'],
  ['not-actual field', 'not-actual=gpt-5.6-sol; requested=gpt-5.6-sol'],
  ['not-requested field', 'not-requested=gpt-5.6-sol; actual=gpt-5.6-sol'],
  ['dotted field name', 'other.actual=gpt-5.6-sol; requested=gpt-5.6-sol'],
  ['trailing value text', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol unknown'],
  ['extra assignment', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol; other=UNKNOWN'],
  ['trailing separator', 'requested=gpt-5.6-sol; actual=gpt-5.6-sol;'],
  ['missing requested', 'actual=gpt-5.6-sol'],
  ['missing actual', 'requested=gpt-5.6-sol'],
  ['empty requested', 'requested=; actual=gpt-5.6-sol'],
  ['empty actual', 'requested=gpt-5.6-sol; actual='],
  ['missing both', ''],
  ['unverified actual stays blocked', 'requested=gpt-5.6-sol; actual=unknown'],
  ['role name is not a model', 'requested=Sol; actual=Sol'],
  ['build tier is not governance', 'requested=claude-sonnet-5; actual=claude-sonnet-5'],
  ['unparsed quotation marks', 'requested="gpt-5.6-sol"; actual="gpt-5.6-sol"'],
];

describe('model declaration admission integrity (#354)', () => {
  for (const [name, line] of valid) {
    it(`accepts the complete declaration: ${name}`, () => {
      const body = bodyWithModels(line);
      assert.deepEqual(classifyWorkstream({ body, changedFiles, createdAt }).errors, []);
      const result = evaluateAstra({ body, changedFiles, context: { createdAt }, reviews: [] });
      assert.deepEqual(result.errors, []);
      assert.equal(result.status, 'NOT_REQUIRED');
    });
  }

  for (const [name, line] of invalid) {
    it(`rejects without granting NOT_REQUIRED: ${name}`, () => {
      const body = bodyWithModels(line);
      const classification = classifyWorkstream({ body, changedFiles, createdAt });
      assert.ok(classification.errors.some(error => error.includes('requested/actual model')));
      const result = evaluateAstra({ body, changedFiles, context: { createdAt }, reviews: [] });
      assert.ok(result.errors.length > 0);
      // Keep the existing invalid-evidence status, not a new public status enum.
      assert.equal(result.status, 'ASTRA_PENDING');
      assert.notEqual(result.status, 'NOT_REQUIRED');
    });
  }

  it('rejects a missing complete model metadata row', () => {
    const body = bodyWithModels(valid[0][1]).split('\n')
      .filter(line => !line.startsWith('REQUESTED_MODEL / ACTUAL_MODEL:')).join('\n');
    assert.equal(evaluateAstra({ body, changedFiles, context: { createdAt } }).status, 'ASTRA_PENDING');
  });

  it('keeps configured models and Product policy version unchanged', () => {
    assert.deepEqual(routing.workstreams.modelGovernance.allowedModels, ['gpt-5.6-sol', 'claude-opus-5']);
    assert.equal(routing.version, '2026-09-08.4');
    assert.deepEqual(routing.models.finalRiskAllowedModels, ['gpt-6-astra', 'claude-fable-5-1']);
  });

  for (const risk of routing.highRisk) {
    it(`still requires Product Final Risk for ${risk}`, () => {
      const body = [
        'WORKSTREAM: PRODUCT_MAINLINE',
        'AGENT_LANE: TERRA_BUILD',
        `ASTRA_RISK: ${risk}`,
        'ASTRA_RATIONALE: Product risk classification is unchanged by governance model parsing',
        'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION',
      ].join('\n');
      const result = evaluateAstra({ body, changedFiles: ['src/lib/product.ts'], context: { createdAt } });
      assert.equal(result.required, true);
      assert.equal(result.status, 'ASTRA_PENDING');
    });
  }

  for (const path of ['src/server/auth.ts', 'supabase/migrations/9999_example.sql', 'vercel.json']) {
    it(`does not admit Product paths under governance: ${path}`, () => {
      const result = evaluateAstra({
        body: bodyWithModels(valid[0][1]), changedFiles: [path], context: { createdAt },
      });
      assert.ok(result.errors.some(error => error.includes('Product/non-governance')));
      assert.equal(result.status, 'ASTRA_PENDING');
    });
  }
});
