#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { computeWeightedUsage } from "./score-run.mjs";
import { MAX_ACTIVE_CANDIDATES } from "./agent-wip-policy.mjs";
import { validateRunLedgerV2 } from "./run-ledger-v2.mjs";
import {
  canonicalIssueEvidenceRef,
  canonicalIssueSubject,
  computeDeliveryOutcome,
  evaluateCompletionTruth,
  renderMarkdownV2,
  scoreRunV2,
} from "./score-run-v2.mjs";

export const OBSERVED_SCORE_EFFECTIVE_AT = "2026-09-15T00:00:00Z";
export const OBSERVED_SCORE_PROFILE = "OBSERVED_V1";
export const LEGACY_SCORE_PROFILE = "LEGACY_V2";

const FINAL = new Set(["BASELINE", "COMPLETE", "OWNER_BLOCKED"]);
const DELIVERY_CLAIMS = new Set(["ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE"]);
const PRODUCTION_TYPES = [
  "SOURCE_VERIFIED",
  "MERGED_TO_MAIN",
  "AUTO_VERCEL_DEPLOYED",
  "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED",
];
const PRODUCTION_SUCCESS = {
  SOURCE_VERIFIED: new Set(["success"]),
  MERGED_TO_MAIN: new Set(["merged"]),
  AUTO_VERCEL_DEPLOYED: new Set(["ready"]),
  PRODUCTION_SCHEMA_READY: new Set(["ready", "not_required"]),
  AUTHENTICATED_PRODUCTION_ACCEPTED: new Set(["accepted"]),
};

const num = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const round = (value, digits = 1) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const lower = (value) => String(value ?? "").trim().toLowerCase();
const inverse = (value, best, worst, max) => value <= best ? max : value >= worst ? 0 : max * (1 - ((value - best) / (worst - best)));
const usableRef = (value) => {
  const text = String(value ?? "").trim();
  return Boolean(text && !/^(?:TBD|N\/A|UNKNOWN|NONE|-)$/i.test(text) && !text.includes("<!--"));
};

export function usesObservedScoreProfile(run) {
  if (!FINAL.has(run?.status)) return false;
  if (Number(run?.deliveryTruthVersion ?? 0) !== 4) return false;
  if (run?.closeout?.ownerRole !== "PRODUCT_MAIN_SESSION") return false;
  const startedAt = Date.parse(String(run?.startedAt ?? ""));
  const effectiveAt = Date.parse(OBSERVED_SCORE_EFFECTIVE_AT);
  return Number.isFinite(startedAt) && startedAt >= effectiveAt;
}

function observedTaskStats(run) {
  const tasks = Array.isArray(run?.modelUsage?.tasks) ? run.modelUsage.tasks : [];
  let total = 0;
  let luna = 0;
  let lunaAccepted = 0;
  for (const task of tasks) {
    const count = Math.max(0, num(task?.count));
    total += count;
    const requested = lower(task?.requestedModel);
    if (requested === "luna") {
      luna += count;
      if (task?.accepted === true) lunaAccepted += count;
    }
  }
  return {
    total,
    luna,
    lunaAccepted,
    lunaAcceptancePercent: luna > 0 ? round(lunaAccepted / luna * 100) : 0,
  };
}

