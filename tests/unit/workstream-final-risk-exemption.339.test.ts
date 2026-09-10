import { describe, expect, it } from 'vitest';
import { classifyAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';

/**
 * #339／#343 在文件上豁免了 `MODEL_GOVERNANCE` 的 Final Risk，但守門程式一直沒有實作，
 * `classifyAstra()` 仍是 `required = sensitive || highRisk`。本測試鎖住補上的實作。
 *
 * 這是一個**放寬閘門**的變更，因此絕大多數斷言都在證明它**擋得住繞道**，而不是證明豁免會生效。
 * 真正重要的是下面每一條 `required === true` 的案例。
 */
const GOV = 'scripts/agents/model-routing.json';
const RATIONALE = 'ASTRA_RATIONALE: 具體風險評估，僅調整治理設定，不觸及產品 runtime。';

const body = (patch: Record<string, string> = {}) => {
  const fields: Record<string, string> = {
    WORKSTREAM: 'MODEL_GOVERNANCE',
    ASTRA_RISK: 'NONE',
    ...patch,
  };
  return [
    ...Object.entries(fields).map(([k, v]) => `${k}: ${v}`),
    RATIONALE,
  ].join('\n');
};
const classify = (files: string[], patch: Record<string, string> = {}) =>
  classifyAstra({ body: body(patch), changedFiles: files });

describe('MODEL_GOVERNANCE 的 Final Risk 豁免（#339 驗收第一項）', () => {
  it('治理 workstream ＋ 只碰 scripts/agents/ → 豁免', () => {
    const result = classify([GOV, 'CLAUDE.md']);
    expect(result.governanceExempt).toBe(true);
    expect(result.required).toBe(false);
    expect(result.errors).toEqual([]);
  });

  it('沒有 WORKSTREAM 欄位 → 不豁免（缺漏不得形成 bypass）', () => {
    const result = classifyAstra({ body: `ASTRA_RISK: NONE\n${RATIONALE}`, changedFiles: [GOV] });
    expect(result.governanceExempt).toBe(false);
    expect(result.required).toBe(true);
  });

  it.each([
    ['UNKNOWN', 'UNKNOWN'],
    ['拼錯', 'MODEL_GOVERANCE'],
    ['大小寫不符', 'model_governance'],
    ['前綴混充', 'MODEL_GOVERNANCE_EXEMPT'],
    ['空值', ''],
    ['另一軌', 'PRODUCT_MAINLINE'],
  ])('WORKSTREAM 為 %s → 不豁免', (_label, value) => {
    const result = classify([GOV], { WORKSTREAM: value });
    expect(result.governanceExempt).toBe(false);
    expect(result.required).toBe(true);
  });

  it('混入產品 sensitive path → 整張 PR 不豁免（不得靠填治理逃避產品 gate）', () => {
    for (const productPath of [
      'src/server/payment/charge.ts',
      'src/server/auth/session.ts',
      'src/server/refund/index.ts',
      'src/app/api/payments/route.ts',
      'src/app/api/payment-methods/route.ts',
      '.github/workflows/ci.yml',
    ]) {
      const result = classify([GOV, productPath]);
      expect(result.governanceExempt, `${productPath} 不應被豁免`).toBe(false);
      expect(result.required, `${productPath} 應強制 Final Risk`).toBe(true);
    }
  });

  it('宣告任何 highRisk → 即使是治理 workstream 仍強制 Final Risk', () => {
    for (const risk of routing.highRisk) {
      const result = classify([GOV], { ASTRA_RISK: risk });
      expect(result.required, `${risk} 應強制 Final Risk`).toBe(true);
    }
  });

  it('豁免清單只含 scripts/agents/，未涵蓋 .github/workflows/', () => {
    expect(routing.workstreamPolicy.exemptSensitivePaths).toEqual(['scripts/agents/']);
    expect(routing.workstreamPolicy.exemptWorkstream).toBe('MODEL_GOVERNANCE');
    expect(routing.sensitivePaths).toContain('.github/workflows/');
  });

  it('完全沒碰 sensitive path 時不宣稱豁免（豁免只對 sensitive 命中有意義）', () => {
    const result = classify(['README.md']);
    expect(result.governanceExempt).toBe(false);
    expect(result.required).toBe(false);
  });

  it('設定殘缺一律 fail closed', () => {
    const cases = [
      { ...routing, workstreamPolicy: undefined },
      { ...routing, workstreamPolicy: {} },
      { ...routing, workstreamPolicy: { exemptWorkstream: 'MODEL_GOVERNANCE', exemptSensitivePaths: [] } },
      { ...routing, workstreamPolicy: { exemptWorkstream: '', exemptSensitivePaths: ['scripts/agents/'] } },
      { ...routing, workstreamPolicy: { exemptWorkstream: 'MODEL_GOVERNANCE', exemptSensitivePaths: [''] } },
      { ...routing, workstreamPolicy: { exemptWorkstream: 'MODEL_GOVERNANCE', exemptSensitivePaths: ['scripts/agents/', 42] } },
      { ...routing, workstreamPolicy: { exemptWorkstream: 'MODEL_GOVERNANCE', exemptSensitivePaths: 'scripts/agents/' } },
    ];
    for (const [index, policy] of cases.entries()) {
      const result = classifyAstra({ body: body(), changedFiles: [GOV] }, policy as typeof routing);
      expect(result.governanceExempt, `case ${index} 應 fail closed`).toBe(false);
      expect(result.required, `case ${index} 應強制 Final Risk`).toBe(true);
    }
  });

  it('豁免不會讓既有的欄位驗證失效', () => {
    const missingRationale = classifyAstra({
      body: 'WORKSTREAM: MODEL_GOVERNANCE\nASTRA_RISK: NONE',
      changedFiles: [GOV],
    });
    expect(missingRationale.errors).toContain('ASTRA_RATIONALE requires a concrete risk assessment');

    const noFiles = classifyAstra({ body: body(), changedFiles: [] });
    expect(noFiles.errors).toContain('Astra classification requires actual changed files');
    expect(noFiles.governanceExempt).toBe(false);
  });
});
