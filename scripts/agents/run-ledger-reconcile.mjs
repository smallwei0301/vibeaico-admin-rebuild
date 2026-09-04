#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const TRUTH_STATUS = new Set(["NOT_CHECKED", "VERIFIED", "FAILED"]);
const VERIFICATION = new Set(["VERIFIED", "UNVERIFIED", "CONTRADICTED"]);
const ALL_CLAIM_TYPES = new Set([
  "ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE", "PR_MERGED", "CI_GREEN",
  "LOCAL_TEST_GREEN", "RUN_COMPLETE", "SOURCE_VERIFIED", "MERGED_TO_MAIN",
  "AUTO_VERCEL_DEPLOYED", "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED", "OTHER",
]);
const RECONCILABLE_CLAIM_TYPES = new Set([
  "ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE", "RUN_COMPLETE", "SOURCE_VERIFIED",
  "MERGED_TO_MAIN", "AUTO_VERCEL_DEPLOYED", "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED", "OTHER",
]);
const ISSUE_CLAIM_TYPES = new Set([
  "ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE", "SOURCE_VERIFIED", "MERGED_TO_MAIN",
  "AUTO_VERCEL_DEPLOYED", "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED",
]);
const CLAIM_FIELDS = [
  "type", "subject", "claimedState", "observedState", "verification", "evidenceRef",
];

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function stableStringify(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function gitBlobSha(content) {
  const bytes = Buffer.from(content, "utf8");
  return crypto.createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
}

function normalizeClaim(value, { newClaim = false, runId = "" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_CLAIM", "claim must be an object");
  }
  const extra = Object.keys(value).filter((key) => !CLAIM_FIELDS.includes(key));
  if (extra.length) fail("INVALID_CLAIM", `unsupported claim field(s): ${extra.join(", ")}`);

  const claim = Object.fromEntries(CLAIM_FIELDS.map((field) => [field, String(value[field] ?? "").trim()]));
  if (!ALL_CLAIM_TYPES.has(claim.type)) fail("INVALID_CLAIM", `unsupported type ${claim.type || "<empty>"}`);
  if (newClaim && !RECONCILABLE_CLAIM_TYPES.has(claim.type)) {
    fail("UNSAFE_CLAIM_TYPE", `${claim.type} cannot be added by Product Delivery Truth reconciliation`);
  }
  for (const field of CLAIM_FIELDS.slice(1)) {
    if (!claim[field]) fail("INVALID_CLAIM", `${field} is required`);
  }
  if (!VERIFICATION.has(claim.verification)) fail("INVALID_CLAIM", `invalid verification ${claim.verification}`);
  if (newClaim && claim.verification === "VERIFIED" && claim.claimedState !== claim.observedState) {
    fail("CONTRADICTED_NEW_CLAIM", "a new VERIFIED claim must match live observed state");
  }
  if (newClaim && ISSUE_CLAIM_TYPES.has(claim.type) && !/^issue#[1-9][0-9]*$/.test(claim.subject)) {
    fail("NON_CANONICAL_SUBJECT", `${claim.type} subject must be exactly issue#<number>`);
  }
  if (newClaim && claim.type === "RUN_COMPLETE" && claim.subject !== runId) {
    fail("NON_CANONICAL_SUBJECT", `RUN_COMPLETE subject must equal ${runId}`);
  }
  return claim;
}

function claimDigest(claim) {
  return sha256(stableStringify(claim));
}

export function normalizeEvidence(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    fail("INVALID_EVIDENCE", "evidence must be an object");
  }
  if (value.schemaVersion !== 1) fail("INVALID_EVIDENCE", "schemaVersion must be 1");
  const runId = String(value.runId ?? "").trim();
  const observedMainSha = String(value.observedMainSha ?? "").trim().toLowerCase();
  if (!RUN_ID.test(runId)) fail("INVALID_EVIDENCE", "runId is invalid");
  if (!SHA.test(observedMainSha)) fail("INVALID_EVIDENCE", "observedMainSha must be a 40-character SHA");

  let completionTruth = null;
  if (value.completionTruth !== undefined && value.completionTruth !== null) {
    const status = String(value.completionTruth?.status ?? "").trim();
    const checkedAt = value.completionTruth?.checkedAt ?? null;
    if (!TRUTH_STATUS.has(status)) fail("INVALID_EVIDENCE", "completionTruth.status is invalid");
    if (!(checkedAt === null || (typeof checkedAt === "string" && checkedAt.trim()))) {
      fail("INVALID_EVIDENCE", "completionTruth.checkedAt must be a non-empty string or null");
    }
    if (["VERIFIED", "FAILED"].includes(status) && !checkedAt) {
      fail("INVALID_EVIDENCE", "completionTruth.checkedAt is required after checking");
    }
    if (status === "NOT_CHECKED" && checkedAt !== null) {
      fail("INVALID_EVIDENCE", "NOT_CHECKED requires checkedAt=null");
    }
    completionTruth = { status, checkedAt: checkedAt === null ? null : checkedAt.trim() };
  }

  if (!Array.isArray(value.operations) || value.operations.length === 0) {
    fail("INVALID_EVIDENCE", "operations must be a non-empty array");
  }
  if (value.operations.length > 100) fail("INVALID_EVIDENCE", "operations exceeds 100");
  const operations = value.operations.map((operation, index) => {
    const action = String(operation?.action ?? "").trim().toUpperCase();
    if (!new Set(["ADD", "REPLACE"]).has(action)) {
      fail("INVALID_OPERATION", `operations[${index}].action must be ADD or REPLACE`);
    }
    const claim = normalizeClaim(operation.claim, { newClaim: true, runId });
    if (action === "ADD") return { action, claim };
    return {
      action,
      expectedClaim: normalizeClaim(operation.expectedClaim, { newClaim: false, runId }),
      claim,
    };
  });

  const sorted = operations
    .map((operation) => ({ operation, digest: sha256(stableStringify(operation)) }))
    .sort((left, right) => left.digest.localeCompare(right.digest));
  const duplicate = sorted.find((item, index) => index > 0 && item.digest === sorted[index - 1].digest);
  if (duplicate) fail("DUPLICATE_OPERATION", `duplicate operation ${duplicate.digest}`);
  const replaced = new Set();
  for (const item of sorted) {
    if (item.operation.action !== "REPLACE") continue;
    const digest = claimDigest(item.operation.expectedClaim);
    if (replaced.has(digest)) fail("CONFLICTING_OPERATION", `claim ${digest} is replaced more than once`);
    replaced.add(digest);
  }

  const normalized = {
    schemaVersion: 1,
    runId,
    observedMainSha,
    completionTruth,
    operations: sorted.map((item) => item.operation),
  };
  const evidenceDigest = sha256(stableStringify({
    completionTruth: normalized.completionTruth,
    operations: normalized.operations,
  }));
  const identity = sha256(`${runId}\n${observedMainSha}\n${evidenceDigest}`);
  return { ...normalized, evidenceDigest, identity };
}

