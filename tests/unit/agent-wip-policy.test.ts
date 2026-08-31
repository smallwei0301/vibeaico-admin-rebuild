import { describe, expect, it } from "vitest";

import {
  parseLaneMetadata,
  readField,
  summarizeActiveLanes,
  validateGlobalWip,
  validateLaneMetadata,
} from "../../scripts/agents/agent-wip-policy.mjs";

function body(overrides: Record<string, string> = {}) {
  const values = {
    WORK_ORIGIN: "AGENT",
    AGENT_LANE: "TERRA_BUILD",
    LANE_STATE: "ACTIVE",
    ACTIVE_CANDIDATE: "true",
    CLOSEABILITY_SCORE: "4",
    SELECTION_REASON: "CLOSE_READY",
    REMAINING_AUTONOMOUS_STEPS: "one targeted test",
    OWNER_OR_EXTERNAL_BLOCKER: "none",
    CLOSURE_SWEEP_TARGET: "PR #20",
    TEST_LANE_REQUIRED: "false",
    WHY_NOT_CLOSER_CANDIDATE: "none",
    "REQUESTED_MODEL / ACTUAL_MODEL": "requested=Terra; actual=unknown",
    ...overrides,
  };
  return Object.entries(values).map(([key, value]) => `- ${key}: ${value}`).join("\n");
}

function pr(number: number, overrides: Record<string, string> = {}, state = "open") {
  return { number, state, body: body(overrides), html_url: `https://example.test/${number}` };
}

describe("agent WIP metadata parser", () => {
  it("parses the exact slash field and normalizes enums", () => {
    const row = parseLaneMetadata(pr(10));
    expect(row).toMatchObject({
      number: 10,
      origin: "AGENT",
      lane: "TERRA_BUILD",
      state: "ACTIVE",
      activeCandidate: "TRUE",
      closeability: "4",
      requestedModel: "requested=Terra; actual=unknown",
    });
    expect(readField(body(), "REQUESTED_MODEL / ACTUAL_MODEL")).toContain("requested=Terra");
  });

  it("does not impose agent metadata on Owner work", () => {
    const row = parseLaneMetadata(pr(11, { WORK_ORIGIN: "OWNER", AGENT_LANE: "" }));
    expect(validateLaneMetadata(row)).toEqual([]);
  });
});

describe("lane-level validation", () => {
  it("requires an active Terra to be a candidate and name a Closure Sweep", () => {
    const row = parseLaneMetadata(pr(10, {
      ACTIVE_CANDIDATE: "false",
      CLOSURE_SWEEP_TARGET: "",
    }));
    expect(validateLaneMetadata(row)).toEqual(expect.arrayContaining([
      "An active TERRA_BUILD must set ACTIVE_CANDIDATE=true",
      "An active TERRA_BUILD must name a CLOSURE_SWEEP_TARGET or EMPTY_WITH_SCAN",
    ]));
  });

  it("requires a non-close-ready Terra selection to justify skipping closer work", () => {
    const row = parseLaneMetadata(pr(10, {
      CLOSEABILITY_SCORE: "2",
      SELECTION_REASON: "DEPENDENCY_UNLOCKER",
      WHY_NOT_CLOSER_CANDIDATE: "none",
    }));
    expect(validateLaneMetadata(row)).toContain(
      "Non-CLOSE_READY Terra selection requires WHY_NOT_CLOSER_CANDIDATE",
    );
  });

  it("requires active Closure and TEST lanes to declare their role", () => {
    const closure = parseLaneMetadata(pr(20, {
      AGENT_LANE: "LUNA_CLOSURE",
      ACTIVE_CANDIDATE: "false",
      CLOSEABILITY_SCORE: "2",
    }));
    expect(validateLaneMetadata(closure)).toEqual(expect.arrayContaining([
      "An active LUNA_CLOSURE must set ACTIVE_CANDIDATE=true",
      "An active LUNA_CLOSURE must have CLOSEABILITY_SCORE 3 or higher",
    ]));

    const test = parseLaneMetadata(pr(30, {
      AGENT_LANE: "TEST_VALIDATION",
      ACTIVE_CANDIDATE: "false",
      TEST_LANE_REQUIRED: "false",
    }));
    expect(validateLaneMetadata(test)).toContain(
      "An active TEST_VALIDATION lane must set TEST_LANE_REQUIRED=true",
    );
  });

  it("fails a synchronize event on a parked PR", () => {
    const parked = parseLaneMetadata(pr(40, {
      LANE_STATE: "PARKED",
      ACTIVE_CANDIDATE: "false",
    }));
    expect(validateLaneMetadata(parked, { action: "synchronize" })).toContain(
      "A PARKED PR received a new commit; reactivate it through Sol TRIAGE before pushing",
    );
  });
});

describe("global WIP limits", () => {
  it("accepts one Terra plus one Closure candidate and one TEST lane", () => {
    const rows = [
      pr(10),
      pr(20, {
        AGENT_LANE: "LUNA_CLOSURE",
        CLOSEABILITY_SCORE: "4",
        CLOSURE_SWEEP_TARGET: "PR #20",
      }),
      pr(30, {
        AGENT_LANE: "TEST_VALIDATION",
        ACTIVE_CANDIDATE: "false",
        TEST_LANE_REQUIRED: "true",
        CLOSURE_SWEEP_TARGET: "PR #20",
      }),
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it("rejects a second Terra, TEST lane or third active candidate", () => {
    const rows = [
      pr(10),
      pr(11),
      pr(20, { AGENT_LANE: "LUNA_CLOSURE", CLOSEABILITY_SCORE: "4" }),
      pr(30, { AGENT_LANE: "TEST_VALIDATION", TEST_LANE_REQUIRED: "true", ACTIVE_CANDIDATE: "false" }),
      pr(31, { AGENT_LANE: "TEST_VALIDATION", TEST_LANE_REQUIRED: "true", ACTIVE_CANDIDATE: "false" }),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("active TERRA_BUILD count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("active TEST_VALIDATION count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("ACTIVE_CANDIDATE count is 3"))).toBe(true);
  });

  it("requires a visible Closure lane unless Terra reports EMPTY_WITH_SCAN", () => {
    expect(validateGlobalWip(summarizeActiveLanes([pr(10)]))).toContain(
      "an active TERRA_BUILD requires exactly one active LUNA_CLOSURE; found 0",
    );

    const empty = pr(10, { CLOSURE_SWEEP_TARGET: "EMPTY_WITH_SCAN" });
    expect(validateGlobalWip(summarizeActiveLanes([empty]))).toEqual([]);
  });

  it("does not count parked or Owner PRs", () => {
    const rows = [
      pr(10),
      pr(20, { AGENT_LANE: "LUNA_CLOSURE", CLOSEABILITY_SCORE: "4" }),
      pr(11, { LANE_STATE: "PARKED", ACTIVE_CANDIDATE: "false" }),
      pr(12, { WORK_ORIGIN: "OWNER" }),
    ];
    const summary = summarizeActiveLanes(rows);
    expect(summary.activeTerra.map((row) => row.number)).toEqual([10]);
    expect(summary.activeCandidates.map((row) => row.number)).toEqual([10, 20]);
    expect(validateGlobalWip(summary)).toEqual([]);
  });
});
