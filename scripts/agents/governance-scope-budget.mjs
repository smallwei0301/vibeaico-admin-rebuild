#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

export const GOVERNANCE_SCOPE_BUDGET = Object.freeze({ maxFiles: 8, maxChangedLines: 800 });
export const GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR =
  "GOVERNANCE_SCOPE_EXCEPTION must be none or OWNER:docs/decisions/<file>.md";

function readField(body = "", field) {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(body).match(new RegExp(`^[ \\t]*[-*]?[ \\t]*${escaped}[ \\t]*:[ \\t]*(.*?)[ \\t]*$`, "mi"));
  return (match?.[1] ?? "").trim();
}

function upper(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function parseGovernanceScopeException(value = "") {
  const exception = String(value ?? "").trim();
  if (!exception || /^none$/i.test(exception)) {
    return { valid: true, kind: "NONE", exception, decisionPath: null, error: null };
  }

  const match = exception.match(/^OWNER:(docs\/decisions\/[A-Za-z0-9._/-]+\.md)$/);
  const decisionPath = match?.[1] ?? null;
  const segments = decisionPath?.split("/") ?? [];
  const safePath = Boolean(
    decisionPath &&
    segments.length >= 3 &&
    segments.every((segment) => segment && segment !== "." && segment !== ".."),
  );
  if (!safePath) {
    return {
      valid: false,
      kind: "INVALID",
      exception,
      decisionPath: null,
      error: GOVERNANCE_SCOPE_EXCEPTION_FORMAT_ERROR,
    };
  }

  return { valid: true, kind: "OWNER_DECISION", exception, decisionPath, error: null };
}

function loadTrustedDecision(decisionPath) {
  const fullPath = path.resolve(process.cwd(), decisionPath);
  const decisionsRoot = `${path.resolve(process.cwd(), "docs/decisions")}${path.sep}`;
  if (!fullPath.startsWith(decisionsRoot) || !fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, "utf8");
}

export function evaluateGovernanceScope(pr = {}, { loadDecision = loadTrustedDecision } = {}) {
  const body = pr.body ?? "";
  const origin = upper(readField(body, "WORK_ORIGIN"));
  const lane = upper(readField(body, "AGENT_LANE"));
  const state = upper(readField(body, "LANE_STATE"));
  const parsedException = parseGovernanceScopeException(readField(body, "GOVERNANCE_SCOPE_EXCEPTION"));
  const exception = parsedException.exception;
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
  const decisionPath = parsedException.decisionPath;
  const decision = decisionPath ? loadDecision(decisionPath) : null;
  const validException = Boolean(
    decision &&
    upper(readField(decision, "GOVERNANCE_SCOPE_EXCEPTION")) === "APPROVED" &&
    readField(decision, "GOVERNANCE_SCOPE_BRANCH") === String(pr.head?.ref ?? ""),
  );

  if (!parsedException.valid) {
    errors.push(parsedException.error);
  } else if (decisionPath && !validException) {
    errors.push("Scope exception decision must exist on trusted main and approve this exact branch");
  }
  if ((overFiles || overLines) && !validException) {
    errors.push(
      `Active Agent governance PR exceeds scope budget: ${files} files / ${changedLines} changed lines; ` +
      `max ${GOVERNANCE_SCOPE_BUDGET.maxFiles} / ${GOVERNANCE_SCOPE_BUDGET.maxChangedLines}. ` +
      "Split it or cite a trusted Owner Decision for this exact branch",
    );
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

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}