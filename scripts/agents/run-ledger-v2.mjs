#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { createRunLedger as createLegacyLedger, validateRunLedger as validateLegacyLedger } from "./run-ledger.mjs";

const TRUTH_STATUS = new Set(["NOT_CHECKED", "VERIFIED", "FAILED"]);
const CLAIM_TYPE = new Set([
  "ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE", "PR_MERGED", "CI_GREEN",
  "LOCAL_TEST_GREEN", "RUN_COMPLETE", "SOURCE_VERIFIED", "MERGED_TO_MAIN",
  "AUTO_VERCEL_DEPLOYED", "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED", "OTHER",
]);
const VERIFICATION = new Set(["VERIFIED", "UNVERIFIED", "CONTRADICTED"]);
const FINAL_RUN_STATUS = new Set(["BASELINE", "COMPLETE", "OWNER_BLOCKED"]);
const CLOSEOUT_OWNER_ROLE = new Set(["PRODUCT_MAIN_SESSION", "GOVERNANCE_MAIN_SESSION", "OWNER"]);
const CLOSEOUT_STATE = new Set(["OPEN", "CLOSED"]);
const SHA40 = /^[0-9a-f]{40}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DURABLE_EVIDENCE_REF = /^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i;
const WIP_EVENT_KIND = new Set([
  "BUILD_ENTER", "BUILD_EXIT", "VERIFY_ENTER", "VERIFY_EXIT",
  "TEST_ENTER", "TEST_EXIT", "REFILL_ADMITTED", "REFILL_REJECTED",
]);

export const RUN_CLOSEOUT_TERMINAL_POLICY =
  "CLOSE_OR_REASSIGN_BEFORE_SESSION_EXIT_OR_OWNER_STOP_OR_SCOPE_EXHAUSTED_OR_OWNER_BLOCKED";

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(value, keys) {
  if (!isObject(value)) return false;
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.join("\n") === expected.join("\n");
}

function isValidUtcTimestamp(value) {
  const text = String(value ?? "").trim();
  return ISO_UTC.test(text) && !Number.isNaN(Date.parse(text));
}

function isUsableEvidenceRef(value) {
  const text = String(value ?? "").trim();
  return DURABLE_EVIDENCE_REF.test(text) && !text.includes("://");
}

function normalizeCloseoutOwner(value) {
  const ownerRole = upper(value);
  if (!CLOSEOUT_OWNER_ROLE.has(ownerRole)) {
    throw new Error(
      "--closeout-owner must be PRODUCT_MAIN_SESSION, GOVERNANCE_MAIN_SESSION, or OWNER",
    );
  }
  return ownerRole;
}

/**
 * Build the historical Delivery Truth v3 shape for tests and byte-compatible
 * reproduction only. New operational Runs must use createRunLedgerV2.
 *
 * @param {string} runId
 * @param {string} [startedAt]
 */
export function createHistoricalRunLedgerV3(
  runId,
  startedAt = new Date().toISOString(),
) {
  return {
    ...createLegacyLedger(runId, startedAt),
    schemaVersion: 2,
    deliveryTruthVersion: 3,
    completionTruth: { status: "NOT_CHECKED", checkedAt: null, claims: [] },
  };
}

/**
 * Create a new operational Delivery Truth v4 ledger.
 *
 * @param {string} runId
 * @param {string} [startedAt]
 * @param {{ closeoutOwner?: string | null }} [options]
 */
export function createRunLedgerV2(
  runId,
  startedAt = new Date().toISOString(),
  { closeoutOwner = null } = {},
) {
  const run = createLegacyLedger(runId, startedAt);
  return {
    ...run,
    schemaVersion: 2,
    deliveryTruthVersion: 4,
    closeout: {
      contractVersion: 1,
      ownerRole: normalizeCloseoutOwner(closeoutOwner),
      terminalPolicy: RUN_CLOSEOUT_TERMINAL_POLICY,
      state: "OPEN",
      closedAt: null,
      evidenceRef: null,
    },
    // This starts empty deliberately: an empty append-only observation stream is
    // evidence of no recorded WIP transitions, not an invented historical peak.
    wipLifecycle: { schemaVersion: 1, events: [] },
    completionTruth: { status: "NOT_CHECKED", checkedAt: null, claims: [] },
  };
}

