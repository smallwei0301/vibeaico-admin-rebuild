#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const REQUIRED_TOP_LEVEL = [
  "schemaVersion", "runId", "status", "startedAt", "sources", "main", "inventory",
  "modelUsage", "delivery", "ci", "quality", "flow", "auditability", "notes",
];
const STATUS = new Set(["BASELINE", "IN_PROGRESS", "COMPLETE", "OWNER_BLOCKED", "CLOSURE_RECOVERY"]);
const MODEL = new Set(["luna", "terra", "sol", "unknown"]);
const CONTEXT = new Set(["compact", "medium", "full", "unknown"]);

function isNumberOrNull(value) {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function requireObject(value, name, errors) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    errors.push(`${name} must be an object`);
    return false;
  }
  return true;
}

function checkNumbers(object, keys, name, errors, { percent = false } = {}) {
  for (const key of keys) {
    const value = object[key];
    if (!isNumberOrNull(value)) {
      errors.push(`${name}.${key} must be a number or null`);
      continue;
    }
    if (typeof value === "number" && value < 0) errors.push(`${name}.${key} must be >= 0`);
    if (percent && typeof value === "number" && value > 100) errors.push(`${name}.${key} must be <= 100`);
  }
}

export function createRunLedger(runId, startedAt = new Date().toISOString()) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error("runId must look like YYYY-MM-DD-name");
  }
  return {
    schemaVersion: 1,
    runId,
    status: "IN_PROGRESS",
    startedAt,
    endedAt: null,
    sources: [],
    main: { startSha: null, endSha: null },
    inventory: {
      openIssuesStart: null, openIssuesEnd: null, openPrsStart: null, openPrsEnd: null,
      mainTerraPeak: 0, reserveTerraPeak: 0, activeCandidatePeak: 0, sharedTestPeak: 0,
      closureSweeps: 0, closureAdvancedOrClosed: 0,
    },
    modelUsage: {
      actualTokensAvailable: false,
      weeklyUsageStartPercent: null,
      weeklyUsageEndPercent: null,
      weightedUsageImprovementPercent: null,
      weights: { luna: 1, terra: 3, sol: 6 },
      contextMultipliers: { compact: 1, medium: 1.5, full: 3 },
      tasks: [],
      fullContextReplays: 0,
      duplicateScans: 0,
    },
    delivery: {
      issuesStarted: 0, issuesClosed: 0, auditReady: 0, ownerBlockedComplete: 0,
      exactHeadCiOnly: 0, commitOnly: 0, unfinishedCarryover: 0, cycleTimeMinutes: null,
    },
    ci: { fullCiRuns: 0, invalidReruns: 0, firstPassRatePercent: null, sharedTestCollisions: 0 },
    quality: {
      acceptanceEvidenceCoveragePercent: null, auditFirstPassRatePercent: null,
      unresolvedP0: 0, unresolvedP1: 0, reopenedIssues: 0, postMergeRegressions: 0,
      safetyViolations: 0, hardFailReasons: [],
    },
    flow: {
      lunaTasks: 0, lunaAccepted: 0, lunaDelegationRatePercent: null,
      duplicateAgentTasks: 0, ownershipCollisions: 0, waitTimeConvertedPercent: null,
      solTouches: 0, solIssues: 0,
    },
    auditability: {
      evidenceFieldsCompletePercent: null, exactHeadTestCoveragePercent: null,
      stalePendingDescriptions: 0, preciseBlockersPercent: null, scoreInputsCompletePercent: null,
    },
    notes: [],
  };
}

