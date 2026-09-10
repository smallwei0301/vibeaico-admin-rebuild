import { describe, expect, it } from 'vitest';

import { classifyAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';

const noneBody = [
  'ASTRA_RISK: NONE',
  'ASTRA_RATIONALE: Fail-closed metrics hardening outside executable gate paths',
].join('\n');

const riskBody = (risk: string) => [
  `ASTRA_RISK: ${risk}`,
  `ASTRA_RATIONALE: ${risk} has a concrete high-consequence failure mode`,
].join('\n');

describe('Final Risk ROI routing boundary (#332)', () => {
  it('does not require Final Risk merely because fail-closed governance metrics live under scripts/metrics', () => {
    const result = classifyAstra({
      body: noneBody,
      changedFiles: ['scripts/metrics/governance-scoreboard.mjs'],
    });

    expect(result.errors).toEqual([]);
    expect(result.required).toBe(false);
  });

  it('keeps executable agent and workflow paths impossible to downgrade with ASTRA_RISK:NONE', () => {
    for (const path of [
      'scripts/agents/astra-review-policy.mjs',
      'scripts/agents/model-routing.json',
      '.github/workflows/agent-wip-guard.yml',
    ]) {
      const result = classifyAstra({ body: noneBody, changedFiles: [path] });
      expect(result.errors, path).toEqual([]);
      expect(result.required, path).toBe(true);
    }
  });

  it('keeps every configured catastrophic semantic risk on Final Risk even outside sensitive paths', () => {
    expect(routing.highRisk).toEqual([
      'PAYMENT_CONSISTENCY',
      'TENANT_AUTH_BOUNDARY',
      'IRREVERSIBLE_DATA',
      'CROSS_REPO_CONTRACT',
      'GOVERNANCE_GATE',
      'UNRESOLVED_HIGH_RISK',
    ]);

    for (const risk of routing.highRisk) {
      const result = classifyAstra({
        body: riskBody(risk),
        changedFiles: ['docs/non-sensitive-example.md'],
      });
      expect(result.errors, risk).toEqual([]);
      expect(result.required, risk).toBe(true);
    }
  });

  it('keeps explicit governance relaxation high-risk even when the changed file is not path-sensitive', () => {
    const result = classifyAstra({
      body: riskBody('GOVERNANCE_GATE'),
      changedFiles: ['docs/decisions/example-routing-change.md'],
    });

    expect(result.errors).toEqual([]);
    expect(result.required).toBe(true);
  });
});
