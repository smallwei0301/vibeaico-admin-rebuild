#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

import { createProductionDbApplyReceipt } from './production-db-apply-receipt.mjs';
import {
  PRODUCTION_DB_POLICY,
  evaluateAutomationReadiness,
  evaluateReleasePreflight,
} from './production-db-release-preflight.mjs';
import { createReleaseJournal } from './production-db-release-journal.mjs';
import { finalizeProductionDbPostcheck } from './production-db-postcheck.mjs';
import { verifyProductionDbReleasePlan } from './production-db-release-plan.mjs';
import {
  executePreparedControlledProductionRelease,
  prepareControlledProductionReleaseAttempt,
} from '../db/controlled-production-db-release.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function exactSha(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact 40-character SHA`);
  return text;
}

function exactDigest(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!DIGEST.test(text)) fail('INVALID_PLAN_DIGEST', `${label} must be SHA-256`);
  return text;
}

function runGit(repoRoot, args, runner = spawnSync) {
  const result = runner('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim() || 'unknown error'}`);
  }
  return String(result.stdout ?? '').trim();
}

/**
 * The mutable orchestrator is trusted-main only. This guard runs before any
 * delegated Production network work.
 * @param {any} plan
 * @param {{repoRoot?:string, runner?:typeof spawnSync}} options
 */
export function assertExactTrustedMain(plan, { repoRoot = process.cwd(), runner = spawnSync } = {}) {
  const expected = exactSha(plan?.mainSha, 'plan.mainSha');
  runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main'], runner);
  const head = exactSha(runGit(repoRoot, ['rev-parse', 'HEAD'], runner), 'checkout HEAD');
  const main = exactSha(runGit(repoRoot, ['rev-parse', 'origin/main'], runner), 'origin/main');
  if (head !== expected || main !== expected) {
    fail('TRUSTED_MAIN_CHECKOUT_MISMATCH', `checkout=${head}, origin/main=${main}, plan=${expected}`);
  }
  return { status: 'TRUSTED_MAIN_VERIFIED', mainSha: expected, databaseMutationAuthorized: false };
}

function assertPlan(plan, { repoRoot = process.cwd() } = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  const aliasMap = readJson(resolve(repoRoot, 'supabase/ledger-alias-map.json'));
  const readCanonicalSql = (path) => readFileSync(resolve(repoRoot, path), 'utf8');
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  return { aliasMap, readCanonicalSql };
}

function assertEvidenceIdentity(evidence, expectedStatus, plan, label) {
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) fail(`${label}_EVIDENCE_REQUIRED`, `${label} evidence is required`);
  if (evidence.status !== expectedStatus) fail(`${label}_STATUS_INVALID`, `${label}.status must be ${expectedStatus}`);
  if (exactSha(evidence.mainSha, `${label}.mainSha`) !== plan.mainSha) fail(`${label}_MAIN_MISMATCH`, `${label} evidence belongs to another main SHA`);
  if (exactDigest(evidence.planDigest, `${label}.planDigest`) !== plan.planDigest) fail(`${label}_PLAN_MISMATCH`, `${label} evidence belongs to another plan`);
  if (evidence.databaseMutationAuthorized === true) fail(`${label}_SCOPE_ESCALATION`, `${label} evidence cannot authorize a database mutation`);
}

export function buildProductionDbBaseReleasePacket({
  plan,
  sourceEvidence,
  consistencyEvidence,
  testEvidence,
  recoveryEvidence,
  data = {},
} = /** @type {any} */ ({})) {
  if (!plan || plan.repository !== PRODUCTION_DB_POLICY.repository || plan.productionProjectRef !== PRODUCTION_DB_POLICY.productionProjectRef) {
    fail('WRONG_RELEASE_PLAN', 'release plan repository/project is not canonical');
  }
  exactSha(plan.mainSha, 'plan.mainSha');
  exactDigest(plan.planDigest, 'plan.planDigest');
  if (!String(plan.releaseId ?? '').trim()) fail('RELEASE_ID_REQUIRED', 'releaseId is required');

  assertEvidenceIdentity(sourceEvidence, 'SOURCE_VERIFIED', plan, 'SOURCE');
  assertEvidenceIdentity(consistencyEvidence, 'CONSISTENCY_VERIFIED', plan, 'CONSISTENCY');
  assertEvidenceIdentity(testEvidence, 'TEST_VERIFIED', plan, 'TEST');
  assertEvidenceIdentity(recoveryEvidence, 'RECOVERY_VERIFIED', plan, 'RECOVERY');
  if (sourceEvidence.databaseMutationAuthorized !== false) fail('SOURCE_SCOPE_ESCALATION', 'source evidence must explicitly remain read-only admission evidence');
  if (Number(consistencyEvidence.unexplainedDifferences) !== 0) fail('UNEXPLAINED_DRIFT', 'consistency evidence has unexplained differences');
  if (testEvidence.policySkip === true || testEvidence.cleanup !== 'PASSED') fail('TEST_EVIDENCE_INCOMPLETE', 'TEST evidence is skipped or cleanup is incomplete');
  if (recoveryEvidence.storageObjectsCovered === true) fail('RECOVERY_SCOPE_OVERCLAIM', 'database recovery cannot claim Storage object coverage');

  return {
    schemaVersion: 1,
    releaseId: plan.releaseId,
    repository: plan.repository,
    productionProjectRef: plan.productionProjectRef,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
    riskTier: plan.riskTier,
    source: sourceEvidence,
    consistency: consistencyEvidence,
    test: testEvidence,
    recovery: recoveryEvidence,
    data: data && typeof data === 'object' && !Array.isArray(data) ? data : {},
  };
}

