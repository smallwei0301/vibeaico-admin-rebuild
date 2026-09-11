import { describe, expect, it } from 'vitest';

import { classifyWorkstream, routing } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * 2026-09-11 Owner 決策後，MODEL_GOVERNANCE 不再綁 audit 層或任何指定模型。
 * trusted-main parser 在相容期仍保留 REQUESTED_MODEL / ACTUAL_MODEL 欄位：
 * 新治理工作用 NOT_APPLICABLE；既有在途治理 PR 的 Sol / Opus 值暫時 grandfather。
 * 這些相容值不得被解讀為治理模型政策或 Scoreboard model coverage。
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

describe('MODEL_GOVERNANCE model-agnostic parser compatibility', () => {
  it('設定明確關閉治理模型指定與模型分析，並指定 NOT_APPLICABLE sentinel', () => {
    const governance = routing.workstreams.modelGovernance;
    expect(governance.modelSelectionRequired).toBe(false);
    expect(governance.modelAnalysisRequired).toBe(false);
    expect(governance.preferredMetadataSentinel).toBe('NOT_APPLICABLE');
    expect(governance.allowedModels).toContain('NOT_APPLICABLE');
  });

  it('新治理工作使用 NOT_APPLICABLE 可通過 parser', () => {
    expect(classify('requested=NOT_APPLICABLE; actual=NOT_APPLICABLE').errors).toEqual([]);
  });

  it('既有在途治理 PR 的 Sol / Opus metadata 暫時 grandfather，不代表指定模型', () => {
    for (const model of ['gpt-5.6-sol', 'claude-opus-5']) {
      expect(classify(`requested=${model}; actual=${model}`).errors, model).toEqual([]);
    }
    expect(routing.workstreams.modelGovernance.allowedModels).toContain(routing.models.audit);
    expect(routing.workstreams.modelGovernance.allowedModels).toContain(routing.anthropicEquivalents.audit);
  });

  it('相容清單之外的值仍然 fail closed，避免任意 metadata 偷渡', () => {
    for (const model of ['gpt-5.6-terra', 'claude-sonnet-5', 'claude-haiku-4-5', 'gpt-5.6-luna', 'claude-fable-5-1']) {
      expect(classify(`requested=${model}; actual=${model}`).errors.join('\n'), model).toContain(
        'MODEL_GOVERNANCE requires requested/actual model to be one of',
      );
    }
  });

  it('requested 與 actual 各自都必須是 parser 相容值', () => {
    for (const line of [
      'requested=NOT_APPLICABLE; actual=claude-sonnet-5',
      'requested=claude-sonnet-5; actual=NOT_APPLICABLE',
    ]) {
      expect(classify(line).errors.length, line).toBeGreaterThan(0);
    }
  });

  it('逐值比對，不接受更長的相似字串', () => {
    for (const line of [
      'requested=NOT_APPLICABLE-preview; actual=NOT_APPLICABLE-preview',
      'requested=claude-opus-5x; actual=claude-opus-5x',
    ]) {
      expect(classify(line).errors.length, line).toBeGreaterThan(0);
    }
  });

  it('整行缺漏或留白仍然 fail closed', () => {
    for (const line of ['', 'requested=; actual=', 'unknown']) {
      expect(classify(line).errors.length, JSON.stringify(line)).toBeGreaterThan(0);
    }
  });
});
