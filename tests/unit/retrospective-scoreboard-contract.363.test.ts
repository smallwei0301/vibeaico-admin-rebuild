import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const retrospective = read('.agents/skills/vibeaico-agent-retrospective/SKILL.md');
const scoreboardDoc = read('docs/GOVERNANCE-SCOREBOARD.md');
const policy = JSON.parse(read('docs/metrics/governance-scoreboard-policy.json'));

describe('retrospective scoreboard contract after 2026-09-11 Owner decision', () => {
  it('makes Governance Scoreboard a mandatory retrospective input even when Product trend is not graded', () => {
    expect(retrospective).toContain('docs/GOVERNANCE-SCOREBOARD.md');
    expect(retrospective).toContain('docs/metrics/governance-scoreboard-policy.json');
    expect(retrospective).toContain('Governance Scoreboard is a mandatory retrospective input');
    expect(retrospective).toContain('PRODUCT_RUN_TREND: NOT_GRADED');
    expect(retrospective).toContain('Still calculate and report the Governance Scoreboard');
  });

  it('keeps Product Delivery score and Governance Scoreboard as separate score surfaces', () => {
    expect(retrospective).toContain('Two score surfaces are mandatory');
    expect(retrospective).toContain('PRODUCT DELIVERY SCORE / TREND');
    expect(retrospective).toContain('GOVERNANCE SCOREBOARD');
  });

  it('removes model choice from MODEL_GOVERNANCE analysis without weakening Product routing', () => {
    expect(policy.contractVersion).toBe(2);
    expect(policy.modelIdentityAnalysisRequired).toBe(false);
    expect(scoreboardDoc).toContain('MODEL_GOVERNANCE 不指定模型，也不分析使用哪個模型');
    expect(scoreboardDoc).toContain('17 個 model-neutral core metrics');
    expect(retrospective).toContain('do not analyze which model performed MODEL_GOVERNANCE work');
    expect(retrospective).toContain('This decision does **not** change PRODUCT_MAINLINE model routing');
  });

  it('preserves contract v1 as read-only history instead of rewriting old scores', () => {
    expect(policy.legacyV1.contractVersion).toBe(1);
    expect(policy.historicalRunsAreReadOnly).toBe(true);
    expect(scoreboardDoc).toContain('Historical contract v1 保留、不可改寫');
    expect(retrospective).toContain('Preserve historical reports');
  });
});
