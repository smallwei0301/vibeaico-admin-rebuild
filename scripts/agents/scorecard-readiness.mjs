#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { validateRunLedgerV2 } from './run-ledger-v2.mjs';

const OBSERVED_SCORE_EFFECTIVE_AT = '2026-09-15T00:00:00Z';
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

const num = (value) => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const lower = (value) => String(value ?? '').trim().toLowerCase();

function valueAt(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function isMissing(value) {
  return value === null || value === undefined || value === '';
}

function targetScoreProfile(run) {
  const startedAt = Date.parse(String(run?.startedAt ?? ''));
  const cutoff = Date.parse(OBSERVED_SCORE_EFFECTIVE_AT);
  return Number.isFinite(startedAt) && startedAt >= cutoff ? 'OBSERVED_V1' : 'LEGACY_V2';
}

function observedTaskCounters(run) {
  const tasks = Array.isArray(run?.modelUsage?.tasks) ? run.modelUsage.tasks : [];
  let total = 0;
  let lunaTasks = 0;
  let lunaAccepted = 0;
  let solTaskCount = 0;
  const ids = new Set();
  const duplicateIds = new Set();

  for (const task of tasks) {
    const count = Math.max(0, num(task?.count));
    total += count;
    const id = String(task?.id ?? '').trim();
    if (id) {
      if (ids.has(id)) duplicateIds.add(id);
      ids.add(id);
    }
    const requested = lower(task?.requestedModel);
    if (requested === 'luna') {
      lunaTasks += count;
      if (task?.accepted === true) lunaAccepted += count;
    }
    if (requested === 'sol') solTaskCount += count;
  }

  return { total, lunaTasks, lunaAccepted, solTaskCount, duplicateIds: [...duplicateIds] };
}

function verifiedIssueCloseCount(run) {
  const claims = Array.isArray(run?.completionTruth?.claims) ? run.completionTruth.claims : [];
  const subjects = new Set();
  for (const claim of claims) {
    if (claim?.type !== 'ISSUE_CLOSED' || claim?.verification !== 'VERIFIED') continue;
    if (lower(claim?.observedState) !== 'closed') continue;
    const match = String(claim?.subject ?? '').match(/(?:issue#|#)(\d+)/i);
    if (match) subjects.add(match[1]);
  }
  return subjects.size;
}

export function analyzeScorecardReadiness(run) {
  const validationErrors = validateRunLedgerV2(run);
  const tasks = observedTaskCounters(run);
  const rawCaptureGaps = [];
  const consistencyWarnings = [];
  const scoreProfileTarget = targetScoreProfile(run);

  if (validationErrors.length === 0) {
    const observableActivity =
      num(run?.delivery?.issuesStarted) > 0 ||
      num(run?.ci?.fullCiRuns) > 0 ||
      num(run?.inventory?.closureSweeps) > 0 ||
      num(run?.flow?.solTouches) > 0 ||
      num(run?.flow?.lunaTasks) > 0;

    if (observableActivity && tasks.total === 0) {
      rawCaptureGaps.push('modelUsage.tasks has no observed task records despite recorded Run activity');
    }
    if (tasks.duplicateIds.length) {
      rawCaptureGaps.push(`modelUsage.tasks has duplicate task id(s): ${tasks.duplicateIds.join(', ')}`);
    }

    if (num(run?.flow?.lunaTasks) !== tasks.lunaTasks) {
      consistencyWarnings.push(`flow.lunaTasks=${num(run?.flow?.lunaTasks)} disagrees with modelUsage.tasks-derived ${tasks.lunaTasks}`);
    }
    if (num(run?.flow?.lunaAccepted) !== tasks.lunaAccepted) {
      consistencyWarnings.push(`flow.lunaAccepted=${num(run?.flow?.lunaAccepted)} disagrees with modelUsage.tasks-derived ${tasks.lunaAccepted}`);
    }
    if (num(run?.ci?.invalidReruns) > num(run?.ci?.fullCiRuns)) {
      consistencyWarnings.push(`ci.invalidReruns=${num(run?.ci?.invalidReruns)} exceeds ci.fullCiRuns=${num(run?.ci?.fullCiRuns)}`);
    }
    if (num(run?.inventory?.closureAdvancedOrClosed) > num(run?.inventory?.closureSweeps)) {
      consistencyWarnings.push(`inventory.closureAdvancedOrClosed=${num(run?.inventory?.closureAdvancedOrClosed)} exceeds closureSweeps=${num(run?.inventory?.closureSweeps)}`);
    }

    const verifiedClosed = verifiedIssueCloseCount(run);
    const recordedClosed = num(run?.delivery?.issuesClosed);
    if ((verifiedClosed > 0 || recordedClosed > 0) && verifiedClosed !== recordedClosed) {
      consistencyWarnings.push(`verified ISSUE_CLOSED subjects=${verifiedClosed} disagrees with delivery.issuesClosed=${recordedClosed}`);
    }
  }

  const terminalOnlyPending = TERMINAL_ONLY_INPUTS.filter((field) => {
    const value = valueAt(run, field);
    if (field === 'closeout.state') return value !== 'CLOSED';
    if (field === 'completionTruth.status') return value !== 'VERIFIED';
    return isMissing(value);
  });

  const readyForContinuedCapture = validationErrors.length === 0
    && rawCaptureGaps.length === 0
    && consistencyWarnings.length === 0;

  return {
    runId: run?.runId ?? null,
    validLedger: validationErrors.length === 0,
    validationErrors,
    scoreProfileTarget,
    observedScoreEffectiveAt: OBSERVED_SCORE_EFFECTIVE_AT,
    liveCaptureStatus: readyForContinuedCapture ? 'LIVE_CAPTURE_READY' : 'NEEDS_CAPTURE',
    rawCaptureGaps,
    consistencyWarnings,
    terminalOnlyPending,
    observed: {
      taskCount: tasks.total,
      lunaTasks: tasks.lunaTasks,
      lunaAccepted: tasks.lunaAccepted,
      solTaskCount: tasks.solTaskCount,
      recordedSolTouches: num(run?.flow?.solTouches),
      fullCiRuns: num(run?.ci?.fullCiRuns),
      invalidReruns: num(run?.ci?.invalidReruns),
      closureSweeps: num(run?.inventory?.closureSweeps),
      verifiedIssueClosedSubjects: verifiedIssueCloseCount(run),
      recordedIssuesClosed: num(run?.delivery?.issuesClosed),
    },
    readyForContinuedCapture,
  };
}

export function renderScorecardReadiness(result) {
  const lines = [
    `# Scorecard Live Readiness: ${result.runId ?? 'unknown'}`,
    '',
    `- Target score profile: ${result.scoreProfileTarget}`,
    `- OBSERVED_V1 effective at: ${result.observedScoreEffectiveAt}`,
    `- Ledger valid: ${result.validLedger ? 'YES' : 'NO'}`,
    `- Live capture status: ${result.liveCaptureStatus}`,
    `- Raw capture healthy: ${result.readyForContinuedCapture ? 'YES' : 'NO'}`,
    '',
    '## Observed raw facts',
    '',
    `- tasks: ${result.observed.taskCount}`,
    `- Luna tasks / accepted: ${result.observed.lunaTasks} / ${result.observed.lunaAccepted}`,
    `- Sol task records / recorded Sol touches: ${result.observed.solTaskCount} / ${result.observed.recordedSolTouches}`,
    `- full CI / invalid reruns: ${result.observed.fullCiRuns} / ${result.observed.invalidReruns}`,
    `- closure sweeps: ${result.observed.closureSweeps}`,
    `- verified / recorded ISSUE_CLOSED: ${result.observed.verifiedIssueClosedSubjects} / ${result.observed.recordedIssuesClosed}`,
  ];

  if (result.validationErrors.length) {
    lines.push('', '## Ledger validation errors', '', ...result.validationErrors.map((item) => `- ${item}`));
  }
  lines.push(
    '',
    '## Raw-capture gaps',
    '',
    ...(result.rawCaptureGaps.length ? result.rawCaptureGaps.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Counter consistency warnings',
    '',
    ...(result.consistencyWarnings.length ? result.consistencyWarnings.map((item) => `- ${item}`) : ['- none']),
    '',
    '## Terminal-only pending fields',
    '',
    ...(result.terminalOnlyPending.length ? result.terminalOnlyPending.map((item) => `- ${item}`) : ['- none']),
    '',
    '> Sol task records and flow.solTouches are shown side-by-side but are not asserted equal: the repository defines solTouches as triage/audit touches, not as a strict alias of task-record count.',
    '> Readiness is a categorical capture gate, not a score. It never rewrites a legacy Run into OBSERVED_V1. Runs started before the cutoff remain LEGACY_V2.',
    '> For new OBSERVED_V1 Runs, this tool checks raw capture health without requiring legacy manual percentage fields.',
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
  if (argv.includes('--strict-live') && !result.readyForContinuedCapture) process.exitCode = 2;
  return result;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { cli(); } catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
