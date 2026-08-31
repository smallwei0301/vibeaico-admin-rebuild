import { describe, expect, it } from "vitest";

import {
  parseLaneMetadata,
  readField,
  readLifecycleIssue,
  summarizeActiveLanes,
  validateGlobalWip,
  validateLaneMetadata,
} from "../../scripts/agents/agent-wip-policy.mjs";

function body(overrides: Record<string, string> = {}, issueNumber = 1) {
  const values = {
    WORK_ORIGIN: "AGENT",
    AGENT_LANE: "TERRA_BUILD",
    LANE_STATE: "ACTIVE",
    ACTIVE_CANDIDATE: "true",
    CLOSEABILITY_SCORE: "4",
    SELECTION_REASON: "CLOSE_READY",
    REMAINING_AUTONOMOUS_STEPS: "one targeted test",
    OWNER_OR_EXTERNAL_BLOCKER: "none",
    CLOSURE_SWEEP_TARGET: "",
    TEST_LANE_REQUIRED: "false",
    WHY_NOT_CLOSER_CANDIDATE: "none",
    "REQUESTED_MODEL / ACTUAL_MODEL": "requested=Terra; actual=unknown",
    ...overrides,
  };
  const rows = Object.entries(values).map(([key, value]) => `- ${key}: ${value}`).join("\n");
  return `<!-- pr-lifecycle\nissue: ${issueNumber}\nstate: ACTIVE\nsupersedes:\n-->\n\n${rows}`;
}

function pr(
  number: number,
  overrides: Record<string, string> = {},
  state = "open",
  issueNumber = number,
) {
  return { number, state, body: body(overrides, issueNumber), html_url: `https://example.test/${number}` };
}

describe("agent WIP metadata parser", () => {
  it("parses lifecycle Issue, exact slash field and normalized enums", () => {
    const row = parseLaneMetadata(pr(10));
    expect(row).toMatchObject({
      number: 10,
      issueNumber: 10,
      origin: "AGENT",
      lane: "TERRA_BUILD",
      state: "ACTIVE",
      activeCandidate: "TRUE",
      closeability: "4",
      requestedModel: "requested=Terra; actual=unknown",
    });
    expect(readLifecycleIssue(body({}, 44))).toBe(44);
    expect(readField(body(), "REQUESTED_MODEL / ACTUAL_MODEL")).toContain("requested=Terra");
  });

  it("does not impose agent metadata on Owner work", () => {
    const row = parseLaneMetadata(pr(11, { WORK_ORIGIN: "OWNER", AGENT_LANE: "" }));
    expect(validateLaneMetadata(row)).toEqual([]);
  });
});

describe("lane-level validation", () => {
  it("requires an active Terra to declare one Issue and be a candidate, but not a Closure target", () => {
    const missingIssueBody = body({
      ACTIVE_CANDIDATE: "false",
      CLOSURE_SWEEP_TARGET: "",
    }).replace("issue: 1", "issue:");
    const row = parseLaneMetadata({ number: 10, state: "open", body: missingIssueBody });
    expect(validateLaneMetadata(row)).toEqual(expect.arrayContaining([
      "An active TERRA_BUILD must declare pr-lifecycle issue: <number>",
      "An active TERRA_BUILD must set ACTIVE_CANDIDATE=true",
    ]));
    expect(validateLaneMetadata(row)).not.toContain(
      "An active TERRA_BUILD must name a CLOSURE_SWEEP_TARGET or EMPTY_WITH_SCAN",
    );
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

describe("Mode C WIP limits", () => {
  it("accepts multiple Terra builds for different Issues with no Closure lane", () => {
    const rows = [pr(10), pr(11), pr(12)];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it("also accepts one independent repo-wide Closure lane alongside multiple Terra builds", () => {
    const rows = [
      pr(10),
      pr(11),
      pr(20, { AGENT_LANE: "LUNA_CLOSURE", CLOSEABILITY_SCORE: "4" }),
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it("rejects two active Terra builds for the same Issue", () => {
    const rows = [
      pr(10, {}, "open", 44),
      pr(11, {}, "open", 44),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("Issue #44 active TERRA_BUILD count is 2; max is 1"))).toBe(true);
  });

  it("rejects two repo-wide Closure lanes", () => {
    const rows = [
      pr(10),
      pr(20, { AGENT_LANE: "LUNA_CLOSURE", CLOSEABILITY_SCORE: "4" }),
      pr(21, { AGENT_LANE: "LUNA_CLOSURE", CLOSEABILITY_SCORE: "4" }),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("active LUNA_CLOSURE count is 2; max is 1"))).toBe(true);
  });

  it("keeps shared TEST globally single-lane", () => {
    const rows = [
      pr(10),
      pr(30, { AGENT_LANE: "TEST_VALIDATION", TEST_LANE_REQUIRED: "true", ACTIVE_CANDIDATE: "false" }),
      pr(31, { AGENT_LANE: "TEST_VALIDATION", TEST_LANE_REQUIRED: "true", ACTIVE_CANDIDATE: "false" }),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("active TEST_VALIDATION count is 2; max is 1"))).toBe(true);
  });

  it("does not reintroduce a repo-wide active-candidate cap", () => {
    const rows = [pr(10), pr(11), pr(12), pr(13)];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it("keeps active-candidate budget per Issue", () => {
    const rows = [
      pr(40, { AGENT_LANE: "GOVERNANCE" }, "open", 44),
      pr(41, { AGENT_LANE: "GOVERNANCE" }, "open", 44),
      pr(42, { AGENT_LANE: "GOVERNANCE" }, "open", 44),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("Issue #44 ACTIVE_CANDIDATE count is 3; max is 2"))).toBe(true);
  });

  it("does not count parked or Owner PRs", () => {
    const rows = [
      pr(10),
      pr(11, { LANE_STATE: "PARKED", ACTIVE_CANDIDATE: "false" }),
      pr(12, { WORK_ORIGIN: "OWNER" }),
    ];
    const summary = summarizeActiveLanes(rows);
    expect(summary.activeTerra.map((row) => row.number)).toEqual([10]);
    expect(validateGlobalWip(summary)).toEqual([]);
  });
});
