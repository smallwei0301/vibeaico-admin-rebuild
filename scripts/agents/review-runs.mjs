#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { scoreRun } from "./score-run.mjs";

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round((Number(value) + Number.EPSILON) * factor) / factor;
}

function readRuns(directory) {
  if (!fs.existsSync(directory)) return [];
  return fs.readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => {
      const file = path.join(directory, name);
      const run = JSON.parse(fs.readFileSync(file, "utf8"));
      return { file, run, score: scoreRun(run) };
    })
    .sort((a, b) => String(a.run.startedAt).localeCompare(String(b.run.startedAt)) || path.basename(a.file).localeCompare(path.basename(b.file)));
}

function change(current, previous) {
  if (current === null || current === undefined || previous === null || previous === undefined) return null;
  return round(Number(current) - Number(previous));
}

export function reviewRuns(runs, limit = 3) {
  const selected = runs.slice(-Math.max(1, limit));
  const latest = selected.at(-1) ?? null;
  const previous = selected.length > 1 ? selected.at(-2) : null;
  const trends = latest && previous ? {
    score: change(latest.score.total, previous.score.total),
    weightedUsagePerDeliveryUnit: change(latest.score.weightedUsagePerDeliveryUnit, previous.score.weightedUsagePerDeliveryUnit),
    issuesClosed: change(latest.run.delivery.issuesClosed, previous.run.delivery.issuesClosed),
    completeExits: change(
      Number(latest.run.delivery.issuesClosed) + Number(latest.run.delivery.ownerBlockedComplete),
      Number(previous.run.delivery.issuesClosed) + Number(previous.run.delivery.ownerBlockedComplete),
    ),
    quality: change(latest.score.scores.quality.total, previous.score.scores.quality.total),
    lunaAdoption: change(latest.score.scores.flow.lunaAdoptionRatePercent, previous.score.scores.flow.lunaAdoptionRatePercent),
    solTouchesPerIssue: change(latest.score.scores.usage.solTouchesPerIssue, previous.score.scores.usage.solTouchesPerIssue),
    carryover: change(latest.run.delivery.unfinishedCarryover, previous.run.delivery.unfinishedCarryover),
  } : null;
  return { selected, latest, previous, trends, recommendations: latest?.score.recommendations ?? [] };
}

function value(input) { return input === null || input === undefined ? "資料不足" : String(input); }
function signed(input) { return input === null || input === undefined ? "資料不足" : `${input > 0 ? "+" : ""}${input}`; }

export function renderReview(result) {
  if (!result.latest) return "# B+ Loop 復盤\n\n沒有可驗證的 run ledger。\n";
  const lines = [
    "# B+ Loop 復盤", "", `> 最新輪次：${result.latest.run.runId}`, `> 比較輪數：${result.selected.length}`, "",
    "## 最近輪次", "",
    "| Run | 分數 | 每出貨單位 usage | CLOSED | 完整 Owner-blocked | Carryover | 品質 | Luna 採用率 | Sol/Issue |",
    "|---|---:|---:|---:|---:|---:|---:|---:|---:|",
    ...result.selected.map(({ run, score }) => `| ${run.runId} | ${score.total} (${score.grade}) | ${value(score.weightedUsagePerDeliveryUnit)} | ${run.delivery.issuesClosed} | ${run.delivery.ownerBlockedComplete} | ${run.delivery.unfinishedCarryover} | ${score.scores.quality.total}/30 | ${score.scores.flow.lunaAdoptionRatePercent}% | ${score.scores.usage.solTouchesPerIssue} |`),
    "", "## 與上一輪相比", "",
  ];
  if (!result.trends) lines.push("- 報告不足兩輪，先保留基準，不判定趨勢。");
  else lines.push(
    `- 總分：${signed(result.trends.score)}`,
    `- 每出貨單位加權 usage：${signed(result.trends.weightedUsagePerDeliveryUnit)}（負數較好）`,
    `- CLOSED：${signed(result.trends.issuesClosed)}`,
    `- CLOSED + 完整 Owner-blocked：${signed(result.trends.completeExits)}`,
    `- 品質分：${signed(result.trends.quality)}`,
    `- Luna 採用率：${signed(result.trends.lunaAdoption)}%`,
    `- Sol 每 Issue 接觸：${signed(result.trends.solTouchesPerIssue)}（負數較好）`,
    `- Carryover：${signed(result.trends.carryover)}（負數較好）`,
  );
  lines.push(
    "", "## 下一輪只調整這些", "",
    ...result.recommendations.slice(0, 2).map((item, index) => `${index + 1}. ${item}`),
    "", "## 誠實限制", "",
    `- 實際 token：${result.latest.run.modelUsage.actualTokensAvailable ? "有記錄" : "平台未提供；內部權重只供輪次比較"}`,
    `- 未驗證模型任務：${result.latest.score.unverifiedModelTasks}`,
    "- 復盤不會改寫歷史弱分數；資料錯誤時先修 ledger，不美化報告。", "",
  );
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
  const args = parseArgs(argv);
  const directory = args.positional[0] ?? "docs/metrics/agent-runs";
  const limit = Number(args.limit ?? 3);
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new Error("--limit must be 1..20");
  const output = renderReview(reviewRuns(readRuns(directory), limit));
  if (args.output) {
    fs.mkdirSync(path.dirname(args.output), { recursive: true });
    fs.writeFileSync(args.output, output, "utf8"); console.log(args.output);
  } else process.stdout.write(output);
}

const isEntry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isEntry) {
  try { runCli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
