#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { computeReport } from './score-run.mjs';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ratio(numerator, denominator) {
  if (denominator <= 0) return null;
  return Math.max(0, Math.min(1, numerator / denominator));
}

function percent(value) {
  if (value === null || value === undefined) return 'N/A';
  return `${(value * 100).toFixed(1)}%`;
}

function valueOrNa(value) {
  return value === null || value === undefined ? 'N/A' : String(value);
}

function grade(total, hardFailed) {
  if (hardFailed) return 'F-HARD';
  if (total >= 90) return 'A';
  if (total >= 80) return 'B';
  if (total >= 70) return 'C';
  if (total >= 60) return 'D';
  return 'F';
}

export function validateDualTerraRun(run = {}) {
  const errors = [];
  const inventory = run.inventory ?? {};
  if (inventory.dualTerraPilot !== true) errors.push('inventory.dualTerraPilot must be true');
  if (number(inventory.terraTarget) !== 2) errors.push('inventory.terraTarget must be 2');
  for (const field of [
    'slot1ActiveMinutes',
    'slot2ActiveMinutes',
    'localIsolatedJobs',
    'localIsolatedSuccess',
    'localIsolatedFailure',
    'localCleanupSuccess',
    'remoteCanonicalWaitMinutes',
    'crossLaneContamination',
  ]) {
    if (inventory[field] === null || inventory[field] === undefined) errors.push(`inventory.${field} is required`);
  }
  return errors;
}

export function scoreDualTerraCompletion(run = {}) {
  let score = 0;
  const delivery = run.delivery ?? {};
  const inventory = run.inventory ?? {};
  const issuesStarted = number(delivery.issuesStarted);
  const issuesClosed = number(delivery.issuesClosed);
  const completeOwnerBlocked = number(delivery.completeOwnerBlocked);
  const auditReady = number(delivery.auditReady);
  const carryover = number(delivery.unfinishedCarryover);
  const completed = issuesClosed + completeOwnerBlocked;
  const completionRatio = ratio(completed, issuesStarted);

  if (completionRatio === null) score += completed > 0 ? 8 : 0;
  else if (completionRatio >= 0.8) score += 10;
  else if (completionRatio >= 0.5) score += 7;
  else if (completionRatio > 0) score += 4;

  if (carryover === 0) score += 5;
  else if (carryover === 1) score += 3;
  else if (carryover === 2) score += 1;

  if (number(inventory.activeCandidatePeak) <= 2) score += 4;
  else if (number(inventory.activeCandidatePeak) === 3) score += 1;

  if (inventory.closureSweepExecuted === true) score += 2;
  if (number(inventory.closureOutcomes) > 0) score += 1;

  const withinLimits =
    number(inventory.mainTerraPeak) >= 1 &&
    number(inventory.mainTerraPeak) <= 2 &&
    number(inventory.reserveTerraPeak) === 0 &&
    number(inventory.closurePeak) <= 1 &&
    number(inventory.testValidationPeak) <= 1 &&
    number(inventory.activeCandidatePeak) <= 2;
  const usedBothSlots = number(inventory.mainTerraPeak) === 2;
  if (withinLimits) score += 1;
  if (withinLimits && usedBothSlots) score += 1;
  if (completed + auditReady > 0) score += 2;

  return {
    score: Math.min(25, score), max: 25, issuesStarted, issuesClosed,
    completeOwnerBlocked, auditReady, carryover, completionRatio,
    withinLimits, usedBothSlots,
  };
}

