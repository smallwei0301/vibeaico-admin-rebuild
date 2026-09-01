#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { validateRunLedger } from "./run-ledger.mjs";

function number(value, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function percent(value, neutral = 50) {
  return Math.max(0, Math.min(100, number(value, neutral)));
}
function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function linear(value, low, high, maxPoints) {
  if (value <= low) return 0;
  if (value >= high) return maxPoints;
  return maxPoints * ((value - low) / (high - low));
}
function inverse(value, best, worst, maxPoints) {
  if (value <= best) return maxPoints;
  if (value >= worst) return 0;
  return maxPoints * (1 - ((value - best) / (worst - best)));
}

export function computeWeightedUsage(run) {
  const weights = run.modelUsage.weights;
  const context = run.modelUsage.contextMultipliers;
  let units = 0;
  let actualTokens = 0;
  let actualComplete = run.modelUsage.actualTokensAvailable;

  for (const task of run.modelUsage.tasks) {
    const attributedModel = task.actualModel && task.actualModel !== "unknown" ? task.actualModel : task.requestedModel;
    const modelWeight = weights[attributedModel] ?? weights.terra;
    const contextWeight = context[task.contextClass] ?? context.full;
    units += number(task.count) * modelWeight * contextWeight;
    if (task.inputTokens === null || task.outputTokens === null) actualComplete = false;
    else actualTokens += number(task.inputTokens) + number(task.outputTokens) + number(task.cachedTokens);
  }

  const unverifiedModelTasks = run.modelUsage.tasks
    .filter((task) => !task.actualModel || task.actualModel === "unknown")
    .reduce((sum, task) => sum + number(task.count), 0);
  return { weightedUsageUnits: round(units, 2), actualTokens: actualComplete ? actualTokens : null, unverifiedModelTasks };
}

export function computeDeliveryUnits(run) {
  return round(
    number(run.delivery.issuesClosed) +
    number(run.delivery.auditReady) * 0.8 +
    number(run.delivery.ownerBlockedComplete) * 0.5 +
    number(run.delivery.exactHeadCiOnly) * 0.25 +
    number(run.delivery.commitOnly) * 0.1,
    2,
  );
}

function scoreUsage(run, weightedUsage, deliveryUnits) {
  const improvement = run.modelUsage.weightedUsageImprovementPercent;
  const improvementPoints = improvement === null ? 5 : Math.max(0, Math.min(10, 5 + (improvement / 4)));
  const lunaDelegation = linear(percent(run.flow.lunaDelegationRatePercent), 0, 70, 5);
  const solAverage = number(run.flow.solIssues) > 0 ? number(run.flow.solTouches) / number(run.flow.solIssues) : 0;
  const solPoints = inverse(solAverage, 2, 5, 4);
  const replayPoints = inverse(number(run.modelUsage.fullContextReplays), 0, 3, 3);
  const waste = number(run.ci.invalidReruns) + number(run.modelUsage.duplicateScans);
  const wastePoints = inverse(waste, 0, 3, 3);
  return {
    total: round(improvementPoints + lunaDelegation + solPoints + replayPoints + wastePoints),
    max: 25,
    weightedUsage,
    deliveryUnits,
    weightedUsagePerDeliveryUnit: deliveryUnits > 0 ? round(weightedUsage / deliveryUnits, 2) : null,
    actualTokensAvailable: run.modelUsage.actualTokensAvailable,
    solTouchesPerIssue: round(solAverage, 2),
    parts: { improvement: round(improvementPoints), lunaDelegation: round(lunaDelegation), solTouches: round(solPoints), contextReplay: round(replayPoints), invalidWork: round(wastePoints) },
  };
}

function scoreCompletion(run) {
  const started = number(run.delivery.issuesStarted);
  const finished = number(run.delivery.issuesClosed) + number(run.delivery.auditReady) + number(run.delivery.ownerBlockedComplete);
  const finishedRatio = started > 0 ? Math.min(1, finished / started) : 0;
  const finishedPoints = 10 * finishedRatio;
  const carryoverPoints = inverse(number(run.delivery.unfinishedCarryover), 0, 5, 5);
  const wipHealthy = number(run.inventory.mainTerraPeak) <= 1 && number(run.inventory.reserveTerraPeak) <= 1 && number(run.inventory.activeCandidatePeak) <= 2;
  const wipPoints = wipHealthy ? 4 : 0;
  const closurePoints = number(run.inventory.closureSweeps) > 0 ? Math.min(3, 1 + number(run.inventory.closureAdvancedOrClosed) * 2) : 0;
  const testPoints = number(run.inventory.sharedTestPeak) <= 1 && number(run.ci.sharedTestCollisions) === 0 ? 3 : 0;
  return {
    total: round(finishedPoints + carryoverPoints + wipPoints + closurePoints + testPoints),
    max: 25,
    finishedRatioPercent: round(finishedRatio * 100),
    parts: { finished: round(finishedPoints), carryover: round(carryoverPoints), wip: round(wipPoints), closure: round(closurePoints), sharedTest: round(testPoints) },
  };
}

function scoreQuality(run) {
  const acceptance = 8 * (percent(run.quality.acceptanceEvidenceCoveragePercent) / 100);
  const firstCi = 6 * (percent(run.ci.firstPassRatePercent) / 100);
  const audit = 5 * (percent(run.quality.auditFirstPassRatePercent) / 100);
  const findingPoints = Math.max(0, 5 - (number(run.quality.unresolvedP0) * 2.5) - (number(run.quality.unresolvedP1) * 0.5));
  const regressionCount = number(run.quality.reopenedIssues) + number(run.quality.postMergeRegressions);
  const regressionPoints = inverse(regressionCount, 0, 3, 3);
  const safetyPoints = number(run.quality.safetyViolations) === 0 && run.quality.hardFailReasons.length === 0 ? 3 : 0;
  return {
    total: round(acceptance + firstCi + audit + findingPoints + regressionPoints + safetyPoints),
    max: 30,
    parts: { acceptance: round(acceptance), firstCi: round(firstCi), audit: round(audit), findings: round(findingPoints), regressions: round(regressionPoints), safety: round(safetyPoints) },
  };
}

function scoreFlow(run) {
  const lunaAdoption = number(run.flow.lunaTasks) > 0 ? (number(run.flow.lunaAccepted) / number(run.flow.lunaTasks)) * 100 : 0;
  const adoptionPoints = 4 * (Math.min(100, lunaAdoption) / 100);
  const duplicatePoints = inverse(number(run.flow.duplicateAgentTasks), 0, 2, 2);
  const collisionPoints = inverse(number(run.flow.ownershipCollisions), 0, 2, 2);
  const waitPoints = 2 * (percent(run.flow.waitTimeConvertedPercent) / 100);
  return {
    total: round(adoptionPoints + duplicatePoints + collisionPoints + waitPoints),
    max: 10,
    lunaAdoptionRatePercent: round(lunaAdoption),
    parts: { lunaAdoption: round(adoptionPoints), duplicateTasks: round(duplicatePoints), ownership: round(collisionPoints), waitConversion: round(waitPoints) },
  };
}

function scoreAuditability(run) {
  const evidence = 3 * (percent(run.auditability.evidenceFieldsCompletePercent) / 100);
  const exactHead = 2 * (percent(run.auditability.exactHeadTestCoveragePercent) / 100);
  const stale = inverse(number(run.auditability.stalePendingDescriptions), 0, 3, 2);
  const blockers = 2 * (percent(run.auditability.preciseBlockersPercent) / 100);
  const inputs = percent(run.auditability.scoreInputsCompletePercent) / 100;
  return {
    total: round(evidence + exactHead + stale + blockers + inputs),
    max: 10,
    parts: { evidence: round(evidence), exactHead: round(exactHead), staleDescriptions: round(stale), blockers: round(blockers), inputs: round(inputs) },
  };
}

function grade(total) {
  if (total >= 90) return "A";
  if (total >= 80) return "B";
  if (total >= 70) return "C";
  if (total >= 60) return "D";
  return "F";
}

function recommendations(run, scores) {
  const items = [];
  if (number(run.inventory.mainTerraPeak) > 1) items.push("把完整 Terra 出貨線降到 1；其餘只保留一條 source-only 預備線，其他 PR 先 PARKED。");
  if (number(run.inventory.activeCandidatePeak) > 2) items.push("Active Candidate 峰值超過 2；下一輪只保留 MAIN 與 Closure 候選。");
  if (scores.flow.lunaAdoptionRatePercent < 80 && number(run.flow.lunaTasks) > 0) items.push("Luna 採用率不足 80%；縮小每個任務到單一問題，並由一位 Luna Aggregator 去重後再交 Sol。");
  if (number(run.delivery.issuesClosed) + number(run.delivery.ownerBlockedComplete) === 0) items.push("本輪沒有 CLOSED 或完整 OWNER_BLOCKED；下一輪進入 Closure Recovery，不再開新的中大型 Issue。");
  if (scores.quality.total < 24) items.push("品質分低於 24/30；暫停預備 Terra 改 code，主線先補 targeted tests 與驗收證據。");
  if (!run.modelUsage.actualTokensAvailable) items.push("平台實際 token 不可見；下輪至少記錄週 usage 起訖百分比，並繼續把內部權重標成估算值。");
  if (!items.length) items.push("維持目前 B+ 上限，下一輪只調整最弱的一個分項，不擴大規則面積。");
  return items.slice(0, 2);
}

export function scoreRun(run) {
  const errors = validateRunLedger(run);
  if (errors.length) throw new Error(`Invalid run ledger:\n${errors.map((item) => `- ${item}`).join("\n")}`);
  const usage = computeWeightedUsage(run);
  const deliveryUnits = computeDeliveryUnits(run);
  const scores = {
    usage: scoreUsage(run, usage.weightedUsageUnits, deliveryUnits),
    completion: scoreCompletion(run),
    quality: scoreQuality(run),
    flow: scoreFlow(run),
    auditability: scoreAuditability(run),
  };
  const total = round(Object.values(scores).reduce((sum, item) => sum + item.total, 0));
  const qualified = number(run.quality.safetyViolations) === 0 && run.quality.hardFailReasons.length === 0;
  return {
    runId: run.runId, status: run.status, total, grade: qualified ? grade(total) : "F-HARD", qualified,
    scores, actualTokens: usage.actualTokens, weightedUsageUnits: usage.weightedUsageUnits,
    unverifiedModelTasks: usage.unverifiedModelTasks, deliveryUnits,
    weightedUsagePerDeliveryUnit: deliveryUnits > 0 ? round(usage.weightedUsageUnits / deliveryUnits, 2) : null,
    recommendations: recommendations(run, scores),
  };
}

function display(value, suffix = "") {
  return value === null || value === undefined ? "資料不足" : `${value}${suffix}`;
}

export function renderMarkdown(run, result) {
  const weeklyDelta = run.modelUsage.weeklyUsageStartPercent !== null && run.modelUsage.weeklyUsageEndPercent !== null
    ? round(run.modelUsage.weeklyUsageEndPercent - run.modelUsage.weeklyUsageStartPercent, 2) : null;
  const lines = [
    `# B+ Agent Run 報告：${run.runId}`, "",
    `> 狀態：${run.status}`, `> 總分：**${result.total} / 100（${result.grade}）**`,
    `> 合格：${result.qualified ? "是" : "否，發生硬性安全失敗"}`, "",
    "## 一眼看懂", "",
    `- main：\`${run.main.startSha ?? "unknown"}\` → \`${run.main.endSha ?? "unknown"}\``,
    `- Open Issue：${display(run.inventory.openIssuesStart)} → ${display(run.inventory.openIssuesEnd)}`,
    `- Open PR：${display(run.inventory.openPrsStart)} → ${display(run.inventory.openPrsEnd)}`,
    `- 出貨單位：${result.deliveryUnits}`,
    `- 內部加權 usage：${result.weightedUsageUnits}（Luna／Terra／Sol 權重，非官方 token）`,
    `- 每出貨單位加權 usage：${display(result.weightedUsagePerDeliveryUnit)}`,
    `- 實際 token：${run.modelUsage.actualTokensAvailable ? display(result.actualTokens) : "平台未提供，不推測"}`,
    `- 模型歸屬未驗證任務：${result.unverifiedModelTasks}（actual=unknown 時以 requested model 做內部估算）`,
    `- 週 usage 變化：${weeklyDelta === null ? "資料不足" : `${weeklyDelta >= 0 ? "+" : ""}${weeklyDelta}%`}`, "",
    "## 五面向分數", "", "| 面向 | 分數 |", "|---|---:|",
    `| 模型與 usage 效率 | ${result.scores.usage.total} / 25 |`,
    `| 專案完成效率 | ${result.scores.completion.total} / 25 |`,
    `| 品質與安全 | ${result.scores.quality.total} / 30 |`,
    `| 多 Agent 流動效率 | ${result.scores.flow.total} / 10 |`,
    `| 可稽核證據 | ${result.scores.auditability.total} / 10 |`, "",
    "## B+ lane 證據", "",
    `- MAIN_TERRA 峰值：${display(run.inventory.mainTerraPeak)}（目標 1）`,
    `- RESERVE_TERRA 峰值：${display(run.inventory.reserveTerraPeak)}（目標 ≤1）`,
    `- Active Candidate 峰值：${display(run.inventory.activeCandidatePeak)}（目標 ≤2）`,
    `- Shared TEST 峰值：${display(run.inventory.sharedTestPeak)}（目標 ≤1）`,
    `- Closure Sweep：${display(run.inventory.closureSweeps)} 次，推進／關閉 ${display(run.inventory.closureAdvancedOrClosed)} 次`, "",
    "## 出貨與品質", "",
    `- Issues started：${display(run.delivery.issuesStarted)}`,
    `- Issues closed：${display(run.delivery.issuesClosed)}`,
    `- Audit ready：${display(run.delivery.auditReady)}`,
    `- 完整 Owner-blocked：${display(run.delivery.ownerBlockedComplete)}`,
    `- Carryover：${display(run.delivery.unfinishedCarryover)}`,
    `- Full CI：${display(run.ci.fullCiRuns)}；無效重跑：${display(run.ci.invalidReruns)}`,
    `- 未解 P0/P1：${display(run.quality.unresolvedP0)} / ${display(run.quality.unresolvedP1)}`,
    `- Luna 採用率：${display(result.scores.flow.lunaAdoptionRatePercent, "%")}`,
    `- Sol 每 Issue 接觸：${display(result.scores.usage.solTouchesPerIssue)}`, "",
    "## 下一輪只調整這些", "",
    ...result.recommendations.map((item, index) => `${index + 1}. ${item}`), "",
    "## 資料限制", "",
    ...(run.notes.length ? run.notes.map((item) => `- ${item}`) : ["- 無。"]), "", "---", "",
    "本報告由 `scripts/agents/score-run.mjs` 從同名 JSON 重算。內部模型權重只用於輪次比較，不是 OpenAI 官方額度換算。", "",
  ];
  return lines.join("\n");
}

function parseArgs(argv) {
  const args = { positional: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      const key = value.slice(2); const next = argv[index + 1];
      if (next && !next.startsWith("--")) { args[key] = next; index += 1; } else args[key] = true;
    } else args.positional.push(value);
  }
  return args;
}

export function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv); const input = args.positional[0];
  if (!input) throw new Error("Usage: score-run.mjs <ledger.json> [--output report.md] [--check report.md]");
  const run = JSON.parse(fs.readFileSync(input, "utf8"));
  const result = scoreRun(run); const markdown = renderMarkdown(run, result);
  if (args.check) {
    if (fs.readFileSync(args.check, "utf8") !== markdown) throw new Error(`scorecard drift: ${args.check} is not reproducible from ${input}`);
    console.log(`MATCH ${args.check}`); return;
  }
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, markdown, "utf8"); console.log(args.output); return;
  }
  process.stdout.write(markdown);
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntry) {
  try { runCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
