#!/usr/bin/env node

import fs from "node:fs";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const GOVERNANCE_SCOPE_BUDGET = Object.freeze({ maxFiles: 8, maxChangedLines: 800 });

function readField(body = "", field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body).match(new RegExp(`^[ \\t]*[-*]?[ \\t]*${escaped}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, "mi"));
  return (match?.[1] ?? "").trim();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function evaluateGovernanceScope(pr = {}) {
  const body = pr.body ?? "";
  const origin = upper(readField(body, "WORK_ORIGIN"));
  const lane = upper(readField(body, "AGENT_LANE"));
  const state = upper(readField(body, "LANE_STATE"));
  const exception = readField(body, "GOVERNANCE_SCOPE_EXCEPTION");
  const files = Number(pr.changed_files);
  const additions = Number(pr.additions);
  const deletions = Number(pr.deletions);
  const changedLines = additions + deletions;
  const applies = origin === "AGENT" && lane === "GOVERNANCE" && state === "ACTIVE";

  if (!applies) return { applies: false, allowed: true, files, changedLines, exception: null, errors: [] };

  const errors = [];
  if (![files, additions, deletions, changedLines].every(Number.isFinite)) {
    errors.push("Governance scope metrics are unavailable; fail closed until changed_files/additions/deletions are known");
  }
  const overFiles = Number.isFinite(files) && files > GOVERNANCE_SCOPE_BUDGET.maxFiles;
  const overLines = Number.isFinite(changedLines) && changedLines > GOVERNANCE_SCOPE_BUDGET.maxChangedLines;
  const validException = /^OWNER:(?:#\d+|docs\/decisions\/[A-Za-z0-9._/-]+\.md)$/.test(exception);

  if ((overFiles || overLines) && !validException) {
    errors.push(
      `Active Agent governance PR exceeds scope budget: ${files} files / ${changedLines} changed lines; ` +
      `max ${GOVERNANCE_SCOPE_BUDGET.maxFiles} / ${GOVERNANCE_SCOPE_BUDGET.maxChangedLines}. ` +
      "Split it or provide GOVERNANCE_SCOPE_EXCEPTION=OWNER:#issue or OWNER:docs/decisions/<file>.md",
    );
  }
  if (exception && !/^none$/i.test(exception) && !validException) {
    errors.push("GOVERNANCE_SCOPE_EXCEPTION must be none, OWNER:#issue, or OWNER:docs/decisions/<file>.md");
  }

  return { applies: true, allowed: errors.length === 0, files, changedLines, exception: validException ? exception : null, errors };
}

export function runCli(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath) throw new Error("GITHUB_EVENT_PATH is required");
  const event = JSON.parse(fs.readFileSync(eventPath, "utf8"));
  const result = evaluateGovernanceScope(event.pull_request ?? {});
  console.log(JSON.stringify(result, null, 2));
  if (!result.allowed) {
    result.errors.forEach((error) => console.error(error));
    process.exitCode = 1;
  }
  return result;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
