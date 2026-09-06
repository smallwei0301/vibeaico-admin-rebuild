import { describe, expect, it } from 'vitest';

import {
  parseLaneMetadata,
  pilotCapacity,
  summarizeActiveLanes,
  validateGlobalWip,
  validateLaneMetadata,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

function pilotBody({
  issue,
  slot,
  env,
  ownership,
  runId = '2026-09-02-dual-pilot-r01',
}: {
  issue: number;
  slot: 1 | 2;
  env: string;
  ownership: string;
  runId?: string;
}) {
  return `<!-- pr-lifecycle
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
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 4
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: local isolated test, remote canonical queue, Sol Audit and merge
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: REPORT:docs/metrics/agent-runs/${runId}.json
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown
- DUAL_TERRA_PILOT: true
- TERRA_SLOT: ${slot}
- TEST_PROFILE: LOCAL_ISOLATED
- TEST_ENV_ID: ${env}
- FINAL_CANONICAL_REQUIRED: true
- FILE_OWNERSHIP: ${ownership}`;
}

function pilotPr(
  number: number,
  issue: number,
  slot: 1 | 2,
  env: string,
  ownership: string,
  runId?: string,
) {
  return {
    number,
    state: 'open',
    html_url: `https://example.test/${number}`,
    body: pilotBody({ issue, slot, env, ownership, runId }),
  };
}

function reservePr(number = 30) {
  const runId = '2026-09-02-dual-pilot-r01';
  return {
    number,
    state: 'open',
    body: `<!-- pr-lifecycle
issue: 30
state: ACTIVE
supersedes:
-->
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: ${runId}
- SCORECARD_PATH: docs/metrics/agent-runs/${runId}.json
- AGENT_LANE: TERRA_RESERVE
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: false
- CLOSEABILITY_SCORE: 3
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: one source-only commit
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: none
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: one source-only commit, no TEST or Audit
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra; actual=unknown`,
  };
}

describe('free dual Terra pilot', () => {
  it('accepts two complete Terra lanes only with distinct slots, environments, Issues and file ownership', () => {
    const rows = [
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat,src/components/chat'),
      pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services,src/components/services'),
    ];

    for (const row of rows) {
      expect(validateLaneMetadata(parseLaneMetadata(row))).toEqual([]);
    }
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it('keeps the previous one-Terra limit when the pilot contract is absent', () => {
    const rows = [
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat'),
      {
        ...pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services'),
        body: pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services').body.replace(
          '- DUAL_TERRA_PILOT: true',
          '- DUAL_TERRA_PILOT: false',
        ),
      },
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows)).join('\n')).toContain(
      'active TERRA_BUILD count is 2; max is 1 unless',
    );
  });

  it('rejects overlapping hot files, duplicate TEST environments and different Run IDs', () => {
    const rows = [
      pilotPr(20, 120, 1, 'AUTO_SHARED', 'src/app/api/chat'),
      pilotPr(21, 121, 2, 'AUTO_SHARED', 'src/app/api/chat/messages', '2026-09-02-other-run'),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors).toEqual(expect.arrayContaining([
      'Dual Terra lanes must declare different TEST_ENV_ID values',
      'Dual Terra lanes must belong to the same RUN_ID for one auditable pilot loop',
    ]));
    expect(errors.some((error) => error.includes('Dual Terra FILE_OWNERSHIP overlaps'))).toBe(true);
  });

  it('disables Reserve Terra while the pilot is active', () => {
    const rows = [
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat'),
      reservePr(),
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toContain(
      'TERRA_RESERVE is disabled while DUAL_TERRA_PILOT is active',
    );
  });

  it('requires local isolation and the final remote canonical gate on each pilot lane', () => {
    const malformed = pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat');
    malformed.body = malformed.body
      .replace('- TEST_PROFILE: LOCAL_ISOLATED', '- TEST_PROFILE: SOURCE_ONLY')
      .replace('- FINAL_CANONICAL_REQUIRED: true', '- FINAL_CANONICAL_REQUIRED: false');

    expect(validateLaneMetadata(parseLaneMetadata(malformed))).toEqual(expect.arrayContaining([
      'Dual Terra TERRA_BUILD must set TEST_PROFILE=LOCAL_ISOLATED',
      'Dual Terra TERRA_BUILD must set FINAL_CANONICAL_REQUIRED=true',
    ]));
  });

  it('does not count the shared Luna Closure lane as a third Product candidate', () => {
    const runId = '2026-09-02-dual-pilot-r01';
    const closure = {
      number: 22,
      state: 'open',
      body: `<!-- pr-lifecycle
issue: 122
state: ACTIVE
supersedes:
-->
- WORK_ORIGIN: AGENT
- BPLUS_MODE: true
- RUN_ID: ${runId}
- SCORECARD_PATH: docs/metrics/agent-runs/${runId}.json
- AGENT_LANE: LUNA_CLOSURE
- LANE_STATE: ACTIVE
- ACTIVE_CANDIDATE: true
- CLOSEABILITY_SCORE: 4
- SELECTION_REASON: CLOSE_READY
- REMAINING_AUTONOMOUS_STEPS: evidence and closeout
- OWNER_OR_EXTERNAL_BLOCKER: none
- CLOSURE_SWEEP_TARGET: Issue #122
- TEST_LANE_REQUIRED: false
- RESERVE_BOUNDARY: none
- WHY_NOT_CLOSER_CANDIDATE: none
- REQUESTED_MODEL / ACTUAL_MODEL: requested=Luna; actual=unknown`,
    };
    const summary = summarizeActiveLanes([
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat', runId),
      pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services', runId),
      closure,
    ]);
    expect(summary.activeCandidates.map((row) => row.number)).toEqual([20, 21]);
    expect(validateGlobalWip(summary)).toEqual([]);
  });

  it('reports capacity two after the first valid pilot lane and falls back on invalid contracts', () => {
    const valid = summarizeActiveLanes([
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat'),
    ]);
    expect(pilotCapacity(valid)).toEqual({ terraMax: 2, reserveMax: 0, qualified: true });

    const invalid = pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services');
    invalid.body = invalid.body.replace('- TEST_PROFILE: LOCAL_ISOLATED', '- TEST_PROFILE: SOURCE_ONLY');
    expect(pilotCapacity(summarizeActiveLanes([invalid]))).toEqual({
      terraMax: 1,
      reserveMax: 1,
      qualified: false,
    });
  });

  it('rejects a third complete Terra lane', () => {
    const rows = [
      pilotPr(20, 120, 1, 'AUTO_PR_20', 'src/app/api/chat'),
      pilotPr(21, 121, 2, 'AUTO_PR_21', 'src/app/api/services'),
      pilotPr(22, 122, 2, 'AUTO_PR_22', 'src/app/api/reports'),
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows)).some((error) =>
      error.includes('active TERRA_BUILD count is 3; max is 2'),
    )).toBe(true);
  });
});
