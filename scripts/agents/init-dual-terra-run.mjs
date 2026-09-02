#!/usr/bin/env node

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { buildInitialRun, validateRun } from './run-ledger.mjs';

function readFlag(argv, name, fallback = null) {
  const index = argv.indexOf(name);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
  return value;
}

function nullableInteger(value) {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`expected a non-negative integer, got ${value}`);
  return parsed;
}

export function buildDualTerraRun({
  runId,
  mainSha,
  openIssues = null,
  openPrs = null,
  startedAt = new Date().toISOString(),
} = {}) {
  if (!runId) throw new Error('runId is required');
  if (!mainSha) throw new Error('mainSha is required');

  const run = buildInitialRun(runId, startedAt);
  run.status = 'IN_PROGRESS';
  run.main.startSha = mainSha;
  run.sources.openIssueStart = nullableInteger(openIssues);
  run.sources.openPrStart = nullableInteger(openPrs);
  Object.assign(run.inventory, {
    dualTerraPilot: true,
    terraTarget: 2,
    slot1ActiveMinutes: null,
    slot2ActiveMinutes: null,
    localIsolatedJobs: null,
    localIsolatedSuccess: null,
    localIsolatedFailure: null,
    localCleanupSuccess: null,
    remoteCanonicalWaitMinutes: null,
    crossLaneContamination: null,
    fallbackToSingleTerra: false,
  });
  return run;
}

export function writeDualTerraRun({ run, outputDir = 'docs/metrics/dual-terra-runs' }) {
  const directory = resolve(outputDir);
  mkdirSync(directory, { recursive: true });
  const outputPath = resolve(directory, `${run.runId}.json`);
  if (existsSync(outputPath)) throw new Error(`refusing to overwrite existing Run ledger: ${outputPath}`);
  const validation = validateRun(run);
  if (!validation.valid) throw new Error(`invalid initial dual Terra Run: ${validation.errors.join('; ')}`);
  writeFileSync(outputPath, `${JSON.stringify(run, null, 2)}\n`, 'utf8');
  return outputPath;
}

function cli(argv) {
  const runId = readFlag(argv, '--run-id');
  const mainSha = readFlag(argv, '--main-sha');
  const openIssues = readFlag(argv, '--open-issues');
  const openPrs = readFlag(argv, '--open-prs');
  const outputDir = readFlag(argv, '--output-dir', 'docs/metrics/dual-terra-runs');
  const run = buildDualTerraRun({ runId, mainSha, openIssues, openPrs });
  const outputPath = writeDualTerraRun({ run, outputDir });
  console.log(`[dual-terra-run] initialized ${outputPath}`);
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : '';
if (import.meta.url === entry) cli(process.argv);
