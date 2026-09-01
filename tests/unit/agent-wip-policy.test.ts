import { describe, expect, it } from "vitest";

import {
  decideTestValidation,
  findActiveTestLaneHolders,
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
    CLOSURE_SWEEP_TARGET: "EMPTY_WITH_SCAN",
    TEST_LANE_REQUIRED: "false",
    WHY_NOT_CLOSER_CANDIDATE: "none",
    "REQUESTED_MODEL / ACTUAL_MODEL": "requested=Terra; actual=unknown",
    BPLUS_MODE: "true",
    RUN_ID: "2026-09-01-r01",
    RESERVE_BOUNDARY: "none",
    SCORECARD_PATH: "docs/metrics/agent-runs/2026-09-01-r01.json",
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
  return {
    number,
    state,
    body: body(overrides, issueNumber),
    html_url: `https://example.test/${number}`,
    head: { ref: `branch-${number}`, sha: `sha-${number}` },
  };
}

function reservePr(number: number, issueNumber = number) {
  return pr(number, {
    AGENT_LANE: "TERRA_RESERVE",
    ACTIVE_CANDIDATE: "false",
    TEST_LANE_REQUIRED: "false",
    RESERVE_BOUNDARY: "only one source-only slice; no TEST, Audit, AppShell or second commit",
    CLOSURE_SWEEP_TARGET: "none",
  }, "open", issueNumber);
}

function closurePr(number: number, issueNumber = number) {
  return pr(number, {
    AGENT_LANE: "LUNA_CLOSURE",
    ACTIVE_CANDIDATE: "true",
    TEST_LANE_REQUIRED: "false",
    CLOSEABILITY_SCORE: "4",
    CLOSURE_SWEEP_TARGET: `Issue #${issueNumber}`,
  }, "open", issueNumber);
}

function testPr(number: number, issueNumber = number) {
  return pr(number, {
    AGENT_LANE: "TEST_VALIDATION",
    ACTIVE_CANDIDATE: "false",
    TEST_LANE_REQUIRED: "true",
    CLOSURE_SWEEP_TARGET: "none",
  }, "open", issueNumber);
}

describe("B+ metadata parser", () => {
  it("parses the lifecycle Issue and exact slash field without crossing lines", () => {
    const row = parseLaneMetadata(pr(10));
    expect(row).toMatchObject({
      number: 10,
      issueNumber: 10,
      origin: "AGENT",
      lane: "TERRA_BUILD",
      state: "ACTIVE",
      bplusMode: "TRUE",
      runId: "2026-09-01-r01",
      requestedModel: "requested=Terra; actual=unknown",
    });
    expect(readLifecycleIssue(body({}, 44))).toBe(44);
    expect(readField(body(), "REQUESTED_MODEL / ACTUAL_MODEL")).toContain("requested=Terra");
  });

  it("does not impose Agent metadata on Owner work", () => {
    const row = parseLaneMetadata(pr(11, { WORK_ORIGIN: "OWNER", AGENT_LANE: "" }));
    expect(validateLaneMetadata(row)).toEqual([]);
  });
});

