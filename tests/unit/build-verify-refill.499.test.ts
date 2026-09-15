import { describe, expect, it } from 'vitest';

import {
  summarizeActiveLanes,
  validateGlobalWip,
} from '../../scripts/agents/dual-terra-wip-policy.mjs';

const RUN_ID = '2026-09-15-throughput-r01';

function terraPr({
  number,
  issue,
  slot,
  completionClaim = 'IN_PROGRESS',
  activeCandidate = true,
  dual = true,
  ownership = `src/feature-${number}`,
}: {
  number: number;
  issue: number;
  slot: 1 | 2;
  completionClaim?: 'IN_PROGRESS' | 'AUDIT_READY';
  activeCandidate?: boolean;
  dual?: boolean;
  ownership?: string;
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
- LANE_STATE: ACTIVE
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
- FILE_OWNERSHIP: ${ownership}
- COMPLETION_CLAIM: ${completionClaim}`,
  };
}

describe('Issue #499 BUILD / verification-tail refill semantics', () => {
  it('allows two qualified BUILD lanes plus one qualified AUDIT_READY verification tail within WIP=3', () => {
    const rows = [
      terraPr({ number: 501, issue: 41, slot: 1 }),
      terraPr({ number: 502, issue: 42, slot: 2 }),
      terraPr({ number: 503, issue: 43, slot: 1, completionClaim: 'AUDIT_READY' }),
    ];
    const summary = summarizeActiveLanes(rows);

    expect(summary.activeTerra.map((row) => row.number)).toEqual([501, 502]);
    expect(summary.verifyingTerra.map((row) => row.number)).toEqual([503]);
    expect(summary.activeCandidates.map((row) => row.number)).toEqual([501, 502, 503]);
    expect(validateGlobalWip(summary)).toEqual([]);
  });

  it('still rejects a fourth candidate when a verification tail already uses the third WIP slot', () => {
    const rows = [
      terraPr({ number: 501, issue: 41, slot: 1 }),
      terraPr({ number: 502, issue: 42, slot: 2 }),
      terraPr({ number: 503, issue: 43, slot: 1, completionClaim: 'AUDIT_READY' }),
      terraPr({ number: 504, issue: 44, slot: 2, completionClaim: 'AUDIT_READY' }),
    ];

    expect(validateGlobalWip(summarizeActiveLanes(rows))).toContain(
      'ACTIVE_CANDIDATE count is 4; max is 3',
    );
  });

  it('allows two verification tails plus one BUILD, but a second BUILD is blocked by WIP=3', () => {
    const three = [
      terraPr({ number: 503, issue: 43, slot: 1, completionClaim: 'AUDIT_READY' }),
      terraPr({ number: 504, issue: 44, slot: 2, completionClaim: 'AUDIT_READY' }),
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

  it('does not let a qualified AUDIT_READY candidate count as a BUILD lane', () => {
    const summary = summarizeActiveLanes([
      terraPr({ number: 503, issue: 43, slot: 1, completionClaim: 'AUDIT_READY' }),
    ]);

    expect(summary.activeTerra).toHaveLength(0);
    expect(summary.verifyingTerra).toHaveLength(1);
    expect(summary.activeCandidates).toHaveLength(1);
  });

  it('keeps AUDIT_READY in BUILD occupancy when the dual/refill contract is not enabled', () => {
    const summary = summarizeActiveLanes([
      terraPr({
        number: 503,
        issue: 43,
        slot: 1,
        completionClaim: 'AUDIT_READY',
        dual: false,
      }),
    ]);

    expect(summary.activeTerra).toHaveLength(1);
    expect(summary.verifyingTerra).toHaveLength(0);
  });

  it('keeps IN_PROGRESS candidates in BUILD occupancy', () => {
    const summary = summarizeActiveLanes([
      terraPr({ number: 501, issue: 41, slot: 1, completionClaim: 'IN_PROGRESS', dual: false }),
    ]);

    expect(summary.activeTerra).toHaveLength(1);
    expect(summary.verifyingTerra).toHaveLength(0);
  });

  it('blocks a refill BUILD that overlaps an AUDIT_READY tail ownership boundary', () => {
    const summary = summarizeActiveLanes([
      terraPr({ number: 501, issue: 41, slot: 1, ownership: 'src/shared' }),
      terraPr({
        number: 503,
        issue: 43,
        slot: 2,
        completionClaim: 'AUDIT_READY',
        ownership: 'src/shared/route.ts',
      }),
    ]);

    expect(validateGlobalWip(summary)).toContain(
      'BUILD / AUDIT_READY FILE_OWNERSHIP overlaps: PR #501 <> PR #503: src/shared <> src/shared/route.ts',
    );
  });

  it('blocks overlapping verification tails that could conflict at merge', () => {
    const summary = summarizeActiveLanes([
      terraPr({
        number: 503,
        issue: 43,
        slot: 1,
        completionClaim: 'AUDIT_READY',
        ownership: 'src/shared',
      }),
      terraPr({
        number: 504,
        issue: 44,
        slot: 2,
        completionClaim: 'AUDIT_READY',
        ownership: 'src/shared/file.ts',
      }),
    ]);

    expect(validateGlobalWip(summary)).toContain(
      'AUDIT_READY FILE_OWNERSHIP overlaps: PR #503 <> PR #504: src/shared <> src/shared/file.ts',
    );
  });

  it('AUDIT_READY does not let a candidate escape ordinary active B+ validation', () => {
    const malformed = terraPr({
      number: 503,
      issue: 43,
      slot: 1,
      completionClaim: 'AUDIT_READY',
      activeCandidate: false,
    });

    const errors = validateGlobalWip(summarizeActiveLanes([malformed]));
    expect(errors).toContain(
      'Active Terra PR #503: An active TERRA_BUILD must set ACTIVE_CANDIDATE=true',
    );
  });
});
