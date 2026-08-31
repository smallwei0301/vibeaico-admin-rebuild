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
];

export const ALLOWED = Object.freeze({
  lane: new Set(["TERRA_BUILD", "LUNA_CLOSURE", "TEST_VALIDATION", "GOVERNANCE"]),
  state: new Set(["ACTIVE", "PARKED", "COMPLETE", "OWNER_BLOCKED", "HISTORICAL"]),
  boolean: new Set(["TRUE", "FALSE"]),
  reason: new Set(["CLOSE_READY", "DEPENDENCY_UNLOCKER", "P0_RUNTIME", "OWNER_DIRECTED", "GOVERNANCE"]),
});

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function readField(body = "", field) {
  // Spaces and tabs are allowed around one metadata line. Do not use \s here because it also
  // consumes newlines and can accidentally treat the next metadata row as the current value.
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
  return !text || text.includes("<!--") || text.includes("|") || /^TBD$/i.test(text);
}

export function parseLaneMetadata(pr = {}) {
  const body = pr.body ?? "";
  return {
    number: Number(pr.number ?? 0),
    htmlUrl: pr.html_url ?? "",
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
  };
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

  if (metadata.state === "ACTIVE" && metadata.lane === "TERRA_BUILD") {
    if (metadata.activeCandidate !== "TRUE") {
      errors.push("An active TERRA_BUILD must set ACTIVE_CANDIDATE=true");
    }
    if (isPlaceholder(metadata.closureTarget)) {
      errors.push("An active TERRA_BUILD must name a CLOSURE_SWEEP_TARGET or EMPTY_WITH_SCAN");
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

  if (metadata.state === "ACTIVE" && metadata.lane === "LUNA_CLOSURE") {
    if (metadata.activeCandidate !== "TRUE") {
      errors.push("An active LUNA_CLOSURE must set ACTIVE_CANDIDATE=true");
    }
    if (Number(metadata.closeability) < 3) {
      errors.push("An active LUNA_CLOSURE must have CLOSEABILITY_SCORE 3 or higher");
    }
  }

  if (metadata.state === "ACTIVE" && metadata.lane === "TEST_VALIDATION") {
    if (metadata.testLaneRequired !== "TRUE") {
      errors.push("An active TEST_VALIDATION lane must set TEST_LANE_REQUIRED=true");
    }
  }

  if (metadata.state === "PARKED") {
    if (metadata.activeCandidate === "TRUE") {
      errors.push("A PARKED PR cannot be an active candidate");
    }
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
    activeClosure: activeAgentPulls.filter((pr) => pr.lane === "LUNA_CLOSURE"),
    activeTest: activeAgentPulls.filter((pr) => pr.lane === "TEST_VALIDATION"),
    activeCandidates: activeAgentPulls.filter((pr) => pr.activeCandidate === "TRUE"),
  };
}

export function validateGlobalWip(summary) {
  const errors = [];
  const { activeTerra, activeClosure, activeTest, activeCandidates } = summary;

  if (activeTerra.length > 1) {
    errors.push(`active TERRA_BUILD count is ${activeTerra.length}; max is 1 (${activeTerra.map((pr) => `#${pr.number}`).join(", ")})`);
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

  if (activeTerra.length === 1) {
    const target = activeTerra[0].closureTarget.trim();
    const emptyScan = /^EMPTY_WITH_SCAN$/i.test(target);
    if (!emptyScan && activeClosure.length !== 1) {
      errors.push(`an active TERRA_BUILD requires exactly one active LUNA_CLOSURE; found ${activeClosure.length}`);
    }
    if (emptyScan && activeClosure.length > 0) {
      errors.push("CLOSURE_SWEEP_TARGET is EMPTY_WITH_SCAN but an active LUNA_CLOSURE PR also exists");
    }
  }

  return errors;
}

export function requiredFieldNames() {
  return [...FIELD_NAMES];
}