function normalizeReconciliation(value) {
  if (value === undefined) return { schemaVersion: 1, identities: [] };
  if (!value || typeof value !== "object" || Array.isArray(value) || value.schemaVersion !== 1 || !Array.isArray(value.identities)) {
    fail("INVALID_RECONCILIATION_METADATA", "reconciliation must be schemaVersion 1 with identities[]");
  }
  const identities = value.identities.map((item) => {
    const identity = String(item?.identity ?? "").trim();
    const observedMainSha = String(item?.observedMainSha ?? "").trim();
    const evidenceDigest = String(item?.evidenceDigest ?? "").trim();
    const operationCount = Number(item?.operationCount);
    if (!/^[0-9a-f]{64}$/.test(identity) || !SHA.test(observedMainSha) || !/^[0-9a-f]{64}$/.test(evidenceDigest)) {
      fail("INVALID_RECONCILIATION_METADATA", "identity metadata contains an invalid digest or SHA");
    }
    if (!Number.isInteger(operationCount) || operationCount < 1) {
      fail("INVALID_RECONCILIATION_METADATA", "operationCount must be a positive integer");
    }
    return { identity, observedMainSha, evidenceDigest, operationCount };
  });
  identities.sort((left, right) => left.identity.localeCompare(right.identity));
  if (new Set(identities.map((item) => item.identity)).size !== identities.length) {
    fail("INVALID_RECONCILIATION_METADATA", "duplicate identity metadata");
  }
  return { schemaVersion: 1, identities };
}

