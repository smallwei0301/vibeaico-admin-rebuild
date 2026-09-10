import { describe, expect, it } from 'vitest';
import { classifyAstra, evaluateAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { classifyWorkstream } from '../../scripts/agents/workstream-policy.mjs';

const governanceBody = [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: pure governance policy update with Sol-only review',
].join('\n');

const productBody = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: ordinary product change with explicit risk classification',
].join('\n');

const legacyProductBody = [
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: legacy product PR created before workstream metadata existed',
].join('\n');

describe('machine-readable workstream enforcement (#339)', () => {
  it('stores a separate workstream policy without changing Product Final Risk semantic version', () => {
    expect(routing.version).toBe('2026-09-08.4');
    expect(routing.workstreams.version).toBe('2026-09-10.1');
    expect(routing.workstreams.allowed).toEqual(['MODEL_GOVERNANCE', 'PRODUCT_MAINLINE']);
    expect(routing.workstreams.legacyMissingDefaultsTo).toBe('PRODUCT_MAINLINE');
    expect(routing.workstreams.invalidExplicitValue).toBe('REJECT');
    expect(routing.workstreams.modelGovernance.executorModel).toBe('gpt-5.6-sol');
    expect(routing.workstreams.modelGovernance.finalRiskPolicy).toBe('NOT_REQUIRED_BY_OWNER_POLICY');
  });

  it('recognizes a pure governance path set', () => {
    const result = classifyWorkstream({
      body: governanceBody,
      changedFiles: [
        'scripts/agents/model-routing.json',
        'scripts/agents/astra-review-policy.mjs',
        'scripts/agents/workstream-policy.mjs',
        'tests/unit/workstream-enforcement.339.test.ts',
      ],
    }, routing);
    expect(result.errors).toEqual([]);
    expect(result.workstream).toBe('MODEL_GOVERNANCE');
    expect(result.pureGovernance).toBe(true);
  });

  it('does not require Product Final Risk for pure MODEL_GOVERNANCE', () => {
    const result = classifyAstra({
      body: governanceBody,
      changedFiles: [
        'scripts/agents/model-routing.json',
        'scripts/agents/astra-review-policy.mjs',
        'scripts/agents/workstream-policy.mjs',
        'tests/unit/workstream-enforcement.339.test.ts',
      ],
    });
    expect(result.errors).toEqual([]);
    expect(result.workstream).toBe('MODEL_GOVERNANCE');
    expect(result.required).toBe(false);
  });

  it('fails closed when MODEL_GOVERNANCE mixes Product runtime or migration paths', () => {
    for (const path of ['src/server/payment/charge.ts', 'supabase/migrations/9999_bad.sql']) {
      const result = evaluateAstra({ body: governanceBody, changedFiles: ['scripts/agents/model-routing.json', path] });
      expect(result.status, path).toBe('ASTRA_PENDING');
      expect(result.errors.join('\n'), path).toContain('MODEL_GOVERNANCE contains non-governance paths');
    }
  });

  it('rejects explicit typo/UNKNOWN workstreams instead of defaulting them', () => {
    for (const value of ['MODEL_GOVERANCE', 'UNKNOWN']) {
      const result = evaluateAstra({
        body: governanceBody.replace('MODEL_GOVERNANCE', value),
        changedFiles: ['scripts/agents/model-routing.json'],
      });
      expect(result.status, value).toBe('ASTRA_PENDING');
      expect(result.errors.join('\n'), value).toContain('Invalid WORKSTREAM');
    }
  });

  it('keeps legacy missing WORKSTREAM on Product rules rather than granting a governance exemption', () => {
    const result = classifyAstra({ body: legacyProductBody, changedFiles: ['scripts/agents/model-routing.json'] });
    expect(result.errors).toEqual([]);
    expect(result.workstream).toBe('PRODUCT_MAINLINE');
    expect(result.required).toBe(true);
  });

  it('keeps explicit Product sensitive-path and high-risk behavior unchanged', () => {
    const sensitive = classifyAstra({ body: productBody, changedFiles: ['scripts/agents/model-routing.json'] });
    expect(sensitive.errors).toEqual([]);
    expect(sensitive.required).toBe(true);

    const highRisk = classifyAstra({
      body: productBody.replace('ASTRA_RISK: NONE', 'ASTRA_RISK: PAYMENT_CONSISTENCY'),
      changedFiles: ['src/lib/ordinary.ts'],
    });
    expect(highRisk.errors).toEqual([]);
    expect(highRisk.required).toBe(true);
  });

  it('keeps an ordinary explicit Product NONE change not-required', () => {
    const result = classifyAstra({ body: productBody, changedFiles: ['src/lib/ordinary.ts'] });
    expect(result.errors).toEqual([]);
    expect(result.workstream).toBe('PRODUCT_MAINLINE');
    expect(result.required).toBe(false);
  });
});