function collectObservedTruth(run) {
  const claims = run?.completionTruth?.claims ?? [];
  const verified = claims.filter((claim) => claim?.verification === "VERIFIED");
  const closed = new Set();
  const ownerBlocked = new Set();
  const stageBySubject = new Map();
  const gradingGaps = [];

  for (const claim of claims) {
    if (claim?.type !== "OTHER" && claim?.verification === "UNVERIFIED") {
      gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} is unverified`);
    }
  }

  for (const claim of verified) {
    if (!usableRef(claim.evidenceRef)) gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} has no usable evidenceRef`);

    if (DELIVERY_CLAIMS.has(claim.type)) {
      const subject = canonicalIssueSubject(claim.subject);
      const evidenceSubject = canonicalIssueEvidenceRef(claim.evidenceRef);
      if (!subject) gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} does not identify one canonical Issue`);
      if (!evidenceSubject) gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} evidenceRef does not identify one canonical Issue`);
      if (subject && evidenceSubject && subject !== evidenceSubject) gradingGaps.push(`${claim.type} ${subject} evidenceRef points to ${evidenceSubject}`);
      if (subject && evidenceSubject === subject) {
        if (claim.type === "ISSUE_CLOSED" && lower(claim.observedState) === "closed") closed.add(subject);
        if (claim.type === "OWNER_BLOCKED_COMPLETE" && lower(claim.observedState) === "owner_blocked_complete") ownerBlocked.add(subject);
      }
    }

    if (PRODUCTION_TYPES.includes(claim.type)) {
      const subject = canonicalIssueSubject(claim.subject);
      if (!subject) continue;
      if (!stageBySubject.has(subject)) stageBySubject.set(subject, new Set());
      if (PRODUCTION_SUCCESS[claim.type].has(lower(claim.observedState))) stageBySubject.get(subject).add(claim.type);
    }
  }

  if (run?.completionTruth?.status !== "VERIFIED") gradingGaps.push("completionTruth.status must be VERIFIED");
  const runComplete = verified.some((claim) => claim.type === "RUN_COMPLETE" && lower(claim.observedState) === "complete" && usableRef(claim.evidenceRef));
  if (!runComplete) gradingGaps.push("verified RUN_COMPLETE claim is required");
  if (closed.size !== num(run?.delivery?.issuesClosed)) gradingGaps.push(`delivery.issuesClosed=${num(run?.delivery?.issuesClosed)} does not match ${closed.size} unique verified ISSUE_CLOSED subject(s)`);
  if (ownerBlocked.size !== num(run?.delivery?.ownerBlockedComplete)) gradingGaps.push(`delivery.ownerBlockedComplete=${num(run?.delivery?.ownerBlockedComplete)} does not match ${ownerBlocked.size} unique verified OWNER_BLOCKED_COMPLETE subject(s)`);

  let completedStages = 0;
  for (const subject of closed) completedStages += stageBySubject.get(subject)?.size ?? 0;
  const stageSlots = closed.size * PRODUCTION_TYPES.length;
  const productionStageCoveragePercent = stageSlots > 0 ? round(completedStages / stageSlots * 100) : 0;

  const relevantClaims = claims.filter((claim) => claim?.type !== "OTHER");
  const verifiedWithEvidence = relevantClaims.filter((claim) => claim?.verification === "VERIFIED" && usableRef(claim.evidenceRef));
  const claimEvidenceCoveragePercent = relevantClaims.length ? round(verifiedWithEvidence.length / relevantClaims.length * 100) : 0;

  return {
    closed,
    ownerBlocked,
    productionStageCoveragePercent,
    claimEvidenceCoveragePercent,
    gradingGaps: [...new Set(gradingGaps)],
  };
}

function observedReadiness(run, truth, tasks) {
  const gaps = [];
  if (!FINAL.has(run.status)) gaps.push("run is still in progress");
  if (!run.endedAt) gaps.push("endedAt is missing");
  if (!run.main?.endSha) gaps.push("main.endSha is missing");
  for (const field of ["openIssuesEnd", "openPrsEnd"]) {
    if (!Number.isInteger(run.inventory?.[field]) || run.inventory[field] < 0) gaps.push(`inventory.${field} is missing`);
  }
  if (tasks.total <= 0) gaps.push("modelUsage.tasks has no observed task records");
  return [...new Set([...gaps, ...truth.gradingGaps])];
}

