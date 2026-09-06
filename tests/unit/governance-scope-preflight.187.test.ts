import { describe, expect, it } from 'vitest';

import { validateWipPreflight } from '../../scripts/agents/agent-wip-preflight.mjs';
import { GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR } from '../../scripts/agents/governance-scope-budget.mjs';

function governanceBody(exception: string): string {
  return `<!-- pr-lifecycle
issue: 187
state: ACTIVE
supersedes: none
-->

- DELIVERY_UNIT_TYPE: GOVERNANCE
- PARENT_EPIC: none
- COUNT_IN_DELIVERY_OUTCOME: false
- RETROACTIVE_TRACKING_MIGRATION: false
- USER_VISIBLE_OUTCOME: none
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: 2026-09-04-governance-scope-exception-r01
- SCORECARD_PATH: none
- AGENT_LANE: GOVERNANCE
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 5
- SELECTION_REASON: GOVERNANCE
- REMAINING_AUTONOMOUS_STEPS: exact-head CI and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: #187
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- GOVERNANCE_SCOPE_EXCEPTION: ${exception}
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: false
- TERRA_SLOT: none
- TEST_PROFILE: SOURCE_ONLY
- TEST_ENV_ID: none
- FINAL_CANONICAL_REQUIRED: false
- FILE_OWNERSHIP: scripts/agents/governance-scope-budget.mjs
`;
}

describe('Issue #187 governance scope exception preflight', () => {
  it.each(['', 'none', 'NONE'])(
    'accepts %j as no local scope exception',
    (exception) => {
      const result = validateWipPreflight({ body: governanceBody(exception) });
      expect(result.errors).not.toContain(GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR);
      expect(result.valid).toBe(true);
    },
  );

  it('accepts canonical Owner Decision path shape without trusting its contents locally', () => {
    const result = validateWipPreflight({
      body: governanceBody('OWNER:docs/decisions/2026-09-04-scope.md'),
    });
    expect(result.errors).not.toContain(GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR);
    expect(result.valid).toBe(true);
  });

  it.each([
    'Owner said okay',
    'owner:docs/decisions/scope.md',
    'OWNER:docs/decisions/../scope.md',
    'OWNER:docs/decisions/a//scope.md',
    'OWNER:docs/decisions/scope.txt',
    'OWNER:docs/decisions/scope.md approved',
    'none/child',
  ])('rejects invalid form before PR creation: %s', (exception) => {
    const result = validateWipPreflight({ body: governanceBody(exception) });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain(GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR);
  });
});