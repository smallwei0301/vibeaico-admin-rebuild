import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');
const retrospective = read('.agents/skills/vibeaico-agent-retrospective/SKILL.md');
const scoreboard = read('docs/GOVERNANCE-SCOREBOARD.md');

describe('retrospective scoreboard contract after Owner #360', () => {
  it('requires Governance Scoreboard even when Product trend is NOT_GRADED', () => {
    expect(retrospective).toContain('docs/GOVERNANCE-SCOREBOARD.md');
    expect(retrospective).toContain('docs/metrics/governance-scoreboard-policy.json');
    expect(retrospective).toContain('Governance Scoreboard is a mandatory retrospective input');
    expect(retrospective).toContain('PRODUCT_RUN_TREND: NOT_GRADED');
    expect(retrospective).toContain('Still calculate and report the Governance Scoreboard');
  });

  it('keeps Product Delivery and Governance as separate score surfaces', () => {
    expect(retrospective).toContain('Two score surfaces are mandatory');
    expect(retrospective).toContain('PRODUCT DELIVERY SCORE / TREND');
    expect(retrospective).toContain('GOVERNANCE SCOREBOARD');
  });

  it('does not analyze model choice for MODEL_GOVERNANCE', () => {
    expect(retrospective).toContain('do not analyze which model performed MODEL_GOVERNANCE work');
    expect(retrospective).toContain('No governance model identity metric belongs in this list');
    expect(scoreboard).toContain('MODEL_GOVERNANCE 不指定模型，也不分析使用哪個模型');
    expect(scoreboard).toContain('不要呈現 MODEL_GOVERNANCE');
    expect(scoreboard).toContain('不需要回答「這輪治理是由哪個模型做的」');
  });

  it('preserves historical scoreboard evidence while leaving Product routing unchanged', () => {
    expect(scoreboard).toContain('Historical contract v1 保留、不可改寫');
    expect(scoreboard).toContain('68.4% (13/19)');
    expect(retrospective).toContain('This decision does **not** change PRODUCT_MAINLINE model routing');
  });
});
