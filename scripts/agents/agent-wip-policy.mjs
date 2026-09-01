const FIELD_NAMES = [
  "WORK_ORIGIN",
  "AGENT_LANE",
  "LANE_STATE",
  "ACTIVE_CANDIDATE",
  "CLOSEABILITY_SCORE",
  "SELECTION_REASON",
  "REMAINING_AUTONOMOUS_STEPS",
  "OWNER_OR_EXTERNAL_BLOCKER",
  "CLOSURE_SWEEP_TARGET",
  "TEST_LANE_REQUIRED",
  "WHY_NOT_CLOSER_CANDIDATE",
  "REQUESTED_MODEL / ACTUAL_MODEL",
  "BPLUS_MODE",
  "RUN_ID",
  "RESERVE_BOUNDARY",
  "SCORECARD_PATH",
];

export const ALLOWED = Object.freeze({
  lane: new Set(["TERRA_BUILD", "TERRA_RESERVE", "LUNA_CLOSURE", "TEST_VALIDATION", "GOVERNANCE"]),
  state: new Set(["ACTIVE", "PARKED", "COMPLETE", "OWNER_BLOCKED", "HISTORICAL", "READY_FOR_PROMOTION"]),
  boolean: new Set(["TRUE", "FALSE"]),
  reason: new Set([
    "CLOSE_READY",
    "DEPENDENCY_UNLOCKER",
    "P0_RUNTIME",
    "P1_SOURCE_HARDENING",
    "OWNER_DIRECTED",
    "GOVERNANCE",
  ]),
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readField(body = "", field) {
  // Do not use \s around one metadata row: \s consumes newlines and can swallow the next field.
  const pattern = new RegExp(
    `^[ \\t]*[-*]?[ \\t]*${escapeRegExp(field)}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`,
    "mi",
  );
  return (String(body).match(pattern)?.[1] ?? "").trim();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isPlaceholder(value) {
  const text = String(value ?? "").trim();
  return !text || text.includes("<!--") || text.includes("|") || /^(TBD|N\/A|UNKNOWN|-)$/i.test(text);
}

export function readLifecycleIssue(body = "") {
  const match = String(body).match(/<!--\s*pr-lifecycle([\s\S]*?)-->/i);
  if (!match) return null;
  const issueMatch = match[1].match(/^\s*issue\s*:\s*(\d+)\s*$/mi);
  if (!issueMatch) return null;
  const value = Number(issueMatch[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export function parseLaneMetadata(pr = {}) {
  const body = pr.body ?? "";
  return {
    number: Number(pr.number ?? 0),
    htmlUrl: pr.html_url ?? "",
    issueNumber: readLifecycleIssue(body),
    origin: upper(readField(body, "WORK_ORIGIN")),
    lane: upper(readField(body, "AGENT_LANE")),
    state: upper(readField(body, "LANE_STATE")),
    activeCandidate: upper(readField(body, "ACTIVE_CANDIDATE")),
    closeability: readField(body, "CLOSEABILITY_SCORE"),
    selectionReason: upper(readField(body, "SELECTION_REASON")),
    remainingSteps: readField(body, "REMAINING_AUTONOMOUS_STEPS"),
    blocker: readField(body, "OWNER_OR_EXTERNAL_BLOCKER"),
    closureTarget: readField(body, "CLOSURE_SWEEP_TARGET"),
    testLaneRequired: upper(readField(body, "TEST_LANE_REQUIRED")),
    whyNotCloser: readField(body, "WHY_NOT_CLOSER_CANDIDATE"),
    requestedModel: readField(body, "REQUESTED_MODEL / ACTUAL_MODEL"),
    bplusMode: upper(readField(body, "BPLUS_MODE")),
    runId: readField(body, "RUN_ID"),
    reserveBoundary: readField(body, "RESERVE_BOUNDARY"),
    scorecardPath: readField(body, "SCORECARD_PATH"),
  };
}

function isBplusDeliveryLane(metadata) {
  return ["TERRA_BUILD", "TERRA_RESERVE", "LUNA_CLOSURE", "TEST_VALIDATION"].includes(metadata.lane);
}

export function validateLaneMetadata(metadata, { action = "" } = {}) {
  if (metadata.origin !== "AGENT") return [];

  const errors = [];
  if (!ALLOWED.lane.has(metadata.lane)) errors.push("AGENT_LANE is missing or invalid");
  if (!ALLOWED.state.has(metadata.state)) errors.push("LANE_STATE is missing or invalid");
  if (!ALLOWED.boolean.has(metadata.activeCandidate)) errors.push("ACTIVE_CANDIDATE must be true or false");
  if (!/^[0-5]$/.test(metadata.closeability)) errors.push("CLOSEABILITY_SCORE must be 0..5");
  if (!ALLOWED.reason.has(metadata.selectionReason)) errors.push("SELECTION_REASON is missing or invalid");
  if (isPlaceholder(metadata.remainingSteps)) errors.push("REMAINING_AUTONOMOUS_STEPS is required");
  if (isPlaceholder(metadata.blocker)) errors.push("OWNER_OR_EXTERNAL_BLOCKER is required; use none when absent");
  if (!ALLOWED.boolean.has(metadata.testLaneRequired)) errors.push("TEST_LANE_REQUIRED must be true or false");
  if (isPlaceholder(metadata.requestedModel)) errors.push("REQUESTED_MODEL / ACTUAL_MODEL is required");

  if (metadata.state === "ACTIVE" && isBplusDeliveryLane(metadata)) {
    if (metadata.bplusMode !== "TRUE") errors.push("An active B+ delivery lane must set BPLUS_MODE=true");
    if (isPlaceholder(metadata.runId)) {
      errors.push("An active B+ delivery lane must declare RUN_ID");
    } else if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(metadata.runId)) {
      errors.push("RUN_ID must look like YYYY-MM-DD-name");
    }
    if (isPlaceholder(metadata.scorecardPath)) {
      errors.push("An active B+ delivery lane must declare SCORECARD_PATH");
    } else if (metadata.scorecardPath !== `docs/metrics/agent-runs/${metadata.runId}.json`) {
      errors.push("SCORECARD_PATH must be docs/metrics/agent-runs/<RUN_ID>.json");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TERRA_BUILD") {
    if (!metadata.issueNumber) errors.push("An active TERRA_BUILD must declare pr-lifecycle issue: <number>");
    if (metadata.activeCandidate !== "TRUE") errors.push("An active TERRA_BUILD must set ACTIVE_CANDIDATE=true");
    if (isPlaceholder(metadata.closureTarget)) {
      errors.push("An active TERRA_BUILD must name a LUNA_CLOSURE target, EMPTY_WITH_SCAN, or REPORT:<path>");
    }
    if (metadata.selectionReason === "CLOSE_READY" && Number(metadata.closeability) < 3) {
      errors.push("CLOSE_READY requires CLOSEABILITY_SCORE 3 or higher");
    }
    if (
      metadata.selectionReason !== "CLOSE_READY" &&
      (isPlaceholder(metadata.whyNotCloser) || /^none$/i.test(metadata.whyNotCloser))
    ) {
      errors.push("Non-CLOSE_READY Terra selection requires WHY_NOT_CLOSER_CANDIDATE");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TERRA_RESERVE") {
    if (!metadata.issueNumber) errors.push("An active TERRA_RESERVE must declare pr-lifecycle issue: <number>");
    if (metadata.activeCandidate !== "FALSE") errors.push("TERRA_RESERVE must set ACTIVE_CANDIDATE=false");
    if (metadata.testLaneRequired !== "FALSE") errors.push("TERRA_RESERVE must set TEST_LANE_REQUIRED=false");
    if (isPlaceholder(metadata.reserveBoundary) || /^none$/i.test(metadata.reserveBoundary)) {
      errors.push("TERRA_RESERVE must declare a concrete RESERVE_BOUNDARY");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "LUNA_CLOSURE") {
    if (metadata.activeCandidate !== "TRUE") errors.push("An active LUNA_CLOSURE must set ACTIVE_CANDIDATE=true");
    if (Number(metadata.closeability) < 3) errors.push("An active LUNA_CLOSURE must have CLOSEABILITY_SCORE 3 or higher");
    if (metadata.testLaneRequired !== "FALSE") errors.push("LUNA_CLOSURE must set TEST_LANE_REQUIRED=false");
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TEST_VALIDATION") {
    if (metadata.activeCandidate !== "FALSE") errors.push("TEST_VALIDATION must set ACTIVE_CANDIDATE=false");
    if (metadata.testLaneRequired !== "TRUE") errors.push("An active TEST_VALIDATION lane must set TEST_LANE_REQUIRED=true");
  }

  if (metadata.state === "PARKED") {
    if (metadata.activeCandidate === "TRUE") errors.push("A PARKED PR cannot be an active candidate");
    if (action === "synchronize") {
      errors.push("A PARKED PR received a new commit; reactivate it through Sol TRIAGE before pushing");
    }
  }

  return errors;
}

export function summarizeActiveLanes(pullRequests = []) {
  const activeAgentPulls = pullRequests
    .filter((pr) => pr.state === undefined || pr.state === "open")
    .map(parseLaneMetadata)
    .filter((metadata) => metadata.origin === "AGENT" && metadata.state === "ACTIVE");

  return {
    activeAgentPulls,
    activeTerra: activeAgentPulls.filter((pr) => pr.lane === "TERRA_BUILD"),
    activeReserve: activeAgentPulls.filter((pr) => pr.lane === "TERRA_RESERVE"),
    activeClosure: activeAgentPulls.filter((pr) => pr.lane === "LUNA_CLOSURE"),
    activeTest: activeAgentPulls.filter((pr) => pr.lane === "TEST_VALIDATION"),
    activeCandidates: activeAgentPulls.filter((pr) => pr.activeCandidate === "TRUE"),
  };
}

export function validateGlobalWip(summary) {
  const errors = [];
  const { activeTerra, activeReserve, activeClosure, activeTest, activeCandidates } = summary;

  if (activeTerra.length > 1) {
    errors.push(`active TERRA_BUILD count is ${activeTerra.length}; max is 1 (${activeTerra.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeReserve.length > 1) {
    errors.push(`active TERRA_RESERVE count is ${activeReserve.length}; max is 1 (${activeReserve.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeClosure.length > 1) {
    errors.push(`active LUNA_CLOSURE count is ${activeClosure.length}; max is 1 (${activeClosure.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeTest.length > 1) {
    errors.push(`active TEST_VALIDATION count is ${activeTest.length}; max is 1 (${activeTest.map((pr) => `#${pr.number}`).join(", ")})`);
  }
  if (activeCandidates.length > 2) {
    errors.push(`ACTIVE_CANDIDATE count is ${activeCandidates.length}; max is 2 (${activeCandidates.map((pr) => `#${pr.number}`).join(", ")})`);
  }

  if (activeReserve.length === 1) {
    if (activeTerra.length !== 1) errors.push("TERRA_RESERVE requires exactly one active MAIN TERRA_BUILD");
    if (activeTerra.length === 1 && activeReserve[0].issueNumber === activeTerra[0].issueNumber) {
      errors.push(`TERRA_RESERVE and TERRA_BUILD cannot own the same Issue #${activeTerra[0].issueNumber}`);
    }
  }

  if (activeTerra.length === 1) {
    const target = activeTerra[0].closureTarget.trim();
    const externalEvidence = /^EMPTY_WITH_SCAN$/i.test(target) || /^REPORT:/i.test(target);
    if (!externalEvidence && activeClosure.length !== 1) {
      errors.push(`an active TERRA_BUILD requires one active LUNA_CLOSURE or explicit EMPTY_WITH_SCAN/REPORT evidence; found ${activeClosure.length}`);
    }
  }

  return errors;
}

export function isActiveTestValidation(metadata) {
  return metadata.origin === "AGENT" &&
    metadata.lane === "TEST_VALIDATION" &&
    metadata.state === "ACTIVE" &&
    metadata.bplusMode === "TRUE" &&
    metadata.testLaneRequired === "TRUE";
}

export function findActiveTestLaneHolders(pullRequests = []) {
  return pullRequests
    .filter((pr) => pr.state === undefined || pr.state === "open")
    .map(parseLaneMetadata)
    .filter(isActiveTestValidation)
    .sort((a, b) => a.number - b.number);
}

export function decideTestValidation({
  eventName,
  ref,
  sha,
  docsOnly = false,
  currentPullRequest = null,
  openPullRequests = [],
  inputs = {},
} = {}) {
  const holders = findActiveTestLaneHolders(openPullRequests);
  const holderNumbers = holders.map((holder) => holder.number);
  const result = (runTestValidation, reason, error = null) => ({
    runTestValidation,
    reason,
    error,
    holders: holderNumbers,
  });

  if (docsOnly) return result(false, "docs_only");
  if (eventName === "push" && ref === "refs/heads/main") return result(true, "main_push");

  if (eventName === "pull_request") {
    const metadata = parseLaneMetadata(currentPullRequest ?? {});
    const requestsTest = metadata.origin === "AGENT" &&
      metadata.lane === "TEST_VALIDATION" && metadata.state === "ACTIVE";
    if (!requestsTest) return result(false, "source_only_pr_without_test_lane");

    const errors = validateLaneMetadata(metadata);
    if (errors.length || !isActiveTestValidation(metadata)) {
      return result(false, "invalid_test_lane_metadata", errors.join("; ") || "TEST lane metadata is invalid");
    }
    if (holders.length === 1 && holders[0].number === metadata.number) {
      return result(true, "sole_active_test_validation_lane");
    }
    return result(false, `test_lane_conflict_${holders.length}`,
      `PR #${metadata.number} is not the sole TEST_VALIDATION holder (holders: ${holderNumbers.join(",") || "none"})`);
  }

  if (eventName === "workflow_dispatch") {
    const dispatchReason = String(inputs.dispatch_reason ?? "").trim();
    const expectedHead = String(inputs.expected_head ?? "").trim();
    const requestedPr = String(inputs.test_lane_pr ?? "").trim();
    if (!expectedHead || expectedHead !== sha) {
      return result(false, "invalid_dispatch_expected_head", `expected_head must equal dispatched SHA ${sha}`);
    }
    if (ref === "refs/heads/main") {
      return dispatchReason === "main_manual"
        ? result(true, "manual_main_exact_head")
        : result(false, "invalid_main_dispatch_reason", "A main dispatch must use main_manual");
    }
    if (dispatchReason !== "lane_transition") {
      return result(false, "invalid_branch_dispatch_reason", "A branch dispatch is allowed only for lane_transition");
    }
    if (!/^\d+$/.test(requestedPr) || Number(requestedPr) < 1) {
      return result(false, "invalid_dispatch_pr_number", "A branch dispatch requires an open PR number");
    }

    const prNumber = Number(requestedPr);
    const pr = currentPullRequest ?? {};
    const branch = String(ref ?? "").replace(/^refs\/heads\//, "");
    const metadata = parseLaneMetadata(pr);
    const validPr = pr.state === "open" &&
      pr.head?.ref === branch &&
      pr.head?.sha === expectedHead &&
      isActiveTestValidation(metadata);
    if (!validPr) {
      return result(false, "invalid_dispatch_pr_contract", "The PR/ref/head does not match an open active TEST_VALIDATION candidate");
    }
    if (holders.length !== 1 || holders[0].number !== prNumber) {
      return result(false, `invalid_dispatch_test_lane_${holders.length}`,
        `PR #${prNumber} is not the sole TEST_VALIDATION holder (holders: ${holderNumbers.join(",") || "none"})`);
    }
    return result(true, "validated_lane_transition_exact_head");
  }

  return result(false, "unsupported_event_fail_closed", `Unsupported CI event: ${eventName || "unknown"}`);
}

export function requiredFieldNames() {
  return [...FIELD_NAMES];
}
