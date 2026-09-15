#!/usr/bin/env node

import fs from 'node:fs';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { validateRunLedgerV2 } from './run-ledger-v2.mjs';

const LIVE_CAPTURE_INPUTS = Object.freeze([
  'ci.firstPassRatePercent',
  'quality.acceptanceEvidenceCoveragePercent',
  'quality.auditFirstPassRatePercent',
  'flow.lunaDelegationRatePercent',
  'flow.waitTimeConvertedPercent',
  'auditability.evidenceFieldsCompletePercent',
  'auditability.exactHeadTestCoveragePercent',
  'auditability.preciseBlockersPercent',
]);

const CLOSEOUT_DERIVED_INPUTS = Object.freeze([
  'modelUsage.weightedUsageImprovementPercent',
  'auditability.scoreInputsCompletePercent',
]);

const TERMINAL_ONLY_INPUTS = Object.freeze([
  'endedAt',
  'main.endSha',
  'inventory.openIssuesEnd',
  'inventory.openPrsEnd',
  'closeout.state',
  'closeout.closedAt',
  'closeout.evidenceRef',
  'completionTruth.status',
  'completionTruth.checkedAt',
]);

function valueAt(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function isMissing(value) {
  return value === null || value === undefined || value === '';
}

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function deriveLunaDelegationRate(run) {
  const tasks = Number(run?.flow?.lunaTasks ?? 0);
  const accepted = Number(run?.flow?.lunaAccepted ?? 0);
  if (!Number.isFinite(tasks) || tasks <= 0 || !Number.isFinite(accepted)) return null;
  return round(Math.min(100, Math.max(0, (accepted / tasks) * 100)));
}

export function analyzeScorecardReadiness(run) {
  const validationErrors = validateRunLedgerV2(run);
  if (validationErrors.length) {
    return {
      runId: run?.runId ?? null,
      validLedger: false,
      validationErrors,
      liveReadinessPercent: 0,
      liveCaptureMissing: [...LIVE_CAPTURE_INPUTS],
      closeoutDerivedMissing: [...CLOSEOUT_DERIVED_INPUTS],
      terminalOnlyPending: [...TERMINAL_ONLY_INPUTS],
      consistencyWarnings: [],
      readyForCloseoutDataCapture: false,
    };
  }

  const liveCaptureMissing = LIVE_CAPTURE_INPUTS.filter((field) => isMissing(valueAt(run, field)));
  const closeoutDerivedMissing = CLOSEOUT_DERIVED_INPUTS.filter((field) => isMissing(valueAt(run, field)));
  const terminalOnlyPending = TERMINAL_ONLY_INPUTS.filter((field) => {
    const value = valueAt(run, field);
    if (field === 'closeout.state') return value !== 'CLOSED';
    if (field === 'completionTruth.status') return value !== 'VERIFIED';
    return isMissing(value);
  });

  const consistencyWarnings = [];
  const derivedLunaRate = deriveLunaDelegationRate(run);
  const storedLunaRate = run?.flow?.lunaDelegationRatePercent;
  if (derivedLunaRate !== null && storedLunaRate === null) {
    consistencyWarnings.push(`flow.lunaDelegationRatePercent can already be derived as ${derivedLunaRate}% from lunaAccepted/lunaTasks`);
  } else if (derivedLunaRate !== null && typeof storedLunaRate === 'number' && Math.abs(storedLunaRate - derivedLunaRate) > 0.1) {
    consistencyWarnings.push(`flow.lunaDelegationRatePercent=${storedLunaRate} disagrees with counters-derived ${derivedLunaRate}%`);
  }

  const captured = LIVE_CAPTURE_INPUTS.length - liveCaptureMissing.length;
  const liveReadinessPercent = round((captured / LIVE_CAPTURE_INPUTS.length) * 100);
  const expectedScoreInputsCompletePercent = round(
    ((LIVE_CAPTURE_INPUTS.length + CLOSEOUT_DERIVED_INPUTS.length - liveCaptureMissing.length - closeoutDerivedMissing.length)
      / (LIVE_CAPTURE_INPUTS.length + CLOSEOUT_DERIVED_INPUTS.length)) * 100,
  );
  const storedScoreInputs = run?.auditability?.scoreInputsCompletePercent;
  if (typeof storedScoreInputs === 'number' && Math.abs(storedScoreInputs - expectedScoreInputsCompletePercent) > 0.1) {
    consistencyWarnings.push(`auditability.scoreInputsCompletePercent=${storedScoreInputs} disagrees with observable ${expectedScoreInputsCompletePercent}%`);
  }

  return {
    runId: run.runId,
    validLedger: true,
    validationErrors: [],
    liveReadinessPercent,
    expectedScoreInputsCompletePercent,
    liveCaptureMissing,
    closeoutDerivedMissing,
    terminalOnlyPending,
    consistencyWarnings,
    readyForCloseoutDataCapture: liveCaptureMissing.length === 0,
  };
}

export function renderScorecardReadiness(result) {
  const lines = [
    `# Scorecard Live Readiness: ${result.runId ?? 'unknown'}`,
    '',
    `- Ledger valid: ${result.validLedger ? 'YES' : 'NO'}`,
    `- Live capture readiness: ${result.liveReadinessPercent}%`,
    `- Ready for closeout data capture: ${result.readyForCloseoutDataCapture ? 'YES' : 'NO'}`,
  ];

  if (typeof result.expectedScoreInputsCompletePercent === 'number') {
    lines.push(`- Observable score-input completeness: ${result.expectedScoreInputsCompletePercent}%`);
  }

  if (result.validationErrors.length) {
    lines.push('', '## Ledger validation errors', '', ...result.validationErrors.map((item) => `- ${item}`));
  }
  lines.push(
    '',
    '## Live-capture gaps',
    '',
    ...(result.liveCaptureMissing.length ? result.liveCaptureMissing.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Closeout-derived gaps',
    '',
    ...(result.closeoutDerivedMissing.length ? result.closeoutDerivedMissing.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Terminal-only pending fields',
    '',
    ...(result.terminalOnlyPending.length ? result.terminalOnlyPending.map((item) => `- ${item}`) : ['- none']),
  );
  if (result.consistencyWarnings.length) {
    lines.push('', '## Consistency warnings', '', ...result.consistencyWarnings.map((item) => `- ${item}`));
  }
  lines.push(
    '',
    '> Live-capture gaps are the dangerous ones: if they stay missing until closeout, the final Product score remains NOT_GRADED. Terminal-only fields are expected to remain pending while a Run is active.',
    '',
  );
  return lines.join('\n');
}

function cli(argv = process.argv.slice(2)) {
  const file = argv.find((item) => !item.startsWith('--'));
  if (!file) throw new Error('Usage: scorecard-readiness.mjs <ledger.json> [--json] [--strict-live]');
  const run = JSON.parse(fs.readFileSync(file, 'utf8'));
  const result = analyzeScorecardReadiness(run);
  if (argv.includes('--json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  else process.stdout.write(renderScorecardReadiness(result));
  if (argv.includes('--strict-live') && (!result.validLedger || result.liveCaptureMissing.length > 0 || result.consistencyWarnings.length > 0)) {
    process.exitCode = 2;
  }
  return result;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { cli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
