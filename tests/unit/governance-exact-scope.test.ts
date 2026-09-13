import { describe, it } from 'vitest';
import assert from 'node:assert/strict';
import { classifyAstra, evaluateAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';

const body = [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'AGENT_LANE: GOVERNANCE',
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Only test-environment and repository-integrity guard maintenance.',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
  'REQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown',
].join('\n');
const exactFiles = [
  'tests/integration/global-setup.ts',
  'scripts/test/_supabase-admin.mjs',
  'scripts/ci/repo-integrity-guard.mjs',
];
const classify = (files: string[], policy = routing) => classifyAstra({ body, changedFiles: files }, policy);

describe('governance exact-file admission prerequisite (#384 / #380)', () => {
  it('admits exactly the three named guard files without broad directory grants', () => {
    assert.deepEqual(routing.workstreams.modelGovernance.scopeFiles, exactFiles);
    for (const file of exactFiles) {
      const result = classify([file]);
      assert.deepEqual(result.errors, []);
      assert.equal(result.required, false);
    }
    for (const prefix of ['scripts/test/', 'scripts/ci/', 'tests/integration/']) {
      assert.equal(routing.workstreams.modelGovernance.scopePrefixes.includes(prefix), false);
    }
  });

  it('rejects adjacent Product fixtures, data operations, deployment and runtime', () => {
    for (const file of [
      'scripts/test/seed.mjs', 'scripts/test/reset-db.mjs',
      'scripts/ci/vercel-ignore-build.mjs',
      'tests/integration/api/guide-action-inbox.43.test.ts',
      'src/server/line-events.ts', 'src/app/api/payments/callback/route.ts',
      'supabase/migrations/9999_not_governance.sql', 'vercel.json',
    ]) {
      const result = classify([...exactFiles, file]);
      assert.ok(result.errors.some((error) => error.includes(file)), file);
    }
  });

  it('does not treat exact files as filename prefixes or directories', () => {
    for (const file of exactFiles) {
      for (const suffix of ['.backup', '-deploy.mjs', '/child.ts']) {
        assert.ok(classify([file + suffix]).errors.length > 0, file + suffix);
      }
    }
  });

  it('does not normalize traversal, case or slash lookalikes into admission', () => {
    for (const file of [
      './scripts/test/_supabase-admin.mjs',
      'scripts/test/../test/_supabase-admin.mjs',
      'scripts/test//_supabase-admin.mjs',
      'scripts/test/_SUPABASE-admin.mjs',
      'scripts\\test\\_supabase-admin.mjs',
    ]) assert.ok(classify([file]).errors.length > 0, file);
  });

  it('rejects malformed exact-file catalogs instead of weakening the guard', () => {
    for (const scopeFiles of [null, '', {}, [''], ['scripts/test/'],
      ['../escape.mjs'], ['scripts/../escape.mjs'], ['*.mjs'],
      [' scripts/test/_supabase-admin.mjs'], [exactFiles[0], exactFiles[0]]]) {
      const policy = structuredClone(routing);
      policy.workstreams.modelGovernance.scopeFiles = scopeFiles;
      assert.ok(classify(['scripts/agents/example.mjs'], policy).errors.length > 0);
    }
  });

  it('preserves historical policy replay when scopeFiles is absent', () => {
    const policy = structuredClone(routing);
    delete policy.workstreams.modelGovernance.scopeFiles;
    assert.deepEqual(classify(['scripts/agents/example.mjs'], policy).errors, []);
    for (const file of exactFiles) assert.ok(classify([file], policy).errors.length > 0);
  });

  it('does not bypass missing or duplicate risk/workstream declarations', () => {
    for (const invalidBody of [
      body + '\nWORKSTREAM: MODEL_GOVERNANCE',
      body + '\nASTRA_RISK: NONE',
      body.replace('FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY', ''),
      body + '\n```\nunfinished example',
    ]) {
      assert.ok(classifyAstra({ body: invalidBody, changedFiles: exactFiles }).errors.length > 0);
    }
  });

  it('keeps active high-risk Product work pending without trusted Final Risk', () => {
    const productBody = body
      .replace('MODEL_GOVERNANCE', 'PRODUCT_MAINLINE')
      .replace('ASTRA_RISK: NONE', 'ASTRA_RISK: PAYMENT_CONSISTENCY')
      .replace('NOT_REQUIRED_BY_OWNER_POLICY', 'BY_PRODUCT_RISK_CLASSIFICATION');
    const result = evaluateAstra({
      body: productBody,
      changedFiles: ['src/app/api/payments/callback/route.ts'],
      reviews: [],
    });
    assert.equal(result.required, true);
    assert.equal(result.status, 'ASTRA_PENDING');
    assert.ok(result.errors.some((error) => error.includes('No trusted Astra')));
  });
});
