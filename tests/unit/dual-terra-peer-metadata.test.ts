import { describe, expect, it } from 'vitest';

import {
  pilotCapacity,
  summarizeActiveLanes,
  validateGlobalWip,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

const runId = '2026-09-02-dual-pilot-r01';

function pilotPr(number: number, issue: number, slot: number, active: boolean, ownership: string) {
  return {
    number,
    state: 'open',
    body: `<!-- pr-lifecycle
issue: ${issue}
state: ACTIVE
supersedes:
-->
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: ${runId}
- SCORECARD_PATH: docs/metrics/agent-runs/${runId}.json
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: ${active}
- CLOSEABILITY_SCORE: 4
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: local test, canonical test, audit and merge
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: REPORT:docs/metrics/agent-runs/${runId}.json
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: true
- TERRA_SLOT: ${slot}
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: AUTO_PR_${number}
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: ${ownership}`,
  };
}

describe('dual Terra peer validation', () => {
  it('revalidates the existing peer and normalizes declared ownership before unlocking slot two', () => {
    const summary = summarizeActiveLanes([
      pilotPr(20, 120, 1, false, './src//app/api/**'),
      pilotPr(21, 121, 2, true, 'src/app/api/chat'),
    ]);
    const errors = validateGlobalWip(summary);

    expect(errors).toContain(
      'Active Terra PR #20: An active TERRA_BUILD must set ACTIVE_CANDIDATE=true',
    );
    expect(errors.some((error) => error.includes('Dual Terra FILE_OWNERSHIP overlaps'))).toBe(true);
    expect(pilotCapacity(summary).qualified).toBe(false);
  });
});
