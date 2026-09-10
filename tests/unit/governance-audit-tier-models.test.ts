import { describe, expect, it } from 'vitest';

import { classifyWorkstream, routing } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * MODEL_GOVERNANCE 原本硬性要求 `requested/actual = gpt-5.6-sol` 這一個字面值。
 * 但 MODEL_GOVERNANCE 是 **audit 層**的工作，而 audit 層在兩個 provider 上各有一個模型：
 * OpenAI 側 `gpt-5.6-sol`、Anthropic 側 `claude-opus-5`（`anthropicEquivalents.audit`）。
 *
 * 後果是死結：在 Anthropic 側執行的治理 PR，欄位照實填 `claude-opus-5` 就永遠過不了守門，
 * 而修這條規則的 PR 自己也是治理 PR、也過不了（守門是 pull_request_target，讀的是 main 的程式）。
 * 唯一的出路曾經是動 branch protection，那代價太大。
 *
 * 本檔鎖住的修正：audit 層的兩個模型同層等價，都可執行 MODEL_GOVERNANCE；
 * 但**只有這兩個**，requested 與 actual 各自都必須落在清單內。
 */
const AFTER = '2026-09-10T09:00:00Z';
const GOVERNANCE_FILES = ['scripts/agents/model-routing.json'];

const bodyWith = (modelLine: string) =>
  [
    'WORKSTREAM: MODEL_GOVERNANCE',
    'AGENT_LANE: GOVERNANCE',
    `REQUESTED_MODEL / ACTUAL_MODEL: ${modelLine}`,
    'ASTRA_RISK: NONE',
    'ASTRA_RATIONALE: Pure Agent governance controller change with no Product runtime or provider behavior',
    'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
  ].join('\n');

const classify = (modelLine: string) =>
  classifyWorkstream({ body: bodyWith(modelLine), changedFiles: GOVERNANCE_FILES, createdAt: AFTER });

describe('MODEL_GOVERNANCE 接受整個 audit 層，而不是單一 provider 的字面值', () => {
  it('設定裡的 allowedModels 就是 audit 層在兩側的模型，且與 anthropicEquivalents.audit 一致', () => {
    expect(routing.workstreams.modelGovernance.allowedModels).toEqual(['gpt-5.6-sol', 'claude-opus-5']);
    expect(routing.workstreams.modelGovernance.allowedModels).toContain(routing.models.audit);
    expect(routing.workstreams.modelGovernance.allowedModels).toContain(routing.anthropicEquivalents.audit);
  });

  it('兩個 audit 層模型都放行', () => {
    for (const model of ['gpt-5.6-sol', 'claude-opus-5']) {
      expect(classify(`requested=${model}; actual=${model}`).errors, model).toEqual([]);
    }
  });

  it('如實記錄跨 provider 替代時，兩邊各自合規即可', () => {
    expect(classify('requested=gpt-5.6-sol; actual=claude-opus-5').errors).toEqual([]);
  });

  it('#342 當時被擋下的那一行，現在讀得過（含中文括號的補述）', () => {
    const line = 'requested=claude-opus-5, actual=claude-opus-5（治理屬 audit 層，依對照表為合規）';
    expect(classify(line).errors).toEqual([]);
  });

  it('清單之外的模型仍然擋下——build 層與 scout 層都不得執行治理', () => {
    for (const model of ['gpt-5.6-terra', 'claude-sonnet-5', 'claude-haiku-4-5', 'gpt-5.6-luna', 'claude-fable-5-1']) {
      expect(classify(`requested=${model}; actual=${model}`).errors.join('\n'), model).toContain(
        'MODEL_GOVERNANCE requires requested/actual model to be one of',
      );
    }
  });

  it('requested 合規不能替 actual 背書，反之亦然', () => {
    for (const line of ['requested=gpt-5.6-sol; actual=claude-sonnet-5', 'requested=claude-sonnet-5; actual=claude-opus-5']) {
      expect(classify(line).errors.length, line).toBeGreaterThan(0);
    }
  });

  it('逐值比對，不是子字串比對：更長的相似字串不算命中', () => {
    for (const line of [
      'requested=gpt-5.6-sol-preview; actual=gpt-5.6-sol-preview',
      'requested=claude-opus-5x; actual=claude-opus-5x',
    ]) {
      expect(classify(line).errors.length, line).toBeGreaterThan(0);
    }
  });

  it('整行缺漏或留白仍然 fail closed，不會因為「沒宣告」而放行', () => {
    for (const line of ['', 'requested=; actual=', 'unknown']) {
      expect(classify(line).errors.length, JSON.stringify(line)).toBeGreaterThan(0);
    }
  });
});