describe("B+ lane validation", () => {
  it("requires active delivery lanes to declare B+ run evidence", () => {
    const row = parseLaneMetadata(pr(10, { BPLUS_MODE: "false", RUN_ID: "", SCORECARD_PATH: "" }));
    expect(validateLaneMetadata(row)).toEqual(expect.arrayContaining([
      "An active B+ delivery lane must set BPLUS_MODE=true",
      "An active B+ delivery lane must declare RUN_ID",
      "An active B+ delivery lane must declare SCORECARD_PATH",
    ]));
  });

  it("requires the main Terra to be an active candidate and provide Closure evidence", () => {
    const row = parseLaneMetadata(pr(10, {
      ACTIVE_CANDIDATE: "false",
      CLOSURE_SWEEP_TARGET: "",
    }));
    expect(validateLaneMetadata(row)).toEqual(expect.arrayContaining([
      "An active TERRA_BUILD must set ACTIVE_CANDIDATE=true",
      "An active TERRA_BUILD must name a LUNA_CLOSURE target, EMPTY_WITH_SCAN, or REPORT:<path>",
    ]));
  });

  it("requires Reserve Terra to remain source-only and bounded", () => {
    const reserve = parseLaneMetadata(pr(20, {
      AGENT_LANE: "TERRA_RESERVE",
      ACTIVE_CANDIDATE: "true",
      TEST_LANE_REQUIRED: "true",
      RESERVE_BOUNDARY: "none",
    }));
    expect(validateLaneMetadata(reserve)).toEqual(expect.arrayContaining([
      "TERRA_RESERVE must set ACTIVE_CANDIDATE=false",
      "TERRA_RESERVE must set TEST_LANE_REQUIRED=false",
      "TERRA_RESERVE must declare a concrete RESERVE_BOUNDARY",
    ]));
  });

  it("requires Closure and TEST lanes to declare their roles", () => {
    const closure = parseLaneMetadata(pr(20, {
      AGENT_LANE: "LUNA_CLOSURE",
      ACTIVE_CANDIDATE: "false",
      TEST_LANE_REQUIRED: "true",
      CLOSEABILITY_SCORE: "2",
    }));
    expect(validateLaneMetadata(closure)).toEqual(expect.arrayContaining([
      "An active LUNA_CLOSURE must set ACTIVE_CANDIDATE=true",
      "An active LUNA_CLOSURE must have CLOSEABILITY_SCORE 3 or higher",
      "LUNA_CLOSURE must set TEST_LANE_REQUIRED=false",
    ]));

    const test = parseLaneMetadata(pr(30, {
      AGENT_LANE: "TEST_VALIDATION",
      ACTIVE_CANDIDATE: "true",
      TEST_LANE_REQUIRED: "false",
    }));
    expect(validateLaneMetadata(test)).toEqual(expect.arrayContaining([
      "TEST_VALIDATION must set ACTIVE_CANDIDATE=false",
      "An active TEST_VALIDATION lane must set TEST_LANE_REQUIRED=true",
    ]));
  });

  it("rejects a new commit on a parked PR", () => {
    const parked = parseLaneMetadata(pr(40, {
      LANE_STATE: "PARKED",
      ACTIVE_CANDIDATE: "false",
      BPLUS_MODE: "false",
    }));
    expect(validateLaneMetadata(parked, { action: "synchronize" })).toContain(
      "A PARKED PR received a new commit; reactivate it through Sol TRIAGE before pushing",
    );
  });
});

