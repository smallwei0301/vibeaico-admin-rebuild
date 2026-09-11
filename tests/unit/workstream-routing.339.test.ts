import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');

const orchestration = read('.agents/skills/vibeaico-agent-orchestration/SKILL.md');
const finalRisk = read('.agents/skills/vibeaico-astra-review/SKILL.md');
const routingDoc = read('docs/MODEL-ROUTING.md');
const decision = read('docs/decisions/2026-09-11-owner-model-governance-model-agnostic.md');
const prTemplate = read('.github/pull_request_template.md');
const discoveredTemplate = read('.github/ISSUE_TEMPLATE/agent-discovered.yml');
const deliveryTemplate = read('.github/ISSUE_TEMPLATE/delivery-slice.yml');

describe('two-workstream routing policy (#339)', () => {
  it('defines MODEL_GOVERNANCE as model-agnostic without Product Terra slots or Astra/Fable Final Risk', () => {
    for (const text of [orchestration, routingDoc, decision]) {
      expect(text).toContain('MODEL_GOVERNANCE');
      expect(text).toContain('PRODUCT_MAINLINE');
    }
    expect(orchestration).toContain('model-agnostic');
    expect(orchestration).toContain('Do not consume Product Terra or Reserve Terra slots for MODEL_GOVERNANCE');
    expect(orchestration).toContain('Do not dispatch Astra/Fable Product Final Risk for pure MODEL_GOVERNANCE');
    expect(orchestration).toContain('requested=NOT_APPLICABLE; actual=NOT_APPLICABLE');
    expect(decision).toContain('不要求 MODEL_GOVERNANCE 使用 Sol、Opus、Terra、Astra、Fable 或任何特定型號');
    expect(decision).toContain('不用分析使用哪個模型');
    expect(finalRisk).toContain('MODEL_GOVERNANCE');
    expect(finalRisk).toContain('立即停止本 skill');
    expect(finalRisk).toContain('model-agnostic governance');
  });

  it('keeps Product mainline model routing, risk and production authorization boundaries intact', () => {
    for (const text of [orchestration, routingDoc, decision, finalRisk]) {
      expect(text).toContain('PRODUCT_MAINLINE');
    }
    expect(routingDoc).toContain('PAYMENT_CONSISTENCY');
    expect(routingDoc).toContain('TENANT_AUTH_BOUNDARY');
    expect(routingDoc).toContain('IRREVERSIBLE_DATA');
    expect(routingDoc).toContain('CROSS_REPO_CONTRACT');
    expect(routingDoc).toContain('Terra 一律用 Sonnet');
    expect(decision).toContain('Production 高影響操作仍需既有具名授權');
    expect(decision).toContain('Product model routing、Terra builder 規則與 Product Final Risk model allowlist 完全不受本決策影響');
  });

  it('requires creation-time workstream classification in Issue and PR templates', () => {
    expect(prTemplate).toContain('WORKSTREAM: MODEL_GOVERNANCE | PRODUCT_MAINLINE');
    expect(discoveredTemplate).toContain('MODEL_GOVERNANCE');
    expect(discoveredTemplate).toContain('PRODUCT_MAINLINE');
    expect(deliveryTemplate).toContain('PRODUCT_MAINLINE');
    expect(deliveryTemplate).not.toContain('MODEL_GOVERNANCE');
  });

  it('fails mixed scope toward Product instead of letting governance become a bypass label', () => {
    expect(orchestration).toMatch(/mixed/i);
    expect(decision).toContain('無法安全拆分時整張改為 `PRODUCT_MAINLINE`');
    expect(routingDoc).toContain('混合範圍');
    for (const text of [orchestration, routingDoc, decision]) {
      expect(text).toContain('PRODUCT_MAINLINE');
    }
  });
});
