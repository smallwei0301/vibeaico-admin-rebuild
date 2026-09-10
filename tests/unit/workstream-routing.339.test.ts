import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const orchestration = read('.agents/skills/vibeaico-agent-orchestration/SKILL.md');
const finalRisk = read('.agents/skills/vibeaico-astra-review/SKILL.md');
const routingDoc = read('docs/MODEL-ROUTING.md');
const decision = read('docs/decisions/2026-09-10-owner-two-workstream-sol-governance.md');
const prTemplate = read('.github/pull_request_template.md');
const discoveredTemplate = read('.github/ISSUE_TEMPLATE/agent-discovered.yml');
const deliveryTemplate = read('.github/ISSUE_TEMPLATE/delivery-slice.yml');

describe('two-workstream routing policy (#339)', () => {
  it('defines MODEL_GOVERNANCE as Sol-only without Terra or Astra/Fable Final Risk', () => {
    for (const text of [orchestration, routingDoc, decision]) {
      expect(text).toContain('MODEL_GOVERNANCE');
      expect(text).toContain('PRODUCT_MAINLINE');
      expect(text).toContain('Sol');
    }
    expect(orchestration).toContain('不派 Terra');
    expect(orchestration).toContain('不執行 Astra/Fable Final Risk');
    expect(decision).toContain('FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY');
    expect(finalRisk).toContain('MODEL_GOVERNANCE');
    expect(finalRisk).toContain('不載入本 skill');
  });

  it('keeps Product mainline risk and production authorization boundaries intact', () => {
    for (const text of [orchestration, routingDoc, decision, finalRisk]) {
      expect(text).toContain('PRODUCT_MAINLINE');
    }
    expect(routingDoc).toContain('PAYMENT_CONSISTENCY');
    expect(routingDoc).toContain('TENANT_AUTH_BOUNDARY');
    expect(routingDoc).toContain('IRREVERSIBLE_DATA');
    expect(routingDoc).toContain('CROSS_REPO_CONTRACT');
    expect(decision).toContain('Production DDL/DML/migration');
    expect(decision).toContain('LINE webhook');
  });

  it('requires creation-time workstream classification in Issue and PR templates', () => {
    expect(prTemplate).toContain('WORKSTREAM: MODEL_GOVERNANCE | PRODUCT_MAINLINE');
    expect(discoveredTemplate).toContain('MODEL_GOVERNANCE');
    expect(discoveredTemplate).toContain('PRODUCT_MAINLINE');
    expect(deliveryTemplate).toContain('PRODUCT_MAINLINE');
    expect(deliveryTemplate).not.toContain('MODEL_GOVERNANCE');
  });

  it('fails mixed scope toward Product instead of letting governance become a bypass label', () => {
    for (const text of [orchestration, routingDoc, decision]) {
      expect(text).toContain('PRODUCT_MAINLINE');
      expect(text).toMatch(/混合|mixed/i);
    }
    expect(decision).toContain('無法拆開');
  });
});