function validateWipLifecycle(run) {
  if (run.wipLifecycle === undefined) return [];
  const lifecycle = run.wipLifecycle;
  if (!hasExactKeys(lifecycle, ["schemaVersion", "events"])) {
    return ["wipLifecycle requires exactly schemaVersion and events"];
  }
  const errors = [];
  if (lifecycle.schemaVersion !== 1) errors.push("wipLifecycle.schemaVersion must be 1");
  if (!Array.isArray(lifecycle.events)) return [...errors, "wipLifecycle.events must be an array"];
  const ids = new Set();
  let previousAt = -Infinity;
  const states = new Map();
  lifecycle.events.forEach((event, index) => {
    const key = `wipLifecycle.events[${index}]`;
    if (!hasExactKeys(event, ["id", "at", "kind", "pr", "issue", "head", "workstream", "reason"])) {
      errors.push(`${key} must contain exactly id, at, kind, pr, issue, head, workstream, reason`); return;
    }
    if (typeof event.id !== "string" || !event.id.trim() || ids.has(event.id)) errors.push(`${key}.id must be unique and non-empty`);
    ids.add(event.id);
    if (!isValidUtcTimestamp(event.at) || Date.parse(event.at) < previousAt) errors.push(`${key}.at must be non-decreasing ISO UTC`);
    previousAt = Math.max(previousAt, Date.parse(event.at));
    if (!WIP_EVENT_KIND.has(event.kind)) errors.push(`${key}.kind is invalid`);
    if (!Number.isSafeInteger(event.pr) || event.pr <= 0) errors.push(`${key}.pr must be a positive safe integer`);
    if (!Number.isSafeInteger(event.issue) || event.issue <= 0) errors.push(`${key}.issue must be a positive safe integer`);
    if (!SHA40.test(event.head ?? "")) errors.push(`${key}.head must be a 40-character SHA`);
    if (event.workstream !== "PRODUCT_MAINLINE") errors.push(`${key}.workstream must be PRODUCT_MAINLINE`);
    if (typeof event.reason !== "string" || !event.reason.trim()) errors.push(`${key}.reason is required`);
    const current = states.get(event.pr);
    const enters = { BUILD_ENTER: "BUILD", VERIFY_ENTER: "VERIFY", TEST_ENTER: "TEST" };
    const exits = { BUILD_EXIT: "BUILD", VERIFY_EXIT: "VERIFY", TEST_EXIT: "TEST" };
    if (enters[event.kind]) {
      if (current) errors.push(`${key} cannot enter ${enters[event.kind]} while PR #${event.pr} is ${current.state}`);
      else states.set(event.pr, { state: enters[event.kind], head: event.head });
    } else if (exits[event.kind]) {
      if (!current || current.state !== exits[event.kind] || current.head !== event.head) errors.push(`${key} must exit the same live state and head it entered`);
      else states.delete(event.pr);
    }
  });
  return [...new Set(errors)];
}

function validateCloseoutContract(run) {
  const errors = [];
  const closeout = run.closeout;
  const exactKeys = [
    "contractVersion", "ownerRole", "terminalPolicy", "state", "closedAt", "evidenceRef",
  ];
  if (!hasExactKeys(closeout, exactKeys)) {
    return [
      "deliveryTruthVersion=4 requires closeout with exactly contractVersion, ownerRole, terminalPolicy, state, closedAt, evidenceRef",
    ];
  }

  if (closeout.contractVersion !== 1) errors.push("closeout.contractVersion must be 1");
  if (!CLOSEOUT_OWNER_ROLE.has(closeout.ownerRole)) {
    errors.push("closeout.ownerRole must be PRODUCT_MAIN_SESSION, GOVERNANCE_MAIN_SESSION, or OWNER");
  }
  if (closeout.terminalPolicy !== RUN_CLOSEOUT_TERMINAL_POLICY) {
    errors.push(`closeout.terminalPolicy must be ${RUN_CLOSEOUT_TERMINAL_POLICY}`);
  }
  if (!CLOSEOUT_STATE.has(closeout.state)) errors.push("closeout.state must be OPEN or CLOSED");
  if (!(closeout.closedAt === null || typeof closeout.closedAt === "string")) {
    errors.push("closeout.closedAt must be string or null");
  }
  if (!(closeout.evidenceRef === null || typeof closeout.evidenceRef === "string")) {
    errors.push("closeout.evidenceRef must be string or null");
  }

  const final = FINAL_RUN_STATUS.has(run.status);
  if (!final) {
    if (closeout.state !== "OPEN") errors.push("non-final Run must keep closeout.state=OPEN");
    if (closeout.closedAt !== null) errors.push("non-final Run must keep closeout.closedAt=null");
    if (closeout.evidenceRef !== null) errors.push("non-final Run must keep closeout.evidenceRef=null");
    return errors;
  }

  if (closeout.state !== "CLOSED") errors.push("final Run requires closeout.state=CLOSED");
  if (!isValidUtcTimestamp(run.endedAt)) {
    errors.push("final v4 Run requires endedAt as an ISO UTC timestamp");
  }
  if (closeout.closedAt !== run.endedAt) errors.push("closeout.closedAt must equal endedAt");
  if (!SHA40.test(String(run.main?.endSha ?? "").trim().toLowerCase())) {
    errors.push("final v4 Run requires a 40-character main.endSha");
  }
  for (const field of ["openIssuesEnd", "openPrsEnd"]) {
    const value = run.inventory?.[field];
    if (!Number.isInteger(value) || value < 0) {
      errors.push(`final v4 Run requires inventory.${field} as a non-negative integer`);
    }
  }
  if (!isUsableEvidenceRef(closeout.evidenceRef)) {
    errors.push("final v4 Run requires a durable closeout.evidenceRef such as github:issue#193");
  }
  return errors;
}