export function computeDualTerraReport(run = {}) {
  const validationErrors = validateDualTerraRun(run);
  const base = computeReport(run);
  const completion = scoreDualTerraCompletion(run);
  const inventory = run.inventory ?? {};
  const jobs = number(inventory.localIsolatedJobs);
  const localSuccess = number(inventory.localIsolatedSuccess);
  const localFailure = number(inventory.localIsolatedFailure);
  const cleanupSuccess = number(inventory.localCleanupSuccess);
  const contamination = number(inventory.crossLaneContamination);
  const ownershipCollisions = number(run.flow?.ownershipCollisions);

  const isolatedHealthy = jobs >= 2 && localSuccess === jobs && localFailure === 0 && cleanupSuccess === jobs;
  const serialGatesHealthy = number(inventory.testValidationPeak) <= 1 && number(inventory.activeCandidatePeak) <= 2;
  const fallbackRequired =
    validationErrors.length > 0 || contamination > 0 || ownershipCollisions > 0 ||
    !isolatedHealthy || !serialGatesHealthy || base.quality.score < 24 ||
    number(base.quality.postMergeRegressions) > 0;
  const qualifiedSample = !fallbackRequired && completion.usedBothSlots && completion.withinLimits;

  const hardFailReasons = [...base.hardFailReasons];
  if (contamination > 0) hardFailReasons.push('cross-lane contamination detected');
  const hardFailed = base.hardFailed || contamination > 0;
  const rawTotal = base.usageSection.score + completion.score + base.quality.score + base.flow.score + base.evidence.score;
  const total = hardFailed ? Math.min(rawTotal, 59) : rawTotal;

  const recommendations = [];
  if (fallbackRequired) {
    recommendations.push('下一個 Run 退回一條完整 Terra，先修復 local cleanup、ownership、污染、品質或回歸問題。');
  }
  if (!completion.usedBothSlots && !fallbackRequired) {
    recommendations.push('這輪未實際同時使用兩個 Terra slot，不列入三輪雙線樣本；記錄原因後再選安全配對。');
  }
  const baselineCost = number(run.baselines?.weightedUsagePerDeliveryUnit);
  if (
    base.weightedUsagePerDeliveryUnit !== null && baselineCost > 0 &&
    base.weightedUsagePerDeliveryUnit > baselineCost * 1.2 &&
    base.completionMetric <= number(run.baselines?.deliveryUnits)
  ) {
    recommendations.push('usage／Delivery Unit 惡化超過 20% 且出貨未增加，停止第二條 Terra 並縮小 Sol／上下文重讀。');
  }

  return {
    ...base, completion, total, grade: grade(total, hardFailed), hardFailed,
    hardFailReasons, validationErrors, isolatedHealthy, serialGatesHealthy,
    fallbackRequired, qualifiedSample,
    pilotStatus: fallbackRequired ? 'FALLBACK_REQUIRED' : qualifiedSample ? 'QUALIFIED_RUN' : 'INCOMPLETE_SAMPLE',
    recommendations: recommendations.slice(0, 2),
  };
}

function list(items, empty = '無') {
  return items?.length ? items.map((item) => `- ${item}`).join('\n') : `- ${empty}`;
}