export function validateRunLedger(run) {
  const errors = [];
  if (!requireObject(run, "run", errors)) return errors;
  for (const key of REQUIRED_TOP_LEVEL) if (!(key in run)) errors.push(`missing top-level field: ${key}`);
  if (run.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof run.runId !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(run.runId)) errors.push("runId must look like YYYY-MM-DD-name");
  if (!STATUS.has(run.status)) errors.push("status is invalid");
  if (typeof run.startedAt !== "string" || !run.startedAt.trim()) errors.push("startedAt is required");
  if (!(run.endedAt === null || typeof run.endedAt === "string")) errors.push("endedAt must be string or null");
  if (!Array.isArray(run.sources)) errors.push("sources must be an array");
  if (!Array.isArray(run.notes)) errors.push("notes must be an array");

  if (requireObject(run.main, "main", errors)) {
    for (const key of ["startSha", "endSha"]) {
      if (!(run.main[key] === null || typeof run.main[key] === "string")) errors.push(`main.${key} must be string or null`);
    }
  }
  if (requireObject(run.inventory, "inventory", errors)) {
    checkNumbers(run.inventory, ["openIssuesStart", "openIssuesEnd", "openPrsStart", "openPrsEnd", "mainTerraPeak", "reserveTerraPeak", "activeCandidatePeak", "sharedTestPeak", "closureSweeps", "closureAdvancedOrClosed"], "inventory", errors);
  }
  if (requireObject(run.modelUsage, "modelUsage", errors)) {
    if (typeof run.modelUsage.actualTokensAvailable !== "boolean") errors.push("modelUsage.actualTokensAvailable must be boolean");
    checkNumbers(run.modelUsage, ["weeklyUsageStartPercent", "weeklyUsageEndPercent"], "modelUsage", errors, { percent: true });
    if (!isNumberOrNull(run.modelUsage.weightedUsageImprovementPercent)) errors.push("modelUsage.weightedUsageImprovementPercent must be number or null");
    checkNumbers(run.modelUsage, ["fullContextReplays", "duplicateScans"], "modelUsage", errors);
    if (!Array.isArray(run.modelUsage.tasks)) errors.push("modelUsage.tasks must be an array");
    else run.modelUsage.tasks.forEach((task, index) => {
      if (!requireObject(task, `modelUsage.tasks[${index}]`, errors)) return;
      if (!MODEL.has(task.requestedModel)) errors.push(`modelUsage.tasks[${index}].requestedModel is invalid`);
      if (!MODEL.has(task.actualModel)) errors.push(`modelUsage.tasks[${index}].actualModel is invalid`);
      if (!CONTEXT.has(task.contextClass)) errors.push(`modelUsage.tasks[${index}].contextClass is invalid`);
      if (typeof task.id !== "string" || !task.id) errors.push(`modelUsage.tasks[${index}].id is required`);
      if (typeof task.role !== "string" || !task.role) errors.push(`modelUsage.tasks[${index}].role is required`);
      if (typeof task.count !== "number" || task.count < 0) errors.push(`modelUsage.tasks[${index}].count must be >= 0`);
      if (typeof task.accepted !== "boolean") errors.push(`modelUsage.tasks[${index}].accepted must be boolean`);
      for (const key of ["inputTokens", "outputTokens", "cachedTokens"]) {
        if (!isNumberOrNull(task[key]) || (typeof task[key] === "number" && task[key] < 0)) errors.push(`modelUsage.tasks[${index}].${key} must be >= 0 or null`);
      }
    });
  }
  if (requireObject(run.delivery, "delivery", errors)) checkNumbers(run.delivery, ["issuesStarted", "issuesClosed", "auditReady", "ownerBlockedComplete", "exactHeadCiOnly", "commitOnly", "unfinishedCarryover", "cycleTimeMinutes"], "delivery", errors);
  if (requireObject(run.ci, "ci", errors)) {
    checkNumbers(run.ci, ["fullCiRuns", "invalidReruns", "sharedTestCollisions"], "ci", errors);
    checkNumbers(run.ci, ["firstPassRatePercent"], "ci", errors, { percent: true });
  }
  if (requireObject(run.quality, "quality", errors)) {
    checkNumbers(run.quality, ["acceptanceEvidenceCoveragePercent", "auditFirstPassRatePercent"], "quality", errors, { percent: true });
    checkNumbers(run.quality, ["unresolvedP0", "unresolvedP1", "reopenedIssues", "postMergeRegressions", "safetyViolations"], "quality", errors);
    if (!Array.isArray(run.quality.hardFailReasons)) errors.push("quality.hardFailReasons must be an array");
  }
  if (requireObject(run.flow, "flow", errors)) {
    checkNumbers(run.flow, ["lunaTasks", "lunaAccepted", "duplicateAgentTasks", "ownershipCollisions", "solTouches", "solIssues"], "flow", errors);
    checkNumbers(run.flow, ["lunaDelegationRatePercent", "waitTimeConvertedPercent"], "flow", errors, { percent: true });
    if (typeof run.flow.lunaAccepted === "number" && typeof run.flow.lunaTasks === "number" && run.flow.lunaAccepted > run.flow.lunaTasks) errors.push("flow.lunaAccepted cannot exceed flow.lunaTasks");
  }
  if (requireObject(run.auditability, "auditability", errors)) {
    checkNumbers(run.auditability, ["evidenceFieldsCompletePercent", "exactHeadTestCoveragePercent", "preciseBlockersPercent", "scoreInputsCompletePercent"], "auditability", errors, { percent: true });
    checkNumbers(run.auditability, ["stalePendingDescriptions"], "auditability", errors);
  }
  if (run.modelUsage?.actualTokensAvailable) {
    const missing = (run.modelUsage.tasks ?? []).filter((task) => task.inputTokens === null || task.outputTokens === null);
    if (missing.length) errors.push("actualTokensAvailable=true but one or more tasks have null input/output tokens");
  }
  return errors;
}