/**
 * Build a terminal v4 candidate from facts observed by the caller.
 *
 * The helper is deliberately immutable and does not contact GitHub or write a
 * ledger. It makes the closeout step quick without allowing a session to turn
 * an open Run into a completed Run from a prose claim alone.
 */
export function closeRunLedgerV2(run, {
  status,
  endedAt,
  mainEndSha,
  openIssuesEnd,
  openPrsEnd,
  evidenceRef,
} = {}) {
  if (!run || typeof run !== 'object' || Array.isArray(run)) throw new Error('CLOSEOUT_INPUT_INVALID: run must be an object');
  if (run.deliveryTruthVersion !== 4) throw new Error('CLOSEOUT_REQUIRES_V4: only operational Delivery Truth v4 Runs may be closed by this helper');
  const inputErrors = validateRunLedgerV2(run);
  if (inputErrors.length) throw new Error(`CLOSEOUT_INPUT_INVALID:\n${inputErrors.map((item) => `- ${item}`).join('\n')}`);
  if (run.closeout.state === 'CLOSED') throw new Error('CLOSEOUT_ALREADY_CLOSED: refusing to rewrite a closed Run');
  if (!FINAL_RUN_STATUS.has(status)) throw new Error('CLOSEOUT_STATUS_INVALID: status must be BASELINE, COMPLETE, or OWNER_BLOCKED');

  const candidate = structuredClone(run);
  candidate.status = status;
  candidate.endedAt = endedAt;
  candidate.main.endSha = String(mainEndSha ?? '').trim().toLowerCase();
  candidate.inventory.openIssuesEnd = openIssuesEnd;
  candidate.inventory.openPrsEnd = openPrsEnd;
  candidate.closeout.state = 'CLOSED';
  candidate.closeout.closedAt = endedAt;
  candidate.closeout.evidenceRef = evidenceRef;

  const errors = validateRunLedgerV2(candidate);
  if (errors.length) throw new Error(`CLOSEOUT_CANDIDATE_INVALID:\n${errors.map((item) => `- ${item}`).join('\n')}`);
  return candidate;
}

export function validateRunLedgerV2(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return ["run must be an object"];
  const errors = [];
  if (run.schemaVersion !== 2) errors.push("schemaVersion must be 2");
  if (run.deliveryTruthVersion !== undefined && ![2, 3, 4].includes(run.deliveryTruthVersion)) {
    errors.push("deliveryTruthVersion must be 2, 3, or 4 when provided");
  }

  const legacy = { ...run, schemaVersion: 1 };
  delete legacy.deliveryTruthVersion;
  delete legacy.closeout;
  delete legacy.completionTruth;
  errors.push(...validateLegacyLedger(legacy));

  if (run.deliveryTruthVersion === 4) errors.push(...validateCloseoutContract(run));
  errors.push(...validateWipLifecycle(run));

  const truth = run.completionTruth;
  if (!truth || typeof truth !== "object" || Array.isArray(truth)) return [...errors, "completionTruth must be an object"];
  if (!TRUTH_STATUS.has(truth.status)) errors.push("completionTruth.status is invalid");
  if (!(truth.checkedAt === null || typeof truth.checkedAt === "string")) errors.push("completionTruth.checkedAt must be string or null");
  if (["VERIFIED", "FAILED"].includes(truth.status) && !truth.checkedAt) errors.push("completionTruth.checkedAt is required after checking");
  if (!Array.isArray(truth.claims)) return [...errors, "completionTruth.claims must be an array"];

  truth.claims.forEach((claim, index) => {
    const key = `completionTruth.claims[${index}]`;
    if (!claim || typeof claim !== "object" || Array.isArray(claim)) {
      errors.push(`${key} must be an object`);
      return;
    }
    if (!CLAIM_TYPE.has(claim.type)) errors.push(`${key}.type is invalid`);
    for (const field of ["subject", "claimedState", "observedState", "evidenceRef"]) {
      if (typeof claim[field] !== "string") errors.push(`${key}.${field} must be a string`);
    }
    if (!VERIFICATION.has(claim.verification)) errors.push(`${key}.verification is invalid`);
    if (claim.verification === "VERIFIED" && !String(claim.evidenceRef ?? "").trim()) {
      errors.push(`${key}.evidenceRef is required for VERIFIED claims`);
    }
  });
  return [...new Set(errors)];
}

