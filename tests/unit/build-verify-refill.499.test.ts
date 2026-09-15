import { describe, expect, it } from 'vitest';

import {
  parseLaneMetadata,
  summarizeActiveLanes,
  validateGlobalWip,
  validateLaneMetadata,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

const RUN_ID = '2026-09-15-throughput-r01';

function terraPr({
  number,
  issue,
  slot,
  state = 'ACTIVE',
  activeCandidate = true,
  dual = true,
}: {
  number: number;
  issue: number;
  slot: 1 | 2;
  state?: 'ACTIVE' | 'READY_FOR_PROMOTION';
  activeCandidate?: boolean;
  dual?: boolean;
}) {
  return {
    number,
    state: 'open',
    html_url: `https://example.test/${number}`,
    body: `<!-- pr-lifecycle
issue: ${issue}
state: ACTIVE
supersedes:
-->
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: ${RUN_ID}
- SCORECARD_PATH: docs/metrics/agent-runs/${RUN_ID}.json
- AGENT_LANE: TERRA_BUILD
- LANE_STATE: ${state}
- ACTIVE_CANDIDATE: ${activeCandidate}
- CLOSEABILITY_SCORE: 4
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: CI, Final Risk, merge and main readback
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: REPORT:docs/metrics/agent-runs/${RUN_ID}.json
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: ${dual}
- TERRA_SLOT: ${slot}
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: local-${number}
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: src/feature-${number}`,
  };
}

describe('Issue #499 BUILD / verification-tail refill semantics', () => {
  it('allows two BUILD lanes plus one READY_FOR_PROMOTION verification tail within WIP=3', () => {
    const rows = [
      terraPr({ number: 501, issue: 41, slot: 1 }),
      terraPr({ number: 502, issue: 42, slot: 2 }),
      terraPr({ number: 503, issue: 43, slot: 1, state: 'READY_FOR_PROMOTION' }),
    ];
    const summary = summarizeActiveLanes(rows);

    expect(summary.activeTerra.map((row) => row.number)).toEqual([501, 502]);
    expect(summary.verifyingTerra.map((row) => row.number)).toEqual([503]);
    expect(summary.activeCandidates.map((row) => row.number)).toEqual([501, 502, 503]);
    expect(validateGlobalWip(summary)).toEqual([]);
  });

  it('still rejects a fourth candidate even when the extra work is only a verification tail', () => {
    const rows = [
      terraPr({ number: 501, issue: 41, slot: 1 }),
      terraPr({ number: 502, issue: 42, slot: 2 }),
      terraPr({ number: 503, issue: 43, slot: 1, state: 'READY_FOR_PROMOTION' }),
      terraPr({ number: 504, issue: 44, slot: 2, state: 'READY_FOR_PROMOTION' }),
    ];

    expect(validateGlobalWip(summarizeActiveLanes(rows))).toContain(
      'ACTIVE_CANDIDATE count is 4; max is 3',
    );
  });

  it('allows two verification tails plus one BUILD, but a second BUILD is blocked by WIP=3', () => {
    const three = [
      terraPr({ number: 503, issue: 43, slot: 1, state: 'READY_FOR_PROMOTION' }),
      terraPr({ number: 504, issue: 44, slot: 2, state: 'READY_FOR_PROMOTION' }),
      terraPr({ number: 501, issue: 41, slot: 1 }),
    ];
    const summary = summarizeActiveLanes(three);

    expect(summary.activeTerra.map((row) => row.number)).toEqual([501]);
    expect(summary.verifyingTerra.map((row) => row.number)).toEqual([503, 504]);
    expect(validateGlobalWip(summary)).toEqual([]);

    const four = [...three, terraPr({ number: 502, issue: 42, slot: 2 })];
    expect(validateGlobalWip(summarizeActiveLanes(four))).toContain(
      'ACTIVE_CANDIDATE count is 4; max is 3',
    );
  });

  it('fails closed when a READY_FOR_PROMOTION Terra stops counting itself as a candidate', () => {
    const malformed = terraPr({
      number: 503,
      issue: 43,
      slot: 1,
      state: 'READY_FOR_PROMOTION',
      activeCandidate: false,
    });
    expect(validateLaneMetadata(parseLaneMetadata(malformed))).toContain(
      'READY_FOR_PROMOTION TERRA_BUILD must remain ACTIVE_CANDIDATE=true',
    );
  });

  it('fails closed when a READY_FOR_PROMOTION Terra drops its B+ run identity', () => {
    const malformed = terraPr({
      number: 503,
      issue: 43,
      slot: 1,
      state: 'READY_FOR_PROMOTION',
    });
    malformed.body = malformed.body
      .replace('- BPLUS_MODE: true', '- BPLUS_MODE: false')
      .replace(`- RUN_ID: ${RUN_ID}`, '- RUN_ID: none')
      .replace(`- SCORECARD_PATH: docs/metrics/agent-runs/${RUN_ID}.json`, '- SCORECARD_PATH: none');

    expect(validateLaneMetadata(parseLaneMetadata(malformed))).toEqual(expect.arrayContaining([
      'READY_FOR_PROMOTION TERRA_BUILD must keep BPLUS_MODE=true',
      'READY_FOR_PROMOTION TERRA_BUILD must declare RUN_ID',
      'READY_FOR_PROMOTION TERRA_BUILD must declare SCORECARD_PATH',
    ]));
  });

  it('does not let a verification tail count as an ACTIVE build lane', () => {
    const verifyingOnly = summarizeActiveLanes([
      terraPr({ number: 503, issue: 43, slot: 1, state: 'READY_FOR_PROMOTION' }),
    ]);
    expect(verifyingOnly.activeTerra).toHaveLength(0);
    expect(verifyingOnly.verifyingTerra).toHaveLength(1);
  });
});
