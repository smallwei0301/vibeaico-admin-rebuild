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
    completionTruth: { status: "NOT_CHECKED", checkedAt: null, claims: [] },
  };
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
  throw new Error(
    "Usage: run-ledger-v2.mjs init --run-id YYYY-MM-DD-name --closeout-owner PRODUCT_MAIN_SESSION|GOVERNANCE_MAIN_SESSION|OWNER | validate <file>",
  );
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