describe("global B+ WIP limits", () => {
  it("accepts one main Terra, one Reserve, one Closure and one TEST holder", () => {
    const rows = [
      pr(10, { CLOSURE_SWEEP_TARGET: "Issue #20" }, "open", 10),
      reservePr(11, 11),
      closurePr(20, 20),
      testPr(30, 10),
    ];
    expect(validateGlobalWip(summarizeActiveLanes(rows))).toEqual([]);
  });

  it("rejects second Main, Reserve, Closure, TEST and third active candidate", () => {
    const rows = [
      pr(10, { CLOSURE_SWEEP_TARGET: "Issue #20" }),
      pr(11, { CLOSURE_SWEEP_TARGET: "Issue #20" }),
      reservePr(12),
      reservePr(13),
      closurePr(20),
      closurePr(21),
      testPr(30),
      testPr(31),
    ];
    const errors = validateGlobalWip(summarizeActiveLanes(rows));
    expect(errors.some((value) => value.includes("active TERRA_BUILD count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("active TERRA_RESERVE count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("active LUNA_CLOSURE count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("active TEST_VALIDATION count is 2"))).toBe(true);
    expect(errors.some((value) => value.includes("ACTIVE_CANDIDATE count is 4"))).toBe(true);
  });

  it("requires Reserve to accompany a different Main Issue", () => {
    expect(validateGlobalWip(summarizeActiveLanes([reservePr(11)]))).toContain(
      "TERRA_RESERVE requires exactly one active MAIN TERRA_BUILD",
    );

    const errors = validateGlobalWip(summarizeActiveLanes([
      pr(10, { CLOSURE_SWEEP_TARGET: "EMPTY_WITH_SCAN" }, "open", 44),
      reservePr(11, 44),
    ]));
    expect(errors).toContain("TERRA_RESERVE and TERRA_BUILD cannot own the same Issue #44");
  });

  it("requires active Closure unless the Main has explicit scan/report evidence", () => {
    const noClosure = pr(10, { CLOSURE_SWEEP_TARGET: "Issue #20" });
    expect(validateGlobalWip(summarizeActiveLanes([noClosure]))).toContain(
      "an active TERRA_BUILD requires one active LUNA_CLOSURE or explicit EMPTY_WITH_SCAN/REPORT evidence; found 0",
    );

    const empty = pr(10, { CLOSURE_SWEEP_TARGET: "EMPTY_WITH_SCAN" });
    expect(validateGlobalWip(summarizeActiveLanes([empty]))).toEqual([]);
  });
});

describe("shared TEST owner policy", () => {
  it("runs heavy TEST on main, but not for a normal source-only PR", () => {
    expect(decideTestValidation({
      eventName: "push",
      ref: "refs/heads/main",
      sha: "main-sha",
    })).toMatchObject({ runTestValidation: true, reason: "main_push" });

    const current = pr(10);
    expect(decideTestValidation({
      eventName: "pull_request",
      ref: "refs/pull/10/merge",
      sha: "sha-10",
      currentPullRequest: current,
      openPullRequests: [current],
    })).toMatchObject({ runTestValidation: false, reason: "source_only_pr_without_test_lane" });
  });

  it("allows only the sole active TEST_VALIDATION holder", () => {
    const current = testPr(30);
    expect(findActiveTestLaneHolders([current]).map((row) => row.number)).toEqual([30]);
    expect(decideTestValidation({
      eventName: "pull_request",
      ref: "refs/pull/30/merge",
      sha: "sha-30",
      currentPullRequest: current,
      openPullRequests: [current],
    })).toMatchObject({
      runTestValidation: true,
      reason: "sole_active_test_validation_lane",
      holders: [30],
      error: null,
    });
  });

  it("fails closed when two PRs claim TEST", () => {
    const current = testPr(30);
    const decision = decideTestValidation({
      eventName: "pull_request",
      ref: "refs/pull/30/merge",
      sha: "sha-30",
      currentPullRequest: current,
      openPullRequests: [current, testPr(31)],
    });
    expect(decision.runTestValidation).toBe(false);
    expect(decision.reason).toBe("test_lane_conflict_2");
    expect(decision.error).toContain("not the sole TEST_VALIDATION holder");
  });

  it("authenticates branch dispatch with exact PR, ref and SHA", () => {
    const current = testPr(30);
    expect(decideTestValidation({
      eventName: "workflow_dispatch",
      ref: "refs/heads/branch-30",
      sha: "sha-30",
      currentPullRequest: current,
      openPullRequests: [current],
      inputs: {
        dispatch_reason: "lane_transition",
        test_lane_pr: "30",
        expected_head: "sha-30",
      },
    })).toMatchObject({ runTestValidation: true, reason: "validated_lane_transition_exact_head" });

    expect(decideTestValidation({
      eventName: "workflow_dispatch",
      ref: "refs/heads/branch-30",
      sha: "sha-30",
      currentPullRequest: current,
      openPullRequests: [current],
      inputs: {
        dispatch_reason: "lane_transition",
        test_lane_pr: "30",
        expected_head: "old-sha",
      },
    })).toMatchObject({ runTestValidation: false, reason: "invalid_dispatch_expected_head" });
  });

  it("never runs heavy TEST for docs-only changes", () => {
    const current = testPr(30);
    expect(decideTestValidation({
      eventName: "pull_request",
      docsOnly: true,
      currentPullRequest: current,
      openPullRequests: [current],
    })).toMatchObject({ runTestValidation: false, reason: "docs_only" });
  });
});
