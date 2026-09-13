#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { scoreRunV2 } from "./score-run-v2.mjs";

export function reviewRunsV2(items, limit = 3) {
  const scored = items.map(({ file, run }) => ({ file, run, score: scoreRunV2(run) }));
  const eligible = scored.filter((item) => item.score.comparisonEligible).slice(-Math.max(1, limit));
  const excluded = scored.filter((item) => !item.score.comparisonEligible);
  const latest = eligible.at(-1) ?? null;
  const previous = eligible.length > 1 ? eligible.at(-2) : null;
  const change = (field) => latest && previous ? latest.score[field] - previous.score[field] : null;
  return {
    eligible, excluded, latest, previous,
    trends: latest && previous ? {
      shippedUnits: change("shippedUnits"),
      autonomousOutcomeUnits: change("autonomousOutcomeUnits"),
      usagePerShippedUnit: latest.score.weightedUsagePerShippedUnit !== null && previous.score.weightedUsagePerShippedUnit !== null
        ? latest.score.weightedUsagePerShippedUnit - previous.score.weightedUsagePerShippedUnit : null,
      carryover: latest.score.wipInventory.unfinishedCarryover - previous.score.wipInventory.unfinishedCarryover,
    } : null,
  };
}

const show = (value) => value === null || value === undefined ? "資料不足" : String(Math.round(value * 100) / 100);
export function renderReviewV2(result) {
  const lines = ["# Delivery Outcome v2 復盤", "", `> 可比較完成輪次：${result.eligible.length}`, `> 排除未完成／不合格輪次：${result.excluded.length}`, ""];
  if (!result.eligible.length) lines.push("沒有完成且通過 Completion Truth 的 v2 Run，因此不下效率結論。", "");
  else lines.push(
    "| Run | 分數 | 真正出貨 | 自主完成 | 每件出貨 usage | Carryover |",
    "|---|---:|---:|---:|---:|---:|",
    ...result.eligible.map(({ run, score }) => `| ${run.runId} | ${score.total} (${score.grade}) | ${score.shippedUnits} | ${score.autonomousOutcomeUnits} | ${show(score.weightedUsagePerShippedUnit)} | ${score.wipInventory.unfinishedCarryover} |`),
    "",
  );
  if (result.trends) lines.push(
    "## 與上一個可比較完成輪次相比", "",
    `- 真正出貨：${show(result.trends.shippedUnits)}`,
    `- 自主完成：${show(result.trends.autonomousOutcomeUnits)}`,
    `- 每件出貨 usage：${show(result.trends.usagePerShippedUnit)}（負數較好）`,
    `- Carryover：${show(result.trends.carryover)}（負數較好）`, "",
  );
  if (result.excluded.length) lines.push(
    "## 排除清單", "",
    ...result.excluded.map(({ run, score }) => `- ${run.runId}：${score.scoreStatus}${score.gradingGaps.length ? `，${score.gradingGaps[0]}` : ""}`), "",
  );
  return lines.join("\n");
}

function cli() {
  const directory = process.argv[2] ?? "docs/metrics/agent-runs";
  const files = fs.readdirSync(directory).filter((name) => name.endsWith(".json"));
  const items = files.map((name) => ({ file: name, run: JSON.parse(fs.readFileSync(path.join(directory, name), "utf8")) }))
    .filter(({ run }) => run.schemaVersion === 2)
    .sort((a, b) => String(a.run.startedAt).localeCompare(String(b.run.startedAt)));
  process.stdout.write(renderReviewV2(reviewRunsV2(items)));
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { cli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