export function attachProductionDbFinalRisk({ basePacket, finalRiskEvidence, now = new Date().toISOString() } = /** @type {any} */ ({})) {
  if (!basePacket || typeof basePacket !== 'object' || Array.isArray(basePacket)) fail('BASE_PACKET_REQUIRED', 'base release packet is required');
  if (!finalRiskEvidence || finalRiskEvidence.status !== 'ASTRA_APPROVED') fail('FINAL_RISK_REQUIRED', 'trusted Production DB Final Risk evidence is required');
  if (String(finalRiskEvidence.releaseId ?? '') !== String(basePacket.releaseId ?? '')) fail('FINAL_RISK_RELEASE_MISMATCH', 'Final Risk belongs to another release');
  if (exactDigest(finalRiskEvidence.planDigest, 'finalRisk.planDigest') !== basePacket.planDigest) fail('FINAL_RISK_PLAN_MISMATCH', 'Final Risk belongs to another plan');
  if (finalRiskEvidence.databaseMutationAuthorized !== false) fail('FINAL_RISK_SCOPE_ESCALATION', 'Final Risk evidence cannot authorize mutation');
  const packet = { ...basePacket, finalRisk: finalRiskEvidence };
  evaluateReleasePreflight(packet, { now });
  return packet;
}

export function assertPolicyGatedAutomationActive({ automationEvidence, plan } = /** @type {any} */ ({})) {
  const readiness = evaluateAutomationReadiness(automationEvidence);
  if (!readiness.automationReady || readiness.status !== 'AUTOMATION_READY' || readiness.authorizationMode !== 'POLICY_GATED_ACTIVE') {
    const blockers = Array.isArray(readiness.blockers) ? readiness.blockers.join(',') : 'UNKNOWN';
    fail('AUTOMATION_NOT_READY', `Production DB automation is not active: ${blockers}`);
  }
  if (readiness.mainSha !== plan?.mainSha) fail('AUTOMATION_MAIN_MISMATCH', 'automation readiness belongs to another main SHA');
  if (readiness.databaseMutationAuthorized !== false) fail('AUTOMATION_SCOPE_ESCALATION', 'automation readiness is not a mutation credential');
  return readiness;
}

