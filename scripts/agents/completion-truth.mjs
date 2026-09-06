const REACHABLE_STATUSES = new Set(["ahead", "identical"]);

export function evaluateMergedPullRequest({
  pullRequest,
  defaultBranchHead,
  compareStatus,
} = {}) {
  const errors = [];
  const pr = pullRequest ?? {};
  const mergeCommitSha = String(pr.merge_commit_sha ?? "").trim();
  const mergedAt = String(pr.merged_at ?? "").trim();
  const mainHead = String(defaultBranchHead ?? "").trim();
  const normalizedCompare = String(compareStatus ?? "").trim().toLowerCase();

  if (!Number.isInteger(Number(pr.number)) || Number(pr.number) < 1) {
    errors.push("pull request number is missing or invalid");
  }
  if (pr.state !== "closed") errors.push("pull request is not closed");
  if (!mergedAt && pr.merged !== true) errors.push("pull request is not marked merged");
  if (!mergeCommitSha) errors.push("merge_commit_sha is missing");
  if (!mainHead) errors.push("default branch head is missing");
  if (!REACHABLE_STATUSES.has(normalizedCompare)) {
    errors.push("merge commit is not verified as reachable from the default branch head");
  }

  return {
    verified: errors.length === 0,
    errors,
    pullRequestNumber: Number(pr.number) || null,
    mergedAt: mergedAt || null,
    mergeCommitSha: mergeCommitSha || null,
    defaultBranchHead: mainHead || null,
    compareStatus: normalizedCompare || null,
  };
}

export function classifyEvidenceSinkError(error) {
  const statusValue = error?.status ?? error?.response?.status ?? null;
  const parsedStatus = Number(statusValue);
  const status = Number.isFinite(parsedStatus) && parsedStatus > 0 ? parsedStatus : null;
  const message = String(error?.message ?? "unknown evidence sink error");

  return {
    status,
    message,
    code: status ? `HTTP_${status}` : "UNKNOWN",
    verificationInvalidated: false,
  };
}

export function formatCompletionTruth(result, verifiedAt = new Date().toISOString()) {
  const status = result.verified ? "VERIFIED_MERGED" : "MERGE_UNVERIFIED";
  const errors = result.errors.length ? result.errors.map((error) => `- ${error}`).join("\n") : "- none";

  return [
    "<!-- agent-completion-truth -->",
    "## Completion Truth Gate",
    "",
    `- STATUS: ${status}`,
    `- PR: ${result.pullRequestNumber ? `#${result.pullRequestNumber}` : "unknown"}`,
    `- MERGE_COMMIT_SHA: ${result.mergeCommitSha ?? "unknown"}`,
    `- DEFAULT_BRANCH_HEAD: ${result.defaultBranchHead ?? "unknown"}`,
    `- REACHABILITY: ${result.compareStatus ?? "unknown"}`,
    `- VERIFIED_AT: ${verifiedAt}`,
    "",
    "### Verification errors",
    "",
    errors,
    "",
    result.verified
      ? "This evidence was generated from live GitHub state after the merge event."
      : "Do not report this PR as merged until live GitHub evidence satisfies every check.",
  ].join("\n");
}

const DELIVERY_UNIT_TYPES = new Set(["SLICE", "STANDALONE"]);

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readField(body = "", field) {
  const pattern = new RegExp(
    `^[ \\t]*[-*]?[ \\t]*${escapeRegExp(field)}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`,
    "mi",
  );
  return (String(body).match(pattern)?.[1] ?? "").trim();
}