function verifyApplied(claims, evidence, truth) {
  const digests = claims.map((claim) => claimDigest(normalizeClaim(claim)));
  for (const operation of evidence.operations) {
    const resultDigest = claimDigest(operation.claim);
    if (!digests.includes(resultDigest)) return false;
    if (operation.action === "REPLACE") {
      const oldDigest = claimDigest(operation.expectedClaim);
      if (oldDigest !== resultDigest && digests.includes(oldDigest)) return false;
    }
  }
  if (evidence.completionTruth) {
    if (truth.status !== evidence.completionTruth.status || truth.checkedAt !== evidence.completionTruth.checkedAt) return false;
  }
  return true;
}

export function reconcileLedger({ ledger, evidence: rawEvidence, currentMainSha, currentLedgerSha, expectedLedgerSha }) {
  if (!ledger || typeof ledger !== "object" || Array.isArray(ledger)) fail("INVALID_LEDGER", "ledger must be an object");
  if (ledger.schemaVersion !== 2) fail("INVALID_LEDGER", "schemaVersion must be 2");
  if (Number(ledger.deliveryTruthVersion ?? 2) < 3) {
    fail("HISTORICAL_LEDGER_READ_ONLY", "deliveryTruthVersion < 3 cannot be changed automatically");
  }
  if (!RUN_ID.test(String(ledger.runId ?? ""))) fail("INVALID_LEDGER", "runId is invalid");
  if (!ledger.completionTruth || !Array.isArray(ledger.completionTruth.claims)) {
    fail("INVALID_LEDGER", "completionTruth.claims must be an array");
  }

  const evidence = normalizeEvidence(rawEvidence);
  const mainSha = String(currentMainSha ?? "").trim().toLowerCase();
  const actualLedgerSha = String(currentLedgerSha ?? "").trim().toLowerCase();
  const expectedSha = String(expectedLedgerSha ?? "").trim().toLowerCase();
  if (!SHA.test(mainSha) || mainSha !== evidence.observedMainSha) {
    fail("STALE_MAIN_SHA", `current main ${mainSha || "<invalid>"} does not match ${evidence.observedMainSha}`);
  }
  if (!SHA.test(actualLedgerSha) || !SHA.test(expectedSha) || actualLedgerSha !== expectedSha) {
    fail("STALE_LEDGER_SHA", `current ledger ${actualLedgerSha || "<invalid>"} does not match ${expectedSha || "<invalid>"}`);
  }
  if (ledger.runId !== evidence.runId) {
    fail("RUN_ID_MISMATCH", `ledger ${ledger.runId} does not match evidence ${evidence.runId}`);
  }

  const reconciliation = normalizeReconciliation(ledger.reconciliation);
  const previous = reconciliation.identities.find((item) => item.identity === evidence.identity);
  if (previous) {
    if (!verifyApplied(ledger.completionTruth.claims, evidence, ledger.completionTruth)) {
      fail("APPLIED_IDENTITY_DRIFT", `identity ${evidence.identity} is recorded but its result is no longer present`);
    }
    return { ledger, changed: false, evidence };
  }

  const next = structuredClone(ledger);
  const claims = next.completionTruth.claims;
  for (const operation of evidence.operations) {
    const nextDigest = claimDigest(operation.claim);
    const currentDigests = claims.map((claim) => claimDigest(normalizeClaim(claim)));
    if (operation.action === "ADD") {
      if (!currentDigests.includes(nextDigest)) claims.push(operation.claim);
      continue;
    }

    const expectedDigest = claimDigest(operation.expectedClaim);
    const matches = currentDigests
      .map((digest, index) => ({ digest, index }))
      .filter((item) => item.digest === expectedDigest);
    if (matches.length !== 1) {
      fail("EXPECTED_CLAIM_MISMATCH", `expected claim ${expectedDigest} occurs ${matches.length} time(s)`);
    }
    const existingReplacement = currentDigests.findIndex((digest, index) => digest === nextDigest && index !== matches[0].index);
    if (existingReplacement >= 0) claims.splice(matches[0].index, 1);
    else claims[matches[0].index] = operation.claim;
  }

  if (evidence.completionTruth) {
    next.completionTruth.status = evidence.completionTruth.status;
    next.completionTruth.checkedAt = evidence.completionTruth.checkedAt;
  }
  next.reconciliation = normalizeReconciliation(next.reconciliation);
  next.reconciliation.identities.push({
    identity: evidence.identity,
    observedMainSha: evidence.observedMainSha,
    evidenceDigest: evidence.evidenceDigest,
    operationCount: evidence.operations.length,
  });
  next.reconciliation.identities.sort((left, right) => left.identity.localeCompare(right.identity));
  if (!verifyApplied(next.completionTruth.claims, evidence, next.completionTruth)) {
    fail("RECONCILIATION_POSTCONDITION_FAILED", "reconciled claims do not match the evidence artifact");
  }
  return { ledger: next, changed: stableStringify(next) !== stableStringify(ledger), evidence };
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  const parsed = { command, positional: [] };
  for (let index = 0; index < rest.length; index += 1) {
    const value = rest[index];
    if (!value.startsWith("--")) { parsed.positional.push(value); continue; }
    const key = value.slice(2);
    const next = rest[index + 1];
    parsed[key] = next && !next.startsWith("--") ? rest[++index] : true;
  }
  return parsed;
}

