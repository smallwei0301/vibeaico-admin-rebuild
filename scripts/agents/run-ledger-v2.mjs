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

export function createRunLedgerV2(runId, startedAt = new Date().toISOString()) {
  const run = createLegacyLedger(runId, startedAt);
  return {
    ...run,
    schemaVersion: 2,
    deliveryTruthVersion: 3,
    completionTruth: { status: "NOT_CHECKED", checkedAt: null, claims: [] },
  };
}

export function validateRunLedgerV2(run) {
  if (!run || typeof run !== "object" || Array.isArray(run)) return ["run must be an object"];
  const errors = [];
  if (run.schemaVersion !== 2) errors.push("schemaVersion must be 2");
  if (run.deliveryTruthVersion !== undefined && ![2, 3].includes(run.deliveryTruthVersion)) {
    errors.push("deliveryTruthVersion must be 2 or 3 when provided");
  }

  const legacy = { ...run, schemaVersion: 1 };
  delete legacy.deliveryTruthVersion;
  delete legacy.completionTruth;
  errors.push(...validateLegacyLedger(legacy));

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
    const output = input.output ?? `docs/metrics/agent-runs/${input["run-id"]}.json`;
    if (fs.existsSync(output)) throw new Error(`refusing to overwrite existing ledger: ${output}`);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, `${JSON.stringify(createRunLedgerV2(input["run-id"]), null, 2)}\n`, "utf8");
    console.log(output);
    return;
  }
  if (input.command === "validate") {
    const file = input.positional[0];
    if (!file) throw new Error("ledger path is required");
    const run = JSON.parse(fs.readFileSync(file, "utf8"));
    const errors = validateRunLedgerV2(run);
    if (errors.length) throw new Error(errors.map((item) => `- ${item}`).join("\n"));
    console.log(`VALID_V2 ${run.runId}`);
    return;
  }
  throw new Error("Usage: run-ledger-v2.mjs init --run-id YYYY-MM-DD-name | validate <file>");
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