function deriveObservedMetrics(run, truth, outcome, tasks) {
  const startedAt = Date.parse(String(run.startedAt ?? ""));
  const endedAt = Date.parse(String(run.endedAt ?? ""));
  const cycleTimeMinutes = Number.isFinite(startedAt) && Number.isFinite(endedAt) && endedAt >= startedAt
    ? round((endedAt - startedAt) / 60000)
    : null;
  const closureSweeps = num(run.inventory?.closureSweeps);
  const closureConversionPercent = closureSweeps > 0 ? round(num(run.inventory?.closureAdvancedOrClosed) / closureSweeps * 100) : 0;
  const solIssues = num(run.flow?.solIssues);
  const solTouchesPerIssue = solIssues > 0 ? round(num(run.flow?.solTouches) / solIssues, 2) : null;
  const opportunityCount = Math.max(1, num(run.delivery?.issuesStarted), truth.closed.size + truth.ownerBlocked.size + num(run.delivery?.unfinishedCarryover));
  return {
    observedTaskCount: tasks.total,
    cycleTimeMinutes,
    lunaAcceptancePercent: tasks.lunaAcceptancePercent,
    closureConversionPercent,
    solTouchesPerIssue,
    autonomousCompletionPercent: round(Math.min(1, outcome.autonomousOutcomeUnits / opportunityCount) * 100),
    claimEvidenceCoveragePercent: truth.claimEvidenceCoveragePercent,
    productionStageCoveragePercent: truth.productionStageCoveragePercent,
  };
}

function observedScores(run, outcome, metrics) {
  const usage =
    inverse(num(run.modelUsage?.fullContextReplays), 0, 3, 5) +
    inverse(num(run.ci?.invalidReruns), 0, 3, 5) +
    inverse(num(run.modelUsage?.duplicateScans), 0, 3, 4) +
    inverse(num(run.flow?.duplicateAgentTasks), 0, 2, 3) +
    inverse(num(run.flow?.ownershipCollisions), 0, 2, 3);

  const completion =
    12 * metrics.autonomousCompletionPercent / 100 +
    6 * metrics.productionStageCoveragePercent / 100 +
    inverse(num(run.delivery?.unfinishedCarryover), 0, 5, 4) +
    3 * metrics.closureConversionPercent / 100 +
    (num(run.inventory?.activeCandidatePeak) <= MAX_ACTIVE_CANDIDATES ? 3 : 0) +
    (num(run.inventory?.sharedTestPeak) <= 1 && num(run.ci?.sharedTestCollisions) === 0 ? 2 : 0);

  const quality =
    Math.max(0, 10 - num(run.quality?.unresolvedP0) * 5 - num(run.quality?.unresolvedP1)) +
    inverse(num(run.quality?.reopenedIssues) + num(run.quality?.postMergeRegressions), 0, 3, 6) +
    (num(run.quality?.safetyViolations) === 0 && !(run.quality?.hardFailReasons ?? []).length ? 6 : 0) +
    8 * metrics.claimEvidenceCoveragePercent / 100;

  const flow =
    4 * metrics.lunaAcceptancePercent / 100 +
    (metrics.solTouchesPerIssue === null ? 0 : inverse(metrics.solTouchesPerIssue, 2, 5, 2)) +
    (num(run.inventory?.closureSweeps) > 0 ? 2 : 0) +
    (num(run.inventory?.mainTerraPeak) >= 1 && num(run.inventory?.mainTerraPeak) <= 2 ? 2 : 0);

  const auditability =
    (run.completionTruth?.status === "VERIFIED" ? 3 : 0) +
    (run.closeout?.state === "CLOSED" && run.closeout?.closedAt === run.endedAt ? 3 : 0) +
    2 * metrics.productionStageCoveragePercent / 100 +
    inverse(num(run.auditability?.stalePendingDescriptions), 0, 3, 2);

  return {
    usage: round(usage),
    completion: round(completion),
    quality: round(quality),
    flow: round(flow),
    auditability: round(auditability),
    solTouchesPerIssue: metrics.solTouchesPerIssue,
  };
}

function grade(total) {
  if (total >= 90) return "A";
  if (total >= 80) return "B";
  if (total >= 70) return "C";
  if (total >= 60) return "D";
  return "F";
}

