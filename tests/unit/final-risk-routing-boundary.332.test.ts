import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
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

const astraSkill = readFileSync(
  resolve(process.cwd(), '.agents/skills/vibeaico-astra-review/SKILL.md'),
  'utf8',
);
const ownerDecision = readFileSync(
  resolve(process.cwd(), 'docs/decisions/2026-09-10-owner-final-risk-roi-routing.md'),
  'utf8',
);

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

  it('teaches agents to dispatch an allowlisted model instead of inventing an external reviewer channel', () => {
    for (const text of [astraSkill, ownerDecision]) {
      expect(text).toContain('model selector');
      expect(text).toContain('plugin');
      expect(text).toContain('connector');
      expect(text).toContain('MODEL_EXECUTION_UNAVAILABLE');
      expect(text).toContain('先改派模型，再談 unavailable');
    }

    expect(astraSkill).toContain('不是另一個 plugin、connector、MCP、外部服務');
    expect(astraSkill).toContain('不得因主 Session 本身不是 Astra/Fable');
    expect(ownerDecision).toContain('不是 plugin、connector、MCP、外部 provider channel');
    expect(ownerDecision).toContain('擴大原本可接受／可放行的候選集合');
    expect(ownerDecision).toContain('只增加拒絕條件');
  });
});