function args(argv) {
  const [command, ...rest] = argv;
  const parsed = { command, positional: [] };
  for (let i = 0; i < rest.length; i += 1) {
    if (rest[i].startsWith("--")) {
      const key = rest[i].slice(2);
      parsed[key] = rest[i + 1] && !rest[i + 1].startsWith("--") ? rest[++i] : true;
    } else parsed.positional.push(rest[i]);
  }
  return parsed;
}

export function runCli(argv = process.argv.slice(2)) {
  const input = args(argv);
  if (input.command === "init") {
    if (!input["run-id"]) throw new Error("--run-id is required");
    if (!input["closeout-owner"]) throw new Error("--closeout-owner is required for new Runs");
    const output = input.output ?? `docs/metrics/agent-runs/${input["run-id"]}.json`;
    if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing ledger: ${output}`);
    const startedAt = input["started-at"] ?? new Date().toISOString();
    const ledger = createRunLedgerV2(input["run-id"], startedAt, {
      closeoutOwner: input["closeout-owner"],
    });
    const validation = validateRunLedgerV2(ledger);
    if (validation.length) throw new Error(validation.map((item) => `- ${item}`).join("\n"));
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`, "utf8");
    console.log(output);
    return ledger;
  }
  if (input.command === "validate") {
    const file = input.positional[0];
    if (!file) throw new Error("ledger path is required");
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    const errors = validateRunLedgerV2(run);
    if (errors.length) throw new Error(errors.map((item) => `- ${item}`).join("\n"));
    console.log(`VALID_V2 ${run.runId}`);
    return run;
  }
  if (input.command === "closeout") {
    const file = input.positional[0];
    if (!file) throw new Error("ledger path is required");
    if (typeof input.output !== "string" || !input.output.trim()) throw new Error("--output is required for closeout candidates");
    if (path.resolve(file) === path.resolve(input.output)) throw new Error("refusing to overwrite the open ledger; choose a different --output");
    for (const key of ["status", "ended-at", "main-end-sha", "open-issues-end", "open-prs-end", "evidence-ref"]) {
      if (input[key] === undefined || input[key] === true) throw new Error(`--${key} is required`);
    }
    const parseCount = (value, key) => {
      if (!/^\d+$/.test(String(value))) throw new Error(`--${key} must be a non-negative integer`);
      const count = Number(value);
      if (!Number.isSafeInteger(count)) throw new Error(`--${key} must be a safe non-negative integer`);
      return count;
    };
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    const candidate = closeRunLedgerV2(run, {
      status: String(input.status).trim().toUpperCase(),
      endedAt: input["ended-at"],
      mainEndSha: input["main-end-sha"],
      openIssuesEnd: parseCount(input["open-issues-end"], "open-issues-end"),
      openPrsEnd: parseCount(input["open-prs-end"], "open-prs-end"),
      evidenceRef: input["evidence-ref"],
    });
    if (fs.existsSync(input.output)) throw new Error(`refusing to overwrite existing closeout candidate: ${input.output}`);
    fs.mkdirSync(path.dirname(path.resolve(input.output)), { recursive: true });
    fs.writeFileSync(input.output, `${JSON.stringify(candidate, null, 2)}\n`, "utf8");
    console.log(input.output);
    return candidate;
  }
  throw new Error(
    "Usage: run-ledger-v2.mjs init --run-id YYYY-MM-DD-name --closeout-owner PRODUCT_MAIN_SESSION|GOVERNANCE_MAIN_SESSION|OWNER | validate <file> | closeout <file> --status BASELINE|COMPLETE|OWNER_BLOCKED --ended-at <ISO UTC> --main-end-sha <sha> --open-issues-end <n> --open-prs-end <n> --evidence-ref <ref> --output <new-file>",
  );
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