export function createProductionDbOrchestratorState({
  automationEvidence,
  plan,
  githubRunId,
  githubRunAttempt,
  now = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  assertPolicyGatedAutomationActive({ automationEvidence, plan });
  const journal = createReleaseJournal({
    releaseId: plan.releaseId,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
    createdAt: now,
  });
  const receipt = createProductionDbApplyReceipt({
    releaseId: plan.releaseId,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
    projectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    githubRunId: String(githubRunId ?? ''),
    githubRunAttempt: Number(githubRunAttempt),
    issuedAt: now,
  });
  return { journal, receipt, databaseMutationAuthorized: false };
}

export async function prepareProductionDbRelease({
  automationEvidence,
  plan,
  releasePacket,
  journal,
  receipt,
  token,
  repoRoot = process.cwd(),
  runner = spawnSync,
  fetchImpl = fetch,
  now = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  assertPolicyGatedAutomationActive({ automationEvidence, plan });
  assertExactTrustedMain(plan, { repoRoot, runner });
  const { aliasMap, readCanonicalSql } = assertPlan(plan, { repoRoot });
  if (!String(token ?? '').trim()) fail('MISSING_PRODUCTION_RELEASE_TOKEN', 'PRODUCTION_DB_RELEASE_TOKEN is required');
  return prepareControlledProductionReleaseAttempt({
    plan, releasePacket, journal, receipt, aliasMap, readCanonicalSql,
    token, fetchImpl, now,
  });
}

export async function executeProductionDbPreparedRelease({
  automationEvidence,
  plan,
  releasePacket,
  prepared,
  token,
  repoRoot = process.cwd(),
  runner = spawnSync,
  fetchImpl = fetch,
  now = new Date().toISOString(),
} = /** @type {any} */ ({})) {
  assertPolicyGatedAutomationActive({ automationEvidence, plan });
  assertExactTrustedMain(plan, { repoRoot, runner });
  const { aliasMap, readCanonicalSql } = assertPlan(plan, { repoRoot });
  if (!String(token ?? '').trim()) fail('MISSING_PRODUCTION_RELEASE_TOKEN', 'PRODUCTION_DB_RELEASE_TOKEN is required');
  return executePreparedControlledProductionRelease({
    prepared, plan, releasePacket, aliasMap, readCanonicalSql,
    token, fetchImpl, now,
  });
}

export function finalizeProductionDbRelease({ plan, applyResult, postcheckReport, now = new Date().toISOString() } = /** @type {any} */ ({})) {
  if (!applyResult || applyResult.status !== 'APPLY_NEEDS_SCHEMA_POSTCHECK') fail('APPLY_RESULT_REQUIRED', 'verified apply result is required before G7');
  if (applyResult.releaseId !== plan?.releaseId || applyResult.mainSha !== plan?.mainSha || applyResult.planDigest !== plan?.planDigest) {
    fail('APPLY_RESULT_PLAN_MISMATCH', 'apply result belongs to another release plan');
  }
  return finalizeProductionDbPostcheck({
    report: postcheckReport,
    plan,
    journal: applyResult.journal,
    now,
  });
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'base-packet') {
      const [planPath, sourcePath, consistencyPath, testPath, recoveryPath, dataPath, outputPath] = args;
      if (!planPath || !sourcePath || !consistencyPath || !testPath || !recoveryPath || !outputPath) fail('USAGE', 'base-packet <plan> <source> <consistency> <test> <recovery> [data-or-dash] <output>');
      const data = dataPath && dataPath !== '-' ? readJson(dataPath) : {};
      writeJson(outputPath, buildProductionDbBaseReleasePacket({
        plan: readJson(planPath), sourceEvidence: readJson(sourcePath), consistencyEvidence: readJson(consistencyPath),
        testEvidence: readJson(testPath), recoveryEvidence: readJson(recoveryPath), data,
      }));
      return;
    }
    if (command === 'final-packet') {
      const [basePath, finalRiskPath, outputPath] = args;
      if (!basePath || !finalRiskPath || !outputPath) fail('USAGE', 'final-packet <base> <final-risk> <output>');
      writeJson(outputPath, attachProductionDbFinalRisk({ basePacket: readJson(basePath), finalRiskEvidence: readJson(finalRiskPath) }));
      return;
    }
    if (command === 'init-state') {
      const [automationPath, planPath, journalPath, receiptPath] = args;
      if (!automationPath || !planPath || !journalPath || !receiptPath) fail('USAGE', 'init-state <automation-evidence> <plan> <journal> <receipt>');
      const state = createProductionDbOrchestratorState({
        automationEvidence: readJson(automationPath), plan: readJson(planPath),
        githubRunId: process.env.GITHUB_RUN_ID, githubRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      });
      writeJson(journalPath, state.journal);
      writeJson(receiptPath, state.receipt);
      return;
    }
    if (command === 'prepare') {
      const [automationPath, planPath, packetPath, journalPath, receiptPath, outputPath] = args;
      if (!automationPath || !planPath || !packetPath || !journalPath || !receiptPath || !outputPath) fail('USAGE', 'prepare <automation> <plan> <packet> <journal> <receipt> <prepared-output>');
      const prepared = await prepareProductionDbRelease({
        automationEvidence: readJson(automationPath), plan: readJson(planPath), releasePacket: readJson(packetPath),
        journal: readJson(journalPath), receipt: readJson(receiptPath), token: process.env.PRODUCTION_DB_RELEASE_TOKEN,
      });
      writeJson(outputPath, prepared);
      return;
    }
    if (command === 'execute') {
      const [automationPath, planPath, packetPath, preparedPath, outputPath] = args;
      if (!automationPath || !planPath || !packetPath || !preparedPath || !outputPath) fail('USAGE', 'execute <automation> <plan> <packet> <prepared> <output>');
      try {
        const result = await executeProductionDbPreparedRelease({
          automationEvidence: readJson(automationPath), plan: readJson(planPath), releasePacket: readJson(packetPath),
          prepared: readJson(preparedPath), token: process.env.PRODUCTION_DB_RELEASE_TOKEN,
        });
        writeJson(outputPath, result);
      } catch (error) {
        if (error?.code === 'APPLY_UNKNOWN') {
          writeJson(outputPath, {
            schemaVersion: 1, status: 'APPLY_UNKNOWN', error: error.message,
            journal: error.journal, receipt: error.receipt, databaseMutationAuthorized: false,
          });
        }
        throw error;
      }
      return;
    }
    if (command === 'postcheck') {
      const [planPath, applyPath, reportPath, outputPath] = args;
      if (!planPath || !applyPath || !reportPath || !outputPath) fail('USAGE', 'postcheck <plan> <apply-result> <drift-report> <output>');
      try {
        writeJson(outputPath, finalizeProductionDbRelease({
          plan: readJson(planPath), applyResult: readJson(applyPath), postcheckReport: readJson(reportPath),
        }));
      } catch (error) {
        if (error?.code === 'POSTCHECK_FAILED') {
          writeJson(outputPath, {
            schemaVersion: 1, status: 'POSTCHECK_FAILED', error: error.message,
            journal: error.journal, databaseMutationAuthorized: false,
          });
        }
        throw error;
      }
      return;
    }
    fail('USAGE', 'use base-packet | final-packet | init-state | prepare | execute | postcheck');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-release-orchestrator.mjs')) main();
