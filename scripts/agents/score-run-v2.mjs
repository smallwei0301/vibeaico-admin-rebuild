#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { computeWeightedUsage } from "./score-run.mjs";
import { validateRunLedgerV2 } from "./run-ledger-v2.mjs";

const FINAL = new Set(["BASELINE", "COMPLETE", "OWNER_BLOCKED"]);
const STRICT_EXPECTED = {
  ISSUE_CLOSED: "closed",
  OWNER_BLOCKED_COMPLETE: "owner_blocked_complete",
  PR_MERGED: "merged",
  CI_GREEN: "success",
  LOCAL_TEST_GREEN: "success",
  RUN_COMPLETE: "complete",
};
const DELIVERY_CLAIM_TYPES = new Set(["ISSUE_CLOSED", "OWNER_BLOCKED_COMPLETE"]);
const PRODUCTION_TRUTH_CLAIM_TYPES = new Set([
  "SOURCE_VERIFIED",
  "MERGED_TO_MAIN",
  "AUTO_VERCEL_DEPLOYED",
  "PRODUCTION_SCHEMA_READY",
  "AUTHENTICATED_PRODUCTION_ACCEPTED",
]);
const PRODUCTION_SUCCESS_STATES = Object.freeze({
  SOURCE_VERIFIED: new Set(["success"]),
  MERGED_TO_MAIN: new Set(["merged"]),
  AUTO_VERCEL_DEPLOYED: new Set(["ready"]),
  PRODUCTION_SCHEMA_READY: new Set(["ready", "not_required"]),
  AUTHENTICATED_PRODUCTION_ACCEPTED: new Set(["accepted"]),
});
const CURRENT_REPOSITORY = String(
  process.env.GITHUB_REPOSITORY ?? "smallwei0301/vibeaico-admin-rebuild",
).trim().toLowerCase();

const num = (value, fallback = 0) => typeof value === "number" && Number.isFinite(value) ? value : fallback;
const round = (value, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
};
const inverse = (value, best, worst, max) => value <= best ? max : value >= worst ? 0 : max * (1 - ((value - best) / (worst - best)));
const linear = (value, low, high, max) => value <= low ? 0 : value >= high ? max : max * ((value - low) / (high - low));
const lower = (value) => String(value ?? "").trim().toLowerCase();
const usesProductionTruth = (run) => Number(run?.deliveryTruthVersion ?? 2) >= 3;

function isUsableReference(value) {
  const text = String(value ?? "").trim();
  return Boolean(
    text &&
    !text.includes("<!--") &&
    !text.includes("|") &&
    !/^(?:TBD|N\/A|UNKNOWN|NONE|-)$/i.test(text)
  );
}

