import { describe, expect, it } from 'vitest';

import {
  classifyAstra,
  evaluateAstra,
  routing,
} from '../../scripts/agents/astra-review-policy.mjs';

const AFTER = '2026-09-10T09:00:00Z';
const BEFORE = '2026-09-10T08:00:00Z';

const governanceBody = [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'AGENT_LANE: GOVERNANCE',
  'REQUESTED_MODEL / ACTUAL_MODEL: requested=gpt-5.6-sol; actual=gpt-5.6-sol',
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Pure Agent governance controller change with no Product runtime or provider behavior',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
].join('\n');

const productBody = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'AGENT_LANE: TERRA_BUILD',
  'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
  'ASTRA_RATIONALE: Changes tenant authorization behavior in Product runtime',
  'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION',
].join('\n');

describe('MODEL_GOVERNANCE executable workstream boundary (#339)', () => {
  it('keeps Product Final Risk policy version stable while versioning workstream policy independently', () => {
    expect(routing.version).toBe('2026-09-08.4');
    expect(routing.workstreams.version).toBe('2026-09-10.2');
    expect(routing.workstreams.allowed).toEqual(['MODEL_GOVERNANCE', 'PRODUCT_MAINLINE']);
  });

  it('accepts pure governance changed paths as Sol-only and does not require Astra/Fable', () => {
    const changedFiles = [
      'scripts/agents/astra-review-policy.mjs',
      '.github/workflows/issue-provenance.yml',
      'tests/unit/workstream-enforcement.339.test.ts',
    ];
    const risk = classifyAstra({ body: governanceBody, changedFiles, createdAt: AFTER });
    expect(risk).toMatchObject({ workstream: 'MODEL_GOVERNANCE', isModelGovernance: true, errors: [] });
    expect(risk.required).toBe(false);
    expect(evaluateAstra({ body: governanceBody, changedFiles, context: { createdAt: AFTER }, reviews: [] }).status).toBe('NOT_REQUIRED');
  });

  it('does not let MODEL_GOVERNANCE hide Product runtime, schema, provider, or deploy work', () => {
    for (const path of [
      'src/server/auth.ts',
      'supabase/migrations/0099_product.sql',
      'scripts/ci/production-deploy-canary.mjs',
      '.github/workflows/production-deploy-canary.yml',
      'vercel.json',
    ]) {
      const result = classifyAstra({ body: governanceBody, changedFiles: [path], createdAt: AFTER });
      expect(result.required, path).toBe(false);
      expect(result.errors.join('\n'), path).toContain('MODEL_GOVERNANCE contains Product/non-governance path');
    }
  });

  it('requires exact Sol-only governance metadata instead of accepting a label alone', () => {
    for (const body of [
      governanceBody.replace('AGENT_LANE: GOVERNANCE', 'AGENT_LANE: TERRA_BUILD'),
      governanceBody.replace('requested=gpt-5.6-sol', 'requested=gpt-5.6-terra'),
      governanceBody.replace('actual=gpt-5.6-sol', 'actual=gpt-5.6-terra'),
      governanceBody.replace('ASTRA_RISK: NONE', 'ASTRA_RISK: GOVERNANCE_GATE'),
      governanceBody.replace('FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY', 'FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION'),
    ]) {
      expect(classifyAstra({ body, changedFiles: ['scripts/agents/model-routing.json'], createdAt: AFTER }).errors.length).toBeGreaterThan(0);
    }
  });

  it('requires a valid workstream on new PRs but grandfathered legacy PRs keep their old risk path', () => {
    const legacy = [
      'AGENT_LANE: TERRA_BUILD',
      'ASTRA_RISK: TENANT_AUTH_BOUNDARY',
      'ASTRA_RATIONALE: Legacy Product auth PR created before workstream rollout',
    ].join('\n');

    const after = classifyAstra({ body: legacy, changedFiles: ['src/server/tenant.ts'], createdAt: AFTER });
    expect(after.errors.join('\n')).toContain('WORKSTREAM is required');

    const before = classifyAstra({ body: legacy, changedFiles: ['src/server/tenant.ts'], createdAt: BEFORE });
    expect(before.errors).toEqual([]);
    expect(before.required).toBe(true);
    expect(before.workstream).toBe('LEGACY_UNCLASSIFIED');
  });

  it('rejects invented workstreams and keeps PRODUCT_MAINLINE high-risk review unchanged', () => {
    const invented = governanceBody.replace('WORKSTREAM: MODEL_GOVERNANCE', 'WORKSTREAM: MAGIC_FAST_LANE');
    expect(classifyAstra({ body: invented, changedFiles: ['scripts/agents/model-routing.json'], createdAt: AFTER }).errors.join('\n')).toContain(
      'WORKSTREAM must be one of: MODEL_GOVERNANCE, PRODUCT_MAINLINE',
    );

    const product = classifyAstra({ body: productBody, changedFiles: ['src/server/tenant.ts'], createdAt: AFTER });
    expect(product.errors).toEqual([]);
    expect(product.workstream).toBe('PRODUCT_MAINLINE');
    expect(product.required).toBe(true);
  });
});