export function renderDualTerraMarkdown(run, report) {
  const inventory = run.inventory ?? {};
  return `# Dual Terra Pilot Scorecard — ${report.runId}

- 狀態：${report.status}
- Pilot 判定：${report.pilotStatus}
- 時間：${report.startedAt} → ${report.endedAt ?? 'IN_PROGRESS'}
- main：${report.main.startSha ?? 'unknown'} → ${report.main.endSha ?? 'unknown'}
- Terra target：2
- Reserve target：0
- 模型成本來源：${report.usage.source === 'actual_tokens' ? '實際 token' : '內部加權代理值（不是官方額度換算）'}

## 總分

| 層面 | 分數 |
|---|---:|
| 模型與 usage 效率 | ${report.usageSection.score} / 25 |
| 雙 Terra 完成效率 | ${report.completion.score} / 25 |
| 品質與安全 | ${report.quality.score} / 30 |
| 多 Agent 流動效率 | ${report.flow.score} / 10 |
| 可稽核證據 | ${report.evidence.score} / 10 |
| **總分** | **${report.total} / 100（${report.grade}）** |

## 雙線契約

- Full Terra peak：${inventory.mainTerraPeak ?? 0} / 2
- Reserve peak：${inventory.reserveTerraPeak ?? 0} / 0
- Active candidate peak：${inventory.activeCandidatePeak ?? 0} / 2
- Remote TEST peak：${inventory.testValidationPeak ?? 0} / 1
- Slot 1 active minutes：${valueOrNa(inventory.slot1ActiveMinutes)}
- Slot 2 active minutes：${valueOrNa(inventory.slot2ActiveMinutes)}
- Local jobs / success / failure / cleanup：${valueOrNa(inventory.localIsolatedJobs)} / ${valueOrNa(inventory.localIsolatedSuccess)} / ${valueOrNa(inventory.localIsolatedFailure)} / ${valueOrNa(inventory.localCleanupSuccess)}
- Remote canonical wait minutes：${valueOrNa(inventory.remoteCanonicalWaitMinutes)}
- Ownership collisions：${report.flow.ownershipCollisions}
- Cross-lane contamination：${valueOrNa(inventory.crossLaneContamination)}
- Both slots used：${report.completion.usedBothSlots ? '是' : '否'}
- Local isolation healthy：${report.isolatedHealthy ? '是' : '否'}
- Serial gates healthy：${report.serialGatesHealthy ? '是' : '否'}
- Fallback required：${report.fallbackRequired ? '是' : '否'}

## 出貨與 usage

- Delivery Units：${report.completionMetric.toFixed(2)}
- Weighted usage units：${report.usage.units.toFixed(2)}
- usage / Delivery Unit：${report.weightedUsagePerDeliveryUnit === null ? 'N/A' : report.weightedUsagePerDeliveryUnit.toFixed(2)}
- Issues started / closed：${report.completion.issuesStarted} / ${report.completion.issuesClosed}
- Complete OWNER_BLOCKED / Audit ready：${report.completion.completeOwnerBlocked} / ${report.completion.auditReady}
- Carryover：${report.completion.carryover}
- Completion ratio：${percent(report.completion.completionRatio)}
- Luna routing / adoption：${percent(report.usageSection.lunaRoutingRate)} / ${percent(report.flow.lunaAdoption)}
- Sol touches / candidate：${report.usageSection.solTouchesPerCandidate.toFixed(2)}

## 品質

- 驗收證據：${percent(report.quality.acceptance)}
- CI 首次通過：${percent(report.quality.firstPassCi)}
- Audit 首次通過：${percent(report.quality.firstPassAudit)}
- P0 / P1：${report.quality.unresolvedP0} / ${report.quality.unresolvedP1}
- Reopen / post-merge regression：${report.quality.reopened} / ${report.quality.postMergeRegressions}
- Safety violations：${report.quality.safetyViolations}

## 資料完整性錯誤

${list(report.validationErrors)}

## 硬性失敗

${list(report.hardFailReasons)}

## 下一輪最多兩項調整

${list(report.recommendations, '維持免費雙 Terra 試行，繼續下一個可量化 Run。')}

## 原始資料

- JSON：\`docs/metrics/dual-terra-runs/${basename(run.__filePath ?? `${run.runId}.json`)}\`
- 使用：\`node scripts/agents/score-dual-terra-run.mjs <json> --check <md>\`
`;
}

function cli(argv) {
  const input = argv[2];
  if (!input) {
    console.error('Usage: node scripts/agents/score-dual-terra-run.mjs <run.json> [--output <run.md>] [--check <run.md>]');
    process.exit(1);
  }
  const jsonPath = resolve(input);
  const run = JSON.parse(readFileSync(jsonPath, 'utf8'));
  run.__filePath = jsonPath;
  const report = computeDualTerraReport(run);
  const markdown = renderDualTerraMarkdown(run, report);
  const outputIndex = argv.indexOf('--output');
  const checkIndex = argv.indexOf('--check');

  if (outputIndex !== -1) {
    const output = argv[outputIndex + 1];
    if (!output) throw new Error('--output requires a path');
    writeFileSync(resolve(output), markdown, 'utf8');
  }
  if (checkIndex !== -1) {
    const target = argv[checkIndex + 1];
    if (!target) throw new Error('--check requires a path');
    if (readFileSync(resolve(target), 'utf8') !== markdown) {
      console.error(`Dual Terra scorecard mismatch: ${target}`);
      process.exit(1);
    }
  }
  if (outputIndex === -1 && checkIndex === -1) process.stdout.write(markdown);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) cli(process.argv);