export function canonicalIssueSubject(value) {
  const text = String(value ?? "").trim();
  if (!isUsableReference(text)) return null;

  const repositoryUrl = text.match(
    /^https:\/\/(?:github\.com\/|api\.github\.com\/repos\/)([^/\s]+)\/([^/\s]+)\/issues\//i,
  );
  if (repositoryUrl && `${repositoryUrl[1]}/${repositoryUrl[2]}`.toLowerCase() !== CURRENT_REPOSITORY) {
    return null;
  }

  const local = text.match(/^(?:issue\s*(?:#|:)\s*|issue\s+|#\s*)([1-9]\d*)$/i);
  const web = text.match(/^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/issues\/([1-9]\d*)(?:[/?#].*)?$/i);
  const api = text.match(/^https:\/\/api\.github\.com\/repos\/[^/\s]+\/[^/\s]+\/issues\/([1-9]\d*)(?:[/?#].*)?$/i);
  const issueNumber = Number(local?.[1] ?? web?.[1] ?? api?.[1]);

  return Number.isSafeInteger(issueNumber) && issueNumber > 0 ? `issue#${issueNumber}` : null;
}

export function canonicalIssueEvidenceRef(value) {
  const text = String(value ?? "").trim();
  if (!isUsableReference(text)) return null;
  return canonicalIssueSubject(text.replace(/^github:/i, ""));
}

function collectDeliveryEvidence(run) {
  const closedSubjects = new Set();
  const ownerBlockedSubjects = new Set();
  const stageSubjects = {
    SOURCE_VERIFIED: new Set(),
    MERGED_TO_MAIN: new Set(),
    AUTO_VERCEL_DEPLOYED: new Set(),
    PRODUCTION_SCHEMA_READY: new Set(),
    AUTHENTICATED_PRODUCTION_ACCEPTED: new Set(),
  };

  const empty = () => ({
    closedSubjects,
    ownerBlockedSubjects,
    ownerBlockedOnlySubjects: new Set(),
    overlappingSubjects: new Set(),
    stageSubjects,
    shippedSubjects: new Set(),
    productionPendingSubjects: new Set(),
  });
  if (run?.completionTruth?.status !== "VERIFIED") return empty();

  const claims = run.completionTruth.claims ?? [];
  for (const claim of claims) {
    if (claim.verification !== "VERIFIED") continue;
    const claimed = lower(claim.claimedState);
    const observed = lower(claim.observedState);
    if (claimed !== observed) continue;

    if (DELIVERY_CLAIM_TYPES.has(claim.type)) {
      const expected = STRICT_EXPECTED[claim.type];
      if (observed !== expected) continue;
      const subject = canonicalIssueSubject(claim.subject);
      const evidenceSubject = canonicalIssueEvidenceRef(claim.evidenceRef);
      if (!subject || evidenceSubject !== subject) continue;
      if (claim.type === "ISSUE_CLOSED") closedSubjects.add(subject);
      else ownerBlockedSubjects.add(subject);
      continue;
    }

    if (PRODUCTION_TRUTH_CLAIM_TYPES.has(claim.type)) {
      const subject = canonicalIssueSubject(claim.subject);
      if (!subject || !isUsableReference(claim.evidenceRef)) continue;
      if (PRODUCTION_SUCCESS_STATES[claim.type].has(observed)) {
        stageSubjects[claim.type].add(subject);
      }
    }
  }

  const overlappingSubjects = new Set(
    [...closedSubjects].filter((subject) => ownerBlockedSubjects.has(subject)),
  );
  const ownerBlockedOnlySubjects = new Set(
    [...ownerBlockedSubjects].filter((subject) => !closedSubjects.has(subject)),
  );
  const shippedSubjects = usesProductionTruth(run)
    ? new Set([...closedSubjects].filter((subject) => (
        stageSubjects.SOURCE_VERIFIED.has(subject) &&
        stageSubjects.MERGED_TO_MAIN.has(subject) &&
        stageSubjects.AUTO_VERCEL_DEPLOYED.has(subject) &&
        stageSubjects.PRODUCTION_SCHEMA_READY.has(subject) &&
        stageSubjects.AUTHENTICATED_PRODUCTION_ACCEPTED.has(subject)
      )))
    : new Set(closedSubjects);
  const productionPendingSubjects = new Set(
    [...closedSubjects].filter((subject) => !shippedSubjects.has(subject)),
  );

  return {
    closedSubjects,
    ownerBlockedSubjects,
    ownerBlockedOnlySubjects,
    overlappingSubjects,
    stageSubjects,
    shippedSubjects,
    productionPendingSubjects,
  };
}

export function computeDeliveryOutcome(run) {
  const evidence = collectDeliveryEvidence(run);
  const shippedUnits = evidence.shippedSubjects.size;
  const autonomousOutcomeUnits = shippedUnits + (evidence.ownerBlockedOnlySubjects.size * 0.75);
  return {
    shippedUnits: round(shippedUnits),
    productionPendingUnits: round(evidence.productionPendingSubjects.size),
    autonomousOutcomeUnits: round(autonomousOutcomeUnits),
    wipInventory: {
      auditReady: num(run.delivery.auditReady),
      exactHeadCiOnly: num(run.delivery.exactHeadCiOnly),
      commitOnly: num(run.delivery.commitOnly),
      unfinishedCarryover: num(run.delivery.unfinishedCarryover),
    },
  };
}

export function evaluateCompletionTruth(run) {
  const hardFailures = [];
  const gradingGaps = [];
  const truth = run.completionTruth;
  const claims = truth?.claims ?? [];
  const evidence = collectDeliveryEvidence(run);

  if (truth?.status === "FAILED") hardFailures.push("completionTruth.status=FAILED");
  for (const claim of claims) {
    const observed = lower(claim.observedState);
    const claimed = lower(claim.claimedState);
    const expected = STRICT_EXPECTED[claim.type];
    if (claim.verification === "CONTRADICTED" || (claim.verification === "VERIFIED" && claimed !== observed)) {
      hardFailures.push(`${claim.type} ${claim.subject} contradicts live evidence`);
    } else if (claim.verification === "VERIFIED" && expected && observed !== expected) {
      hardFailures.push(`${claim.type} ${claim.subject} observed=${observed}; expected=${expected}`);
    } else if (claim.verification === "UNVERIFIED" && FINAL.has(run.status) && claim.type !== "OTHER") {
      gradingGaps.push(`${claim.type} ${claim.subject} is unverified`);
    }

    if (FINAL.has(run.status) && DELIVERY_CLAIM_TYPES.has(claim.type)) {
      const subject = canonicalIssueSubject(claim.subject);
      const evidenceRef = String(claim.evidenceRef ?? "").trim();
      const evidenceSubject = canonicalIssueEvidenceRef(evidenceRef);
      if (!subject) gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} does not identify one canonical Issue`);
      if (claim.verification === "VERIFIED") {
        if (!isUsableReference(evidenceRef)) {
          gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} has no usable evidenceRef`);
        } else if (!evidenceSubject) {
          gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} evidenceRef does not identify one canonical Issue`);
        } else if (subject && evidenceSubject !== subject) {
          hardFailures.push(`${claim.type} ${subject} evidenceRef points to ${evidenceSubject}`);
        }
      }
    }

    if (FINAL.has(run.status) && PRODUCTION_TRUTH_CLAIM_TYPES.has(claim.type)) {
      const subject = canonicalIssueSubject(claim.subject);
      if (!subject) gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} does not identify one canonical Issue`);
      if (claim.verification === "VERIFIED" && !isUsableReference(claim.evidenceRef)) {
        gradingGaps.push(`${claim.type} ${claim.subject || "<empty>"} has no usable evidenceRef`);
      }
    }
  }

  for (const subject of evidence.overlappingSubjects) {
    hardFailures.push(`${subject} is verified as both ISSUE_CLOSED and OWNER_BLOCKED_COMPLETE`);
  }

  const verified = (type) => claims.filter((claim) => claim.type === type && claim.verification === "VERIFIED");
  if (FINAL.has(run.status)) {
    if (truth?.status !== "VERIFIED") gradingGaps.push("completionTruth.status must be VERIFIED");
    if (!verified("RUN_COMPLETE").length) gradingGaps.push("verified RUN_COMPLETE claim is required");

    if (usesProductionTruth(run)) {
      for (const subject of evidence.closedSubjects) {
        for (const type of PRODUCTION_TRUTH_CLAIM_TYPES) {
          if (!evidence.stageSubjects[type].has(subject)) {
            gradingGaps.push(`${subject} is closed but ${type} is not verified at its successful state`);
          }
        }
      }
      if (evidence.shippedSubjects.size !== num(run.delivery.issuesClosed)) {
        gradingGaps.push(`delivery.issuesClosed=${num(run.delivery.issuesClosed)} does not match ${evidence.shippedSubjects.size} production-accepted shipped subject(s)`);
      }
    } else if (evidence.closedSubjects.size !== num(run.delivery.issuesClosed)) {
      gradingGaps.push(`delivery.issuesClosed=${num(run.delivery.issuesClosed)} does not match ${evidence.closedSubjects.size} unique verified ISSUE_CLOSED subject(s)`);
    }

    if (evidence.ownerBlockedSubjects.size !== num(run.delivery.ownerBlockedComplete)) {
      gradingGaps.push(`delivery.ownerBlockedComplete=${num(run.delivery.ownerBlockedComplete)} does not match ${evidence.ownerBlockedSubjects.size} unique verified OWNER_BLOCKED_COMPLETE subject(s)`);
    }
  }
  return { hardFailures, gradingGaps };
}

export function gradingReadiness(run) {
  if (!FINAL.has(run.status)) return ["run is still in progress"];
  const gaps = [];
  if (!run.endedAt) gaps.push("endedAt is missing");
  if (!run.main.endSha) gaps.push("main.endSha is missing");
  for (const field of ["openIssuesEnd", "openPrsEnd"]) if (run.inventory[field] === null) gaps.push(`inventory.${field} is missing`);
  for (const [group, fields] of Object.entries({
    modelUsage: ["weightedUsageImprovementPercent"],
    ci: ["firstPassRatePercent"],
    quality: ["acceptanceEvidenceCoveragePercent", "auditFirstPassRatePercent"],
    flow: ["lunaDelegationRatePercent", "waitTimeConvertedPercent"],
    auditability: ["evidenceFieldsCompletePercent", "exactHeadTestCoveragePercent", "preciseBlockersPercent", "scoreInputsCompletePercent"],
  })) {
    for (const field of fields) if (run[group][field] === null) gaps.push(`${group}.${field} is missing`);
  }
  return gaps;
}

function scores(run, outcome) {
  const improvement = Math.max(-100, Math.min(100, run.modelUsage.weightedUsageImprovementPercent));
  const solPerIssue = num(run.flow.solIssues) > 0 ? num(run.flow.solTouches) / num(run.flow.solIssues) : 0;
  const usageScore = Math.max(0, Math.min(10, 5 + improvement / 4))
    + linear(run.flow.lunaDelegationRatePercent, 0, 70, 5)
    + inverse(solPerIssue, 2, 5, 4)
    + inverse(num(run.modelUsage.fullContextReplays), 0, 3, 3)
    + inverse(num(run.ci.invalidReruns) + num(run.modelUsage.duplicateScans), 0, 3, 3);

  const started = num(run.delivery.issuesStarted);
  const evidence = collectDeliveryEvidence(run);
  const completed = outcome.shippedUnits + evidence.ownerBlockedOnlySubjects.size;
  const completionScore = (started > 0 ? Math.min(1, completed / started) * 12 : 0)
    + inverse(outcome.wipInventory.unfinishedCarryover, 0, 5, 5)
    + (num(run.inventory.closureSweeps) > 0 ? Math.min(3, 1 + num(run.inventory.closureAdvancedOrClosed) * 2) : 0)
    + (num(run.inventory.sharedTestPeak) <= 1 && num(run.ci.sharedTestCollisions) === 0 ? 2 : 0)
    + (num(run.inventory.activeCandidatePeak) <= 2 ? 3 : 0);

  const qualityScore = 8 * run.quality.acceptanceEvidenceCoveragePercent / 100
    + 6 * run.ci.firstPassRatePercent / 100
    + 5 * run.quality.auditFirstPassRatePercent / 100
    + Math.max(0, 5 - num(run.quality.unresolvedP0) * 2.5 - num(run.quality.unresolvedP1) * 0.5)
    + inverse(num(run.quality.reopenedIssues) + num(run.quality.postMergeRegressions), 0, 3, 3)
    + (num(run.quality.safetyViolations) === 0 && !run.quality.hardFailReasons.length ? 3 : 0);

  const lunaRate = num(run.flow.lunaTasks) > 0 ? num(run.flow.lunaAccepted) / num(run.flow.lunaTasks) * 100 : 0;
  const flowScore = 4 * Math.min(100, lunaRate) / 100
    + inverse(num(run.flow.duplicateAgentTasks), 0, 2, 2)
    + inverse(num(run.flow.ownershipCollisions), 0, 2, 2)
    + 2 * run.flow.waitTimeConvertedPercent / 100;
  const auditScore = 3 * run.auditability.evidenceFieldsCompletePercent / 100
    + 2 * run.auditability.exactHeadTestCoveragePercent / 100
    + inverse(num(run.auditability.stalePendingDescriptions), 0, 3, 2)
    + 2 * run.auditability.preciseBlockersPercent / 100
    + run.auditability.scoreInputsCompletePercent / 100;
  return {
    usage: round(usageScore, 1), completion: round(completionScore, 1), quality: round(qualityScore, 1),
    flow: round(flowScore, 1), auditability: round(auditScore, 1), solTouchesPerIssue: round(solPerIssue, 2),
  };
}

function grade(total) {
  if (total >= 90) return "A";
  if (total >= 80) return "B";
  if (total >= 70) return "C";
  if (total >= 60) return "D";
  return "F";
}

export function scoreRunV2(run) {
  const validation = validateRunLedgerV2(run);
  if (validation.length) throw new Error(`Invalid v2 ledger:\n${validation.map((item) => `- ${item}`).join("\n")}`);
  const usage = computeWeightedUsage(run);
  const outcome = computeDeliveryOutcome(run);
  const truth = evaluateCompletionTruth(run);
  const hardFailures = [...truth.hardFailures, ...run.quality.hardFailReasons];
  if (num(run.quality.safetyViolations) > 0) hardFailures.push("quality.safetyViolations > 0");

  if (hardFailures.length) return {
    runId: run.runId, scoreStatus: "HARD_FAIL", grade: "F-HARD", total: 0, comparisonEligible: false,
    ...outcome, weightedUsageUnits: usage.weightedUsageUnits, weightedUsagePerShippedUnit: null,
    weightedUsagePerAutonomousOutcome: null, gradingGaps: [], hardFailures: [...new Set(hardFailures)], scores: null,
  };

  const gradingGaps = [...gradingReadiness(run), ...truth.gradingGaps];
  if (gradingGaps.length) return {
    runId: run.runId, scoreStatus: "NOT_GRADED", grade: "NOT_GRADED", total: null, comparisonEligible: false,
    ...outcome, weightedUsageUnits: usage.weightedUsageUnits, weightedUsagePerShippedUnit: null,
    weightedUsagePerAutonomousOutcome: null, gradingGaps: [...new Set(gradingGaps)], hardFailures: [], scores: null,
  };

  const dimensions = scores(run, outcome);
  const total = round(dimensions.usage + dimensions.completion + dimensions.quality + dimensions.flow + dimensions.auditability, 1);
  return {
    runId: run.runId, scoreStatus: "GRADED_V2", grade: grade(total), total, comparisonEligible: true,
    ...outcome, weightedUsageUnits: usage.weightedUsageUnits,
    weightedUsagePerShippedUnit: outcome.shippedUnits >= 1 ? round(usage.weightedUsageUnits / outcome.shippedUnits) : null,
    weightedUsagePerAutonomousOutcome: outcome.autonomousOutcomeUnits >= 1 ? round(usage.weightedUsageUnits / outcome.autonomousOutcomeUnits) : null,
    gradingGaps: [], hardFailures: [], scores: dimensions,
  };
}

const show = (value) => value === null || value === undefined ? "資料不足" : String(value);

function renderResultDetails(lines, result) {
  if (result.gradingGaps.length) lines.push("## 為什麼尚不評分", "", ...result.gradingGaps.map((item) => `- ${item}`), "");
  if (result.hardFailures.length) lines.push("## 硬性失敗", "", ...result.hardFailures.map((item) => `- ${item}`), "");
  if (result.scores) lines.push(
    "## 五面向", "", "| 面向 | 分數 |", "|---|---:|",
    `| usage 效率 | ${result.scores.usage} / 25 |`,
    `| 完成效率 | ${result.scores.completion} / 25 |`,
    `| 品質安全 | ${result.scores.quality} / 30 |`,
    `| Agent 流動 | ${result.scores.flow} / 10 |`,
    `| 證據完整 | ${result.scores.auditability} / 10 |`, "",
  );
}

export function renderMarkdownV2(run, result) {
  const legacy = !usesProductionTruth(run);
  const lines = [
    `# Delivery Outcome v2：${run.runId}`, "",
  ];

  if (!legacy) lines.push(`> Delivery Truth 版本：**${run.deliveryTruthVersion}**`);
  lines.push(
    `> 評分狀態：**${result.scoreStatus}**`,
    `> 分數：${result.total === null ? "尚不評分" : `**${result.total} / 100（${result.grade}）**`}`, "",
    "## 兩本帳", "",
  );

  if (legacy) {
    lines.push(
      `- 真正出貨 shipped_units：${result.shippedUnits}（只算不重複、live-verified 的 CLOSED Issue）`,
      `- 自主完成 autonomous_outcome_units：${result.autonomousOutcomeUnits}（唯一 CLOSED + 唯一完整 OWNER_BLOCKED × 0.75）`,
    );
  } else {
    lines.push(
      `- 真正出貨 shipped_units：${result.shippedUnits}（v3 只算已關閉且完成五階段正式環境驗收的 Delivery Slice）`,
      `- 正式環境待驗 production_pending：${result.productionPendingUnits}`,
      `- 自主完成 autonomous_outcome_units：${result.autonomousOutcomeUnits}（正式出貨 + 唯一完整 OWNER_BLOCKED × 0.75）`,
    );
  }

  lines.push(
    `- 在製品 WIP：Audit Ready ${result.wipInventory.auditReady}、CI-only ${result.wipInventory.exactHeadCiOnly}、commit-only ${result.wipInventory.commitOnly}、carryover ${result.wipInventory.unfinishedCarryover}`,
    `- 內部加權 usage：${result.weightedUsageUnits}（不是官方 token）`,
    `- 每件真正出貨 usage：${show(result.weightedUsagePerShippedUnit)}`,
    `- 每單位自主完成 usage：${show(result.weightedUsagePerAutonomousOutcome)}`, "",
  );

  renderResultDetails(lines, result);
  lines.push(
    "---", "",
    legacy
      ? "同一張 Issue 重複 claim 只算一次；總體 Completion Truth 未 VERIFIED 時不顯示成品；跨 repo 或其他無效 Issue 證據不計分，證據指向本 repo 的另一張 Issue，或同時宣稱 CLOSED 與 OWNER_BLOCKED，會硬性失敗。Audit Ready、CI 綠與 commit 是進度，不再折算成品。IN_PROGRESS 不評分。"
      : "同一張 Issue 重複 claim 只算一次。Delivery Truth v3 必須依序驗證 source、main、Vercel、Production schema 與登入正式站後的真實操作；只合併、只部署 App、只套 TEST migration 或只看到成功提示，都不能冒充正式出貨。舊 v2.2 完成輪次維持原計分語意，不回寫歷史。",
    "",
  );
  return lines.join("\n");
}

function cli() {
  const input = process.argv[2];
  if (!input) throw new Error("Usage: score-run-v2.mjs <ledger.json> [--output report.md]");
  const run = JSON.parse(fs.readFileSync(input, "utf8"));
  const result = scoreRunV2(run);
  const markdown = renderMarkdownV2(run, result);
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
  try { cli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