export function scoreObservedRun(run) {
  const validation = validateRunLedgerV2(run);
  if (validation.length) throw new Error(`Invalid v2 ledger:\n${validation.map((item) => `- ${item}`).join("\n")}`);

  const outcome = computeDeliveryOutcome(run);
  const usage = computeWeightedUsage(run);
  const legacyTruth = evaluateCompletionTruth(run);
  const truth = collectObservedTruth(run);
  const tasks = observedTaskStats(run);
  const hardFailures = [...legacyTruth.hardFailures, ...(run.quality?.hardFailReasons ?? [])];
  if (num(run.quality?.safetyViolations) > 0) hardFailures.push("quality.safetyViolations > 0");
  const uniqueHardFailures = [...new Set(hardFailures)];
  const gradingGaps = observedReadiness(run, truth, tasks);
  const metrics = deriveObservedMetrics(run, truth, outcome, tasks);

  const base = {
    runId: run.runId,
    scoreProfile: OBSERVED_SCORE_PROFILE,
    comparisonEligible: false,
    ...outcome,
    weightedUsageUnits: usage.weightedUsageUnits,
    weightedUsagePerShippedUnit: null,
    weightedUsagePerAutonomousOutcome: null,
    observedMetrics: metrics,
  };

  if (uniqueHardFailures.length) return {
    ...base,
    scoreStatus: "HARD_FAIL",
    grade: "F-HARD",
    total: 0,
    gradingGaps: [],
    hardFailures: uniqueHardFailures,
    scores: null,
  };

  if (gradingGaps.length) return {
    ...base,
    scoreStatus: "NOT_GRADED",
    grade: "NOT_GRADED",
    total: null,
    gradingGaps,
    hardFailures: [],
    scores: null,
  };

  const scores = observedScores(run, outcome, metrics);
  const total = round(scores.usage + scores.completion + scores.quality + scores.flow + scores.auditability);
  return {
    ...base,
    scoreStatus: "GRADED_OBSERVED_V1",
    grade: grade(total),
    total,
    comparisonEligible: true,
    weightedUsagePerShippedUnit: outcome.shippedUnits >= 1 ? round(usage.weightedUsageUnits / outcome.shippedUnits, 2) : null,
    weightedUsagePerAutonomousOutcome: outcome.autonomousOutcomeUnits >= 1 ? round(usage.weightedUsageUnits / outcome.autonomousOutcomeUnits, 2) : null,
    gradingGaps: [],
    hardFailures: [],
    scores,
  };
}

export function scoreRunCurrent(run) {
  if (!usesObservedScoreProfile(run)) return { ...scoreRunV2(run), scoreProfile: LEGACY_SCORE_PROFILE, observedMetrics: null };
  return scoreObservedRun(run);
}

/**
 * Pure grading-readiness check for a candidate Run, reusing scoreRunCurrent's
 * own gap detection instead of re-deriving it. Used by run-ledger-v2.mjs's
 * closeout preflight so that "would this Run be scoreable once closed" is
 * answered by the same logic that scores it later, not a parallel copy that
 * can drift from it.
 *
 * Returns the candidate's gradingGaps (empty when it would be gradeable).
 * A HARD_FAIL result (contradicted claims etc.) is a distinct outcome from
 * NOT_GRADED and is intentionally left out of this list — it is caught by
 * validateRunLedgerV2 / the existing hard-fail-reason fields, not by this
 * closeout gate, which exists specifically to stop the NOT_GRADED trap.
 */
export function closeoutGradingGaps(run) {
  return scoreRunCurrent(run).gradingGaps;
}

const show = (value) => value === null || value === undefined ? "資料不足" : String(value);

