#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import process from 'node:process';

import { routing } from './astra-review-policy.mjs';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/;

export const PRODUCTION_DB_POLICY = Object.freeze({
  repository: 'smallwei0301/vibeaico-admin-rebuild',
  productionProjectRef: 'egehnijjpgijmccagxac',
  consistencyMaxAgeMinutes: 15,
  finalRiskMaxAgeHours: 24,
  restoreRehearsalMaxAgeDays: 30,
  applyLockMaxAgeSeconds: 60,
  maxBackfillRowsPerBatch: 1_000,
  maxBackfillRowsPerRelease: 10_000,
});

const RISK_TIERS = new Set(['ADDITIVE', 'AUTHZ', 'BACKFILL']);

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function requiredString(value, label) {
  const text = String(value ?? '').trim();
  if (!text) fail('MISSING_FIELD', `${label} is required`);
  return text;
}

function validSha(value, label) {
  const text = requiredString(value, label).toLowerCase();
  if (!SHA.test(text)) fail('INVALID_SHA', `${label} must be a 40-character lowercase SHA`);
  return text;
}

function validDigest(value, label) {
  const text = requiredString(value, label).toLowerCase();
  if (!DIGEST.test(text)) fail('INVALID_DIGEST', `${label} must be SHA-256`);
  return text;
}

function validIso(value, label) {
  const text = requiredString(value, label);
  if (!ISO_UTC.test(text) || Number.isNaN(Date.parse(text))) fail('INVALID_TIMESTAMP', `${label} must be ISO UTC`);
  return text;
}

function assertFresh(value, label, nowMs, maxAgeMs) {
  const iso = validIso(value, label);
  const observed = Date.parse(iso);
  if (observed > nowMs + 60_000) fail('FUTURE_EVIDENCE', `${label} is in the future`);
  if (nowMs - observed > maxAgeMs) fail('STALE_EVIDENCE', `${label} is stale`);
  return iso;
}