const DUAL_STATUS = new Set(["IN_PROGRESS", "COMPLETE", "OWNER_BLOCKED"]);
const DUAL_SOURCE_FIELDS = ["openIssueStart", "openIssueEnd", "openPrStart", "openPrEnd"];
const DUAL_DELIVERY_FIELDS = [
  "issuesStarted", "issuesClosed", "closeApproved", "completeOwnerBlocked",
  "auditReady", "exactHeadGreenOnly", "commitOnly", "unfinishedCarryover",
];
const DUAL_INVENTORY_NUMBER_FIELDS = [
  "terraTarget", "mainTerraPeak", "reserveTerraPeak", "activeCandidatePeak",
  "closurePeak", "testValidationPeak", "closureOutcomes", "slot1ActiveMinutes",
  "slot2ActiveMinutes", "localIsolatedJobs", "localIsolatedSuccess",
  "localIsolatedFailure", "localCleanupSuccess", "remoteCanonicalWaitMinutes",
  "crossLaneContamination",
];

function checkDualNumber(value, name, errors, { nullable = true } = {}) {
  if (value === null && nullable) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    errors.push(`${name} must be a non-negative number${nullable ? " or null" : ""}`);
  }
}

function checkDualBoolean(value, name, errors) {
  if (typeof value !== "boolean") errors.push(`${name} must be boolean`);
}

function checkDualString(value, name, errors, { nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !value.trim()) errors.push(`${name} must be a non-empty string${nullable ? " or null" : ""}`);
}

export function buildInitialRun(runId, startedAt = new Date().toISOString()) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(runId)) {
    throw new Error("runId must look like YYYY-MM-DD-name");
  }
  return {
    schemaVersion: 1,
    runId,
    status: "IN_PROGRESS",
    startedAt,
    endedAt: null,
    sources: { openIssueStart: null, openIssueEnd: null, openPrStart: null, openPrEnd: null },
    main: { startSha: null, endSha: null },
    baselines: { weightedUsagePerDeliveryUnit: null, deliveryUnits: null },
    usage: {
      actualTokensAvailable: false,
      inputTokens: null,
      outputTokens: null,
      cachedTokens: null,
      weeklyUsagePercentStart: null,
      weeklyUsagePercentEnd: null,
      source: "INTERNAL_WEIGHTED_PROXY",
    },
    modelTasks: [],
    delivery: {
      issuesStarted: 0,
      issuesClosed: 0,
      closeApproved: 0,
      completeOwnerBlocked: 0,
      auditReady: 0,
      exactHeadGreenOnly: 0,
      commitOnly: 0,
      unfinishedCarryover: 0,
    },
    inventory: {
      dualTerraPilot: false,
      terraTarget: 0,
      mainTerraPeak: 0,
      reserveTerraPeak: 0,
      activeCandidatePeak: 0,
      closurePeak: 0,
      testValidationPeak: 0,
      closureSweepExecuted: false,
      closureOutcomes: 0,
      slot1ActiveMinutes: null,
      slot2ActiveMinutes: null,
      localIsolatedJobs: null,
      localIsolatedSuccess: null,
      localIsolatedFailure: null,
      localCleanupSuccess: null,
      remoteCanonicalWaitMinutes: null,
      crossLaneContamination: null,
      fallbackToSingleTerra: false,
    },
    ci: { fullRuns: 0, firstPassSuccesses: 0, invalidReruns: 0 },
    quality: {
      acceptanceRequirementCount: 0,
      acceptanceEvidenceCount: 0,
      auditAttempts: 0,
      firstPassAuditApprovals: 0,
      unresolvedP0: 0,
      unresolvedP1: 0,
      reopenedIssues: 0,
      postMergeRegressions: 0,
      safetyViolations: 0,
      hardFailReasons: [],
    },
    flow: {
      lunaTasks: 0,
      lunaAccepted: 0,
      duplicateTasks: 0,
      ownershipCollisions: 0,
      waitingOpportunities: 0,
      waitingConvertedToUsefulWork: 0,
    },
    evidence: {
      issueCount: 0,
      issueWithEvidenceCount: 0,
      prCount: 0,
      prWithEvidenceCount: 0,
      exactHeadCount: 0,
      exactHeadWithEvidenceCount: 0,
      testRunIdsComplete: false,
      prBodiesCurrent: false,
      ownerBlockersPrecise: false,
      reportReproducible: false,
      usageSourceDeclared: true,
    },
    notes: [],
  };
}

