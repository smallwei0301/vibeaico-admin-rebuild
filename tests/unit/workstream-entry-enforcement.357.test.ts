import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { classifyWorkstream } from '../../scripts/agents/astra-review-policy.mjs';

const read = (path: string) => readFileSync(resolve(process.cwd(), path), 'utf8');
const governanceTemplate = read('.github/ISSUE_TEMPLATE/governance.yml');
const issueConfig = read('.github/ISSUE_TEMPLATE/config.yml');
const issueWorkflow = read('.github/workflows/issue-provenance.yml');
const prWorkflow = read('.github/workflows/agent-workstream-classification.yml');
const decision = read('docs/decisions/2026-09-11-owner-workstream-entry-enforcement.md');
const AFTER = '2026-09-11T03:00:00Z';

const governanceBody = [
  'WORKSTREAM: MODEL_GOVERNANCE',
  'AGENT_LANE: GOVERNANCE',
  'REQUESTED_MODEL / ACTUAL_MODEL: requested=gpt-5.6-sol; actual=gpt-5.6-sol',
  'ASTRA_RISK: NONE',
  'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
].join('\n');

describe('two-workstream entry enforcement (#357)', () => {
  it('gives human governance work a dedicated MODEL_GOVERNANCE issue form and disables blank issues', () => {
    expect(governanceTemplate).toContain('模型／工作治理');
    expect(governanceTemplate).toContain('工作治理');
    expect(governanceTemplate).toContain('- MODEL_GOVERNANCE');
    expect(governanceTemplate).toContain('PRODUCT_MAINLINE');
    expect(issueConfig).toContain('blank_issues_enabled: false');
  });

  it('fails unclassified issues safe to Product instead of granting governance treatment', () => {
    expect(issueWorkflow).toContain("const effectiveWorkstream = workstreamValid ? result.workstream : 'PRODUCT_MAINLINE'");
    expect(issueWorkflow).toContain("nextLabels.push('governance:workstream-incomplete')");
    expect(issueWorkflow).toContain("'workstream:model-governance'");
    expect(issueWorkflow).toContain("'workstream:product-mainline'");
  });

  it('classifies every future PR, including Draft transitions, from trusted-main policy', () => {
    expect(prWorkflow).toContain('pull_request_target:');
    expect(prWorkflow).toContain('converted_to_draft');
    expect(prWorkflow).toContain('classifyWorkstream');
    expect(prWorkflow).toContain("context: 'Workstream Classification'");
    expect(prWorkflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(prWorkflow).toContain("effectiveWorkstream = valid && result.workstream === 'MODEL_GOVERNANCE'");
  });

  it('rejects a new PR without WORKSTREAM and accepts an explicitly classified Product PR', () => {
    const missing = classifyWorkstream({ body: '', changedFiles: ['docs/example.md'], createdAt: AFTER });
    expect(missing.errors.join('\n')).toContain('WORKSTREAM is required');

    const product = classifyWorkstream({
      body: 'WORKSTREAM: PRODUCT_MAINLINE',
      changedFiles: ['src/app/api/example/route.ts'],
      createdAt: AFTER,
    });
    expect(product.workstream).toBe('PRODUCT_MAINLINE');
    expect(product.errors).toEqual([]);
  });

  it('keeps work governance in MODEL_GOVERNANCE but fails mixed Product scope toward Product', () => {
    const governance = classifyWorkstream({
      body: governanceBody,
      changedFiles: ['.github/workflows/agent-workstream-classification.yml'],
      createdAt: AFTER,
    });
    expect(governance.errors).toEqual([]);
    expect(governance.isModelGovernance).toBe(true);

    const mixed = classifyWorkstream({
      body: governanceBody,
      changedFiles: ['src/server/auth.ts'],
      createdAt: AFTER,
    });
    expect(mixed.errors.join('\n')).toContain('MODEL_GOVERNANCE contains Product/non-governance path');

    expect(decision).toContain('工作治理／工程治理明確歸 `MODEL_GOVERNANCE`');
    expect(decision).toContain('無法安全拆時整張歸 `PRODUCT_MAINLINE`');
  });
});