function assertStatus(value, expected, label) {
  if (String(value ?? '').trim().toUpperCase() !== expected) {
    fail('INVALID_STATUS', `${label} must be ${expected}`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function releaseEvidenceDigestOf(packet = {}) {
  const evidence = canonicalize({
    source: packet.source ?? null,
    consistency: packet.consistency ?? null,
    test: packet.test ?? null,
    recovery: packet.recovery ?? null,
  });
  return createHash('sha256').update(JSON.stringify(evidence)).digest('hex');
}

function allowedFinalRiskModels(policy = routing) {
  const catalog = policy.models?.finalRiskModelCatalog;
  const allowed = policy.models?.finalRiskAllowedModels;
  if (!Array.isArray(catalog) || !Array.isArray(allowed) || !catalog.length || !allowed.length) return new Set();
  if (new Set(catalog).size !== catalog.length || new Set(allowed).size !== allowed.length) return new Set();
  const catalogSet = new Set(catalog);
  if (!allowed.every((model) => catalogSet.has(model))) return new Set();
  if (!allowed.includes(policy.models?.finalRisk)) return new Set();
  return new Set(allowed);
}

function assertCommon(packet, nowMs) {
  if (!packet || typeof packet !== 'object' || Array.isArray(packet)) fail('INVALID_PACKET', 'release packet must be an object');
  if (packet.schemaVersion !== 1) fail('INVALID_SCHEMA_VERSION', 'schemaVersion must be 1');
  const releaseId = requiredString(packet.releaseId, 'releaseId');
  if (!RELEASE_ID.test(releaseId)) fail('INVALID_RELEASE_ID', 'releaseId has an invalid shape');
  if (packet.repository !== PRODUCTION_DB_POLICY.repository) fail('WRONG_REPOSITORY', 'release packet is for another repository');
  if (packet.productionProjectRef !== PRODUCTION_DB_POLICY.productionProjectRef) fail('WRONG_PROJECT', 'release packet is for another Production project');
  const mainSha = validSha(packet.mainSha, 'mainSha');
  const planDigest = validDigest(packet.planDigest, 'planDigest');
  const riskTier = requiredString(packet.riskTier, 'riskTier').toUpperCase();
  if (!RISK_TIERS.has(riskTier)) fail('UNSUPPORTED_RISK_TIER', 'destructive or unknown releases are not admitted by v1');

  const source = packet.source ?? {};
  assertStatus(source.status, 'SOURCE_VERIFIED', 'source.status');
  if (validSha(source.mainSha, 'source.mainSha') !== mainSha) fail('SOURCE_MAIN_MISMATCH', 'source evidence is for another main SHA');
  if (validDigest(source.planDigest, 'source.planDigest') !== planDigest) fail('SOURCE_PLAN_MISMATCH', 'source evidence is for another plan');
  if (source.databaseMutationAuthorized !== false) fail('SOURCE_SCOPE_ESCALATION', 'source evidence must remain read-only admission evidence');

  const consistency = packet.consistency ?? {};
  assertStatus(consistency.status, 'CONSISTENCY_VERIFIED', 'consistency.status');
  if (Number(consistency.unexplainedDifferences) !== 0) fail('UNEXPLAINED_DRIFT', 'unexplained database differences must be zero');
  assertFresh(
    consistency.observedAt,
    'consistency.observedAt',
    nowMs,
    PRODUCTION_DB_POLICY.consistencyMaxAgeMinutes * 60_000,
  );
  if (validSha(consistency.mainSha, 'consistency.mainSha') !== mainSha) fail('CONSISTENCY_MAIN_MISMATCH', 'consistency evidence is for another main SHA');
  if (validDigest(consistency.planDigest, 'consistency.planDigest') !== planDigest) fail('CONSISTENCY_PLAN_MISMATCH', 'consistency evidence is for another plan');

  const test = packet.test ?? {};
  assertStatus(test.status, 'TEST_VERIFIED', 'test.status');
  if (test.policySkip === true) fail('TEST_POLICY_SKIP', 'required TEST evidence cannot be POLICY_SKIP');
  if (!Number.isSafeInteger(test.executedTests) || test.executedTests < 1) fail('EMPTY_TEST_EVIDENCE', 'at least one real test must execute');
  if (String(test.cleanup ?? '').trim().toUpperCase() !== 'PASSED') fail('TEST_CLEANUP_REQUIRED', 'TEST cleanup must pass');
  if (validSha(test.mainSha, 'test.mainSha') !== mainSha) fail('TEST_MAIN_MISMATCH', 'TEST evidence is for another main SHA');
  if (validDigest(test.planDigest, 'test.planDigest') !== planDigest) fail('TEST_PLAN_MISMATCH', 'TEST evidence is for another plan');

  const recovery = packet.recovery ?? {};
  assertStatus(recovery.status, 'RECOVERY_VERIFIED', 'recovery.status');
  assertFresh(recovery.backupObservedAt, 'recovery.backupObservedAt', nowMs, 24 * 60 * 60 * 1000);
  assertFresh(
    recovery.restoreRehearsedAt,
    'recovery.restoreRehearsedAt',
    nowMs,
    PRODUCTION_DB_POLICY.restoreRehearsalMaxAgeDays * 24 * 60 * 60 * 1000,
  );
  if (recovery.storageObjectsCovered === true) fail('BACKUP_SCOPE_OVERCLAIM', 'database backup must not claim Storage object coverage');

  const evidenceDigest = releaseEvidenceDigestOf(packet);
  const finalRisk = packet.finalRisk ?? {};
  assertStatus(finalRisk.status, 'ASTRA_APPROVED', 'finalRisk.status');
  const requestedModel = requiredString(finalRisk.requestedModel, 'finalRisk.requestedModel');
  const actualModel = requiredString(finalRisk.actualModel, 'finalRisk.actualModel');
  const allowed = allowedFinalRiskModels();
  if (requestedModel !== actualModel || !allowed.has(requestedModel)) fail('FINAL_RISK_MODEL_UNVERIFIED', 'Final Risk model must be one current allowlisted identity');
  if (validDigest(finalRisk.planDigest, 'finalRisk.planDigest') !== planDigest) fail('FINAL_RISK_PLAN_MISMATCH', 'Final Risk is for another plan');
  if (validDigest(finalRisk.evidenceDigest, 'finalRisk.evidenceDigest') !== evidenceDigest) fail('FINAL_RISK_EVIDENCE_MISMATCH', 'Final Risk did not review the current source/consistency/TEST/recovery evidence bundle');
  assertFresh(
    finalRisk.reviewedAt,
    'finalRisk.reviewedAt',
    nowMs,
    PRODUCTION_DB_POLICY.finalRiskMaxAgeHours * 60 * 60 * 1000,
  );
  requiredString(finalRisk.executionRef, 'finalRisk.executionRef');
  requiredString(finalRisk.reviewId, 'finalRisk.reviewId');

  return { releaseId, mainSha, planDigest, evidenceDigest, riskTier };
}

function assertRiskAdaptiveEvidence(packet, riskTier) {
  const test = packet.test ?? {};
  const recovery = packet.recovery ?? {};
  const data = packet.data ?? {};

  if (riskTier === 'AUTHZ') {
    if (test.tenantBoundaryVerified !== true) fail('TENANT_BOUNDARY_TEST_REQUIRED', 'AUTHZ release requires tenant-boundary tests');
    if (test.negativeRoleTestsPassed !== true) fail('NEGATIVE_ROLE_TEST_REQUIRED', 'AUTHZ release requires negative role tests');
  }

  if (riskTier === 'BACKFILL') {
    if (recovery.preimageBackupVerified !== true) fail('PREIMAGE_BACKUP_REQUIRED', 'BACKFILL release requires preimage backup evidence');
    if (data.paymentFactsTouched === true) fail('PAYMENT_FACTS_FORBIDDEN', 'v1 backfill gate does not authorize payment fact rewrites');
    if (!Number.isSafeInteger(data.batchSize) || data.batchSize < 1 || data.batchSize > PRODUCTION_DB_POLICY.maxBackfillRowsPerBatch) {
      fail('BACKFILL_BATCH_LIMIT', `batchSize must be 1..${PRODUCTION_DB_POLICY.maxBackfillRowsPerBatch}`);
    }
    if (!Number.isSafeInteger(data.maxRows) || data.maxRows < 1 || data.maxRows > PRODUCTION_DB_POLICY.maxBackfillRowsPerRelease) {
      fail('BACKFILL_RELEASE_LIMIT', `maxRows must be 1..${PRODUCTION_DB_POLICY.maxBackfillRowsPerRelease}`);
    }
  }
}

export function evaluateReleasePreflight(packet, { now = new Date().toISOString() } = {}) {
  const nowIso = validIso(now, 'now');
  const nowMs = Date.parse(nowIso);
  const common = assertCommon(packet, nowMs);
  assertRiskAdaptiveEvidence(packet, common.riskTier);
  return {
    schemaVersion: 1,
    status: 'READY_FOR_LOCK',
    releaseId: common.releaseId,
    mainSha: common.mainSha,
    planDigest: common.planDigest,
    evidenceDigest: common.evidenceDigest,
    riskTier: common.riskTier,
    evaluatedAt: nowIso,
    nextRequiredGate: 'G6_WRITER_LOCK_AND_LIVE_RECHECK',
    databaseMutationAuthorized: false,
  };
}

export function evaluateApplyAdmission(packet, lockEvidence, { now = new Date().toISOString() } = {}) {
  const preflight = evaluateReleasePreflight(packet, { now });
  const nowMs = Date.parse(now);
  if (!lockEvidence || typeof lockEvidence !== 'object' || Array.isArray(lockEvidence)) fail('LOCK_EVIDENCE_REQUIRED', 'lock evidence is required');
  assertStatus(lockEvidence.status, 'LOCK_VERIFIED', 'lock.status');
  if (lockEvidence.releaseId !== preflight.releaseId) fail('LOCK_RELEASE_MISMATCH', 'lock belongs to another release');
  if (lockEvidence.projectRef !== PRODUCTION_DB_POLICY.productionProjectRef) fail('LOCK_PROJECT_MISMATCH', 'lock belongs to another project');
  if (validDigest(lockEvidence.planDigest, 'lock.planDigest') !== preflight.planDigest) fail('LOCK_PLAN_MISMATCH', 'lock belongs to another plan');
  assertFresh(
    lockEvidence.acquiredAt,
    'lock.acquiredAt',
    nowMs,
    PRODUCTION_DB_POLICY.applyLockMaxAgeSeconds * 1000,
  );
  requiredString(lockEvidence.holder, 'lock.holder');
  if (lockEvidence.liveBaselineRechecked !== true) fail('LIVE_RECHECK_REQUIRED', 'live baseline must be rechecked after lock acquisition');

  return {
    ...preflight,
    status: 'READY_FOR_CONTROLLED_APPLY',
    nextRequiredGate: 'CONTROLLED_WRITER',
    // A validator result is not a credential and cannot mutate a database by itself.
    databaseMutationAuthorized: false,
  };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function main() {
  const [command, packetPath, lockPath] = process.argv.slice(2);
  try {
    if (command === 'preflight' && packetPath) {
      console.log(JSON.stringify(evaluateReleasePreflight(readJson(packetPath)), null, 2));
      return;
    }
    if (command === 'admit' && packetPath && lockPath) {
      console.log(JSON.stringify(evaluateApplyAdmission(readJson(packetPath), readJson(lockPath)), null, 2));
      return;
    }
    fail('USAGE', 'use: production-db-release-preflight.mjs preflight <packet.json> | admit <packet.json> <lock.json>');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-release-preflight.mjs')) main();