export function renderCurrentMarkdown(run, result) {
  if (result.scoreProfile === LEGACY_SCORE_PROFILE) return renderMarkdownV2(run, result);
  const lines = [
    `# Delivery Outcome：${run.runId}`,
    "",
    `> 評分契約：**${result.scoreProfile}**（startedAt 自 ${OBSERVED_SCORE_EFFECTIVE_AT} 起的新 terminal Product Run）`,
    `> 評分狀態：**${result.scoreStatus}**`,
    `> 分數：${result.total === null ? "尚不評分" : `**${result.total} / 100（${result.grade}）**`}`,
    "",
    "## 兩本帳",
    "",
    `- 真正出貨 shipped_units：${result.shippedUnits}`,
    `- 正式環境待驗 production_pending：${result.productionPendingUnits}`,
    `- 自主完成 autonomous_outcome_units：${result.autonomousOutcomeUnits}`,
    `- 在製品 WIP：Audit Ready ${result.wipInventory.auditReady}、CI-only ${result.wipInventory.exactHeadCiOnly}、commit-only ${result.wipInventory.commitOnly}、carryover ${result.wipInventory.unfinishedCarryover}`,
    `- 內部加權 usage：${result.weightedUsageUnits}（比較尺，不是官方 token）`,
    `- 每件真正出貨 usage：${show(result.weightedUsagePerShippedUnit)}`,
    "",
    "## 可觀測衍生指標",
    "",
    `- observed task events：${show(result.observedMetrics?.observedTaskCount)}`,
    `- cycle time：${show(result.observedMetrics?.cycleTimeMinutes)} 分鐘（startedAt → endedAt）`,
    `- Luna 採用率：${show(result.observedMetrics?.lunaAcceptancePercent)}%（直接由 modelUsage.tasks 衍生）`,
    `- closure conversion：${show(result.observedMetrics?.closureConversionPercent)}%`,
    `- verified claim evidence coverage：${show(result.observedMetrics?.claimEvidenceCoveragePercent)}%`,
    `- Production stage coverage：${show(result.observedMetrics?.productionStageCoveragePercent)}%`,
    `- Sol touches / issue：${show(result.observedMetrics?.solTouchesPerIssue)}`,
    "",
    "## Legacy supplemental telemetry（不再是 grading gate）",
    "",
    `- weightedUsageImprovementPercent：${show(run.modelUsage?.weightedUsageImprovementPercent)}`,
    `- firstPassRatePercent：${show(run.ci?.firstPassRatePercent)}`,
    `- acceptanceEvidenceCoveragePercent：${show(run.quality?.acceptanceEvidenceCoveragePercent)}`,
    `- auditFirstPassRatePercent：${show(run.quality?.auditFirstPassRatePercent)}`,
    `- waitTimeConvertedPercent：${show(run.flow?.waitTimeConvertedPercent)}`,
    "",
  ];
  if (result.gradingGaps.length) lines.push("## 為什麼尚不評分", "", ...result.gradingGaps.map((item) => `- ${item}`), "");
  if (result.hardFailures.length) lines.push("## 硬性失敗", "", ...result.hardFailures.map((item) => `- ${item}`), "");
  if (result.scores) lines.push(
    "## 五面向", "",
    "| 面向 | 分數 |", "|---|---:|",
    `| usage / waste | ${result.scores.usage} / 20 |`,
    `| 完成效率 | ${result.scores.completion} / 30 |`,
    `| 品質安全 | ${result.scores.quality} / 30 |`,
    `| Agent 流動 | ${result.scores.flow} / 10 |`,
    `| 證據完整 | ${result.scores.auditability} / 10 |`, "",
  );
  lines.push(
    "---", "",
    "OBSERVED_V1 只使用 ledger 既有原始事件、Completion Truth 與可直接衍生比例；缺少 denominator 的人工百分比保持 unknown，不補猜，也不再因一格 null 讓整輪失去分數。歷史或跨 cutoff 已開始的 Run 仍由 LEGACY_V2 原樣重播。", "",
  );
  return lines.join("\n");
}

function cli() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: score-run-current.mjs <ledger.json> [--output report.md]");
  const run = JSON.parse(fs.readFileSync(input, "utf8"));
  const result = scoreRunCurrent(run);
  const markdown = renderCurrentMarkdown(run, result);
  const outputIndex = process.argv.indexOf("--output");
  if (outputIndex >= 0 && process.argv[outputIndex + 1]) {
    const output = process.argv[outputIndex + 1];
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, markdown, "utf8");
    console.log(output);
  } else process.stdout.write(markdown);
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { cli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
