#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import { buildProductionDbConsistencyEvidence } from './production-db-consistency-evidence.mjs';
import { buildProductionDbRecoveryEvidence } from './production-db-backup-evidence.mjs';

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function assembleProductionDbConsistencyEvidence({ plan, report, impactManifest } = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  return buildProductionDbConsistencyEvidence({
    report,
    plan,
    impactManifest,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
  });
}

export function assembleProductionDbRecoveryEvidence({
  plan,
  backupEvidence,
  restoreEvidence,
  preimageEvidence = null,
} = {}) {
  return buildProductionDbRecoveryEvidence({
    plan,
    backupEvidence,
    restoreEvidence,
    preimageEvidence,
  });
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'consistency') {
      const [planPath, reportPath, impactPath, outputPath] = args;
      if (!planPath || !reportPath || !impactPath || !outputPath) {
        fail('USAGE', 'consistency <plan.json> <drift-report.json> <impact-manifest.json> <output.json>');
      }
      writeJson(outputPath, assembleProductionDbConsistencyEvidence({
        plan: readJson(planPath),
        report: readJson(reportPath),
        impactManifest: readJson(impactPath),
      }));
      return;
    }

    if (command === 'recovery') {
      const [planPath, backupPath, restorePath, preimagePath, outputPath] = args;
      if (!planPath || !backupPath || !restorePath || !preimagePath || !outputPath) {
        fail('USAGE', 'recovery <plan.json> <backup.json> <restore.json> <preimage.json-or-dash> <output.json>');
      }
      writeJson(outputPath, assembleProductionDbRecoveryEvidence({
        plan: readJson(planPath),
        backupEvidence: readJson(backupPath),
        restoreEvidence: readJson(restorePath),
        preimageEvidence: preimagePath === '-' ? null : readJson(preimagePath),
      }));
      return;
    }

    fail('USAGE', 'use consistency or recovery');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('assemble-production-db-release-evidence.mjs')) main();