function validateCandidate(candidatePath) {
  const validator = path.join(path.dirname(fileURLToPath(import.meta.url)), "run-ledger-v2.mjs");
  const result = spawnSync(process.execPath, [validator, "validate", candidatePath], { encoding: "utf8" });
  if (result.status !== 0) fail("LEDGER_VALIDATION_FAILED", (result.stderr || result.stdout || "validator failed").trim());
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.command !== "apply") {
    throw new Error("Usage: run-ledger-reconcile.mjs apply --ledger <run.json> --evidence <evidence.json> --current-main-sha <sha> --expected-ledger-sha <blob-sha> [--result <result.json>]");
  }
  for (const key of ["ledger", "evidence", "current-main-sha", "expected-ledger-sha"]) {
    if (!args[key]) fail("MISSING_ARGUMENT", `--${key} is required`);
  }
  const ledgerPath = path.resolve(args.ledger);
  const raw = fs.readFileSync(ledgerPath, "utf8");
  const currentLedgerSha = gitBlobSha(raw);
  const ledger = JSON.parse(raw);
  const evidence = JSON.parse(fs.readFileSync(path.resolve(args.evidence), "utf8"));
  const result = reconcileLedger({
    ledger,
    evidence,
    currentMainSha: args["current-main-sha"],
    currentLedgerSha,
    expectedLedgerSha: args["expected-ledger-sha"],
  });

  let output = raw;
  if (result.changed) {
    output = `${JSON.stringify(result.ledger, null, 2)}\n`;
    const candidate = `${ledgerPath}.reconcile-${process.pid}.tmp`;
    fs.writeFileSync(candidate, output, "utf8");
    try {
      validateCandidate(candidate);
      fs.renameSync(candidate, ledgerPath);
    } finally {
      if (fs.existsSync(candidate)) fs.unlinkSync(candidate);
    }
  }
  const summary = {
    status: result.changed ? "RECONCILED" : "NO_CHANGES",
    runId: result.evidence.runId,
    observedMainSha: result.evidence.observedMainSha,
    evidenceDigest: result.evidence.evidenceDigest,
    identity: result.evidence.identity,
    ledgerShaBefore: currentLedgerSha,
    ledgerShaAfter: gitBlobSha(output),
    operationCount: result.evidence.operations.length,
  };
  if (args.result) {
    fs.mkdirSync(path.dirname(path.resolve(args.result)), { recursive: true });
    fs.writeFileSync(path.resolve(args.result), `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }
  console.log(`${summary.status} ${summary.runId} ${summary.identity}`);
  return summary;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