function readLifecycleIssue(body = "") {
  const block = String(body).match(/<!--\s*pr-lifecycle([\s\S]*?)-->/i)?.[1] ?? "";
  const value = Number(block.match(/^\s*issue\s*:\s*(\d+)\s*$/mi)?.[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function usableEvidence(value) {
  const text = String(value ?? "").trim();
  return Boolean(text && !text.includes("<!--") && !text.includes("|") && !/^(?:NONE|N\/A|TBD|UNKNOWN|-)$/i.test(text));
}

export function classifyVercelStatus(statuses = []) {
  const status = [...statuses]
    .filter((item) => String(item?.context ?? "").trim().toLowerCase() === "vercel")
    .sort((left, right) => String(right.updated_at ?? right.created_at ?? "").localeCompare(String(left.updated_at ?? left.created_at ?? "")))[0];
  if (!status) return { state: "NOT_REPORTED", ready: false, targetUrl: null, description: null };

  const state = String(status.state ?? "").trim().toLowerCase();
  const description = String(status.description ?? "").trim();
  const base = { targetUrl: status.target_url ?? null, description };
  if (state === "pending") return { ...base, state: "PENDING", ready: false };
  if (["failure", "error"].includes(state)) return { ...base, state: "FAILED", ready: false };
  if (state === "success" && /ignored build step|canceled by ignored/i.test(description)) {
    return { ...base, state: "CANCELED_IGNORED", ready: false };
  }
  if (state === "success") return { ...base, state: "READY", ready: true };
  return { ...base, state: "UNKNOWN", ready: false };
}

function classifySourceVerification(workflowRuns = [], exactHead = "") {
  const run = [...workflowRuns]
    .filter((item) => item?.name === "ci" && item?.head_sha === exactHead)
    .sort((left, right) => Number(right.id ?? 0) - Number(left.id ?? 0))[0];
  if (!run) return { state: "NOT_REPORTED", verified: false, runId: null, url: null };
  if (run.status !== "completed") return { state: "PENDING", verified: false, runId: run.id ?? null, url: run.html_url ?? null };
  return {
    state: run.conclusion === "success" ? "VERIFIED" : String(run.conclusion ?? "FAILED").toUpperCase(),
    verified: run.conclusion === "success",
    runId: run.id ?? null,
    url: run.html_url ?? null,
  };
}

function classifySchemaTruth(body, migrationTouched) {
  const declared = upper(readField(body, "PRODUCTION_SCHEMA_STATUS"));
  const evidence = readField(body, "PRODUCTION_SCHEMA_EVIDENCE");
  const errors = [];
  if (migrationTouched && declared === "NOT_REQUIRED") {
    errors.push("actual migration files changed but PRODUCTION_SCHEMA_STATUS is NOT_REQUIRED");
  }
  if (declared === "VERIFIED_APPLIED" && !usableEvidence(evidence)) {
    errors.push("PRODUCTION_SCHEMA_STATUS=VERIFIED_APPLIED requires PRODUCTION_SCHEMA_EVIDENCE");
  }
  if (declared === "VERIFIED_APPLIED" && usableEvidence(evidence)) return { state: "READY", ready: true, errors };
  if (!migrationTouched && declared === "NOT_REQUIRED") return { state: "NOT_REQUIRED", ready: true, errors };
  if (["OWNER_BLOCKED", "NOT_APPLIED"].includes(declared)) return { state: declared, ready: false, errors };
  return { state: "UNVERIFIED", ready: false, errors };
}

function classifyProductionAcceptance(body) {
  const declared = upper(readField(body, "AUTHENTICATED_PRODUCTION_ACCEPTANCE"));
  const evidence = readField(body, "AUTHENTICATED_PRODUCTION_EVIDENCE");
  const errors = [];
  if (declared === "VERIFIED" && !usableEvidence(evidence)) {
    errors.push("AUTHENTICATED_PRODUCTION_ACCEPTANCE=VERIFIED requires AUTHENTICATED_PRODUCTION_EVIDENCE");
  }
  if (declared === "VERIFIED" && usableEvidence(evidence)) return { state: "ACCEPTED", accepted: true, errors };
  if (["OWNER_BLOCKED", "FAILED", "NOT_RUN"].includes(declared)) return { state: declared, accepted: false, errors };
  return { state: "UNVERIFIED", accepted: false, errors };
}

/** @param {any} input */
export function evaluateProductDeliveryTruth(input = {}) {
  const {
    pullRequest,
    defaultBranchHead,
    compareStatus,
    changedFiles = [],
    sourceWorkflowRuns = [],
    commitStatuses = [],
  } = input;
  const pr = pullRequest ?? {};
  const body = String(pr.body ?? "");
  const merge = evaluateMergedPullRequest({ pullRequest: pr, defaultBranchHead, compareStatus });
  const source = classifySourceVerification(sourceWorkflowRuns, String(pr.head?.sha ?? ""));
  const vercel = classifyVercelStatus(commitStatuses);
  const issueNumber = readLifecycleIssue(body);
  const deliveryUnitType = upper(readField(body, "DELIVERY_UNIT_TYPE"));
  const deliveryEligible = Boolean(
    issueNumber && DELIVERY_UNIT_TYPES.has(deliveryUnitType) &&
    upper(readField(body, "COUNT_IN_DELIVERY_OUTCOME")) === "TRUE" &&
    upper(readField(body, "RETROACTIVE_TRACKING_MIGRATION")) !== "TRUE"
  );
  const migrationTouched = changedFiles.some((file) => [file?.filename ?? file, file?.previous_filename]
    .filter(Boolean)
    .some((name) => String(name).startsWith("supabase/migrations/")));
  const schema = deliveryEligible
    ? classifySchemaTruth(body, migrationTouched)
    : { state: "NOT_APPLICABLE", ready: true, errors: [] };
  const acceptance = deliveryEligible
    ? classifyProductionAcceptance(body)
    : { state: "NOT_APPLICABLE", accepted: true, errors: [] };
  const errors = [...merge.errors, ...schema.errors, ...acceptance.errors];
  if (deliveryEligible && !source.verified) errors.push(`exact-head source CI is not verified (${source.state})`);
  const warnings = [];
  if (deliveryEligible && vercel.ready && /Production\s+(?:DDL\s*\/\s*DML\s*\/\s*)?deploy\s*:\s*NOT_RUN/i.test(body)) {
    warnings.push("legacy `Production deploy: NOT_RUN` conflicts with live Vercel READY; distinguish automatic deploy from manual promote");
  }

  return {
    verified: merge.verified && errors.length === 0,
    productionAccepted: Boolean(
      deliveryEligible && source.verified && merge.verified && vercel.ready && schema.ready && acceptance.accepted && errors.length === 0
    ),
    errors: [...new Set(errors)],
    warnings,
    pullRequestNumber: Number(pr.number) || null,
    issueNumber,
    deliveryUnitType: deliveryUnitType || null,
    deliveryEligible,
    migrationTouched,
    manualPromote: upper(readField(body, "MANUAL_PRODUCTION_PROMOTE")) || "UNDECLARED",
    source,
    merge,
    vercel,
    schema,
    acceptance,
  };
}

export function formatProductDeliveryTruth(result, verifiedAt = new Date().toISOString()) {
  const status = !result.deliveryEligible
    ? "NON_PRODUCT_GOVERNANCE"
    : result.productionAccepted ? "AUTHENTICATED_PRODUCTION_ACCEPTED"
      : result.merge.verified ? "PRODUCTION_PENDING" : "MERGE_UNVERIFIED";
  const list = (items) => items.length ? items.map((item) => `- ${item}`).join("\n") : "- none";
  return [
    "<!-- agent-completion-truth -->",
    "## Product Delivery Truth Ladder",
    "",
    `- STATUS: ${status}`,
    `- PR: ${result.pullRequestNumber ? `#${result.pullRequestNumber}` : "unknown"}`,
    `- ISSUE: ${result.issueNumber ? `#${result.issueNumber}` : "none"}`,
    `- DELIVERY_UNIT_TYPE: ${result.deliveryUnitType ?? "none"}`,
    `- SOURCE_VERIFIED: ${result.source.state}`,
    `- MERGED_TO_MAIN: ${result.merge.verified ? "VERIFIED" : "UNVERIFIED"}`,
    `- AUTO_VERCEL_DEPLOYED: ${result.vercel.state}`,
    `- PRODUCTION_SCHEMA_READY: ${result.schema.state}`,
    `- AUTHENTICATED_PRODUCTION_ACCEPTED: ${result.acceptance.state}`,
    `- MANUAL_PRODUCTION_PROMOTE: ${result.manualPromote}`,
    `- ACTUAL_MIGRATION_TOUCH: ${result.migrationTouched}`,
    `- VERIFIED_AT: ${verifiedAt}`,
    "",
    "### Errors", "", list(result.errors), "",
    "### Warnings", "", list(result.warnings), "",
    result.productionAccepted
      ? "This Delivery Slice is verified through authenticated Production acceptance."
      : result.deliveryEligible
        ? "Do not report this Product change as Production-accepted until every remaining stage is verified."
        : "This PR is not an eligible Product Delivery Slice; no shipped unit is created.",
  ].join("\n");
}