export function validateRun(run) {
  const errors = [];
  if (!requireObject(run, "run", errors)) return { valid: false, errors };
  for (const key of [
    "schemaVersion", "runId", "status", "startedAt", "endedAt", "sources", "main",
    "baselines", "usage", "modelTasks", "delivery", "inventory", "ci", "quality",
    "flow", "evidence", "notes",
  ]) {
    if (!(key in run)) errors.push(`missing top-level field: ${key}`);
  }
  if (run.schemaVersion !== 1) errors.push("schemaVersion must be 1");
  if (typeof run.runId !== "string" || !/^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/.test(run.runId)) errors.push("runId must look like YYYY-MM-DD-name");
  if (!DUAL_STATUS.has(run.status)) errors.push("status is invalid");
  checkDualString(run.startedAt, "startedAt", errors);
  checkDualString(run.endedAt, "endedAt", errors, { nullable: true });

  if (requireObject(run.sources, "sources", errors)) {
    for (const field of DUAL_SOURCE_FIELDS) checkDualNumber(run.sources[field], `sources.${field}`, errors);
  }
  if (requireObject(run.main, "main", errors)) {
    checkDualString(run.main.startSha, "main.startSha", errors, { nullable: true });
    checkDualString(run.main.endSha, "main.endSha", errors, { nullable: true });
  }
  if (requireObject(run.baselines, "baselines", errors)) {
    checkDualNumber(run.baselines.weightedUsagePerDeliveryUnit, "baselines.weightedUsagePerDeliveryUnit", errors);
    checkDualNumber(run.baselines.deliveryUnits, "baselines.deliveryUnits", errors);
  }
  if (requireObject(run.usage, "usage", errors)) {
    checkDualBoolean(run.usage.actualTokensAvailable, "usage.actualTokensAvailable", errors);
    for (const field of ["inputTokens", "outputTokens", "cachedTokens", "weeklyUsagePercentStart", "weeklyUsagePercentEnd"]) {
      checkDualNumber(run.usage[field], `usage.${field}`, errors);
    }
    checkDualString(run.usage.source, "usage.source", errors);
  }
  if (!Array.isArray(run.modelTasks)) errors.push("modelTasks must be an array");
  else run.modelTasks.forEach((task, index) => {
    if (!requireObject(task, `modelTasks[${index}]`, errors)) return;
    checkDualString(task.taskId, `modelTasks[${index}].taskId`, errors);
    checkDualString(task.role, `modelTasks[${index}].role`, errors);
    checkDualString(task.requestedModel, `modelTasks[${index}].requestedModel`, errors);
    checkDualString(task.actualModel, `modelTasks[${index}].actualModel`, errors);
    checkDualString(task.contextSize, `modelTasks[${index}].contextSize`, errors);
    checkDualBoolean(task.lunaEligible, `modelTasks[${index}].lunaEligible`, errors);
    checkDualBoolean(task.accepted, `modelTasks[${index}].accepted`, errors);
    checkDualNumber(task.issue, `modelTasks[${index}].issue`, errors);
    checkDualNumber(task.pr, `modelTasks[${index}].pr`, errors);
    checkDualString(task.exactHead, `modelTasks[${index}].exactHead`, errors);
    checkDualString(task.result, `modelTasks[${index}].result`, errors);
  });
  if (requireObject(run.delivery, "delivery", errors)) {
    for (const field of DUAL_DELIVERY_FIELDS) checkDualNumber(run.delivery[field], `delivery.${field}`, errors, { nullable: false });
  }
  if (requireObject(run.inventory, "inventory", errors)) {
    checkDualBoolean(run.inventory.dualTerraPilot, "inventory.dualTerraPilot", errors);
    for (const field of DUAL_INVENTORY_NUMBER_FIELDS) checkDualNumber(run.inventory[field], `inventory.${field}`, errors);
    checkDualBoolean(run.inventory.closureSweepExecuted, "inventory.closureSweepExecuted", errors);
    checkDualBoolean(run.inventory.fallbackToSingleTerra, "inventory.fallbackToSingleTerra", errors);
  }
  if (requireObject(run.ci, "ci", errors)) {
    for (const field of ["fullRuns", "firstPassSuccesses", "invalidReruns"]) checkDualNumber(run.ci[field], `ci.${field}`, errors, { nullable: false });
  }
  if (requireObject(run.quality, "quality", errors)) {
    for (const field of [
      "acceptanceRequirementCount", "acceptanceEvidenceCount", "auditAttempts", "firstPassAuditApprovals",
      "unresolvedP0", "unresolvedP1", "reopenedIssues", "postMergeRegressions", "safetyViolations",
    ]) checkDualNumber(run.quality[field], `quality.${field}`, errors, { nullable: false });
    if (!Array.isArray(run.quality.hardFailReasons)) errors.push("quality.hardFailReasons must be an array");
  }
  if (requireObject(run.flow, "flow", errors)) {
    for (const field of ["lunaTasks", "lunaAccepted", "duplicateTasks", "ownershipCollisions", "waitingOpportunities", "waitingConvertedToUsefulWork"]) {
      checkDualNumber(run.flow[field], `flow.${field}`, errors, { nullable: false });
    }
  }
  if (requireObject(run.evidence, "evidence", errors)) {
    for (const field of ["issueCount", "issueWithEvidenceCount", "prCount", "prWithEvidenceCount", "exactHeadCount", "exactHeadWithEvidenceCount"]) {
      checkDualNumber(run.evidence[field], `evidence.${field}`, errors, { nullable: false });
    }
    for (const field of ["testRunIdsComplete", "prBodiesCurrent", "ownerBlockersPrecise", "reportReproducible", "usageSourceDeclared"]) {
      checkDualBoolean(run.evidence[field], `evidence.${field}`, errors);
    }
  }
  if (!Array.isArray(run.notes)) errors.push("notes must be an array");
  return { valid: errors.length === 0, errors };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const args = { command, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      const next = rest[index + 1];
      if (next && !next.startsWith("--")) { args[key] = next; index += 1; }
      else args[key] = true;
    } else args.positional.push(value);
  }
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command === "init") {
    const runId = args["run-id"];
    if (!runId) throw new Error("--run-id is required");
    const output = args.output ?? `docs/metrics/agent-runs/${runId}.json`;
    const ledger = createRunLedger(runId);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing ledger: ${output}`);
    fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    console.log(output);
    return;
  }
  if (args.command === "validate") {
    const file = args.positional[0];
    if (!file) throw new Error("ledger path is required");
    const ledger = JSON.parse(fs.readFileSync(file, "utf8"));
    const errors = validateRunLedger(ledger);
    if (errors.length) { for (const error of errors) console.error(`- ${error}`); process.exitCode = 1; return; }
    console.log(`VALID ${ledger.runId}`);
    return;
  }
  console.error("Usage:\n  run-ledger.mjs init --run-id YYYY-MM-DD-name [--output path]\n  run-ledger.mjs validate <ledger.json>");
  process.exitCode = 1;
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntry) {
  try { runCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
