#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

import {
  captureEnvironmentSnapshot,
  normalizeObserverSnapshot,
} from './schema-drift-watch.mjs';

const EXPECTED_REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const MAX_AGE_MS = 15 * 60 * 1000;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
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

function runIdentity(sourceRunId, sourceRunAttempt) {
  const runId = String(sourceRunId ?? '').trim();
  const runAttempt = Number(sourceRunAttempt);
  if (!runId || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    fail('INVALID_TEST_RUN_IDENTITY', 'GitHub run id/attempt are required');
  }
  return { runId, runAttempt };
}

function planIdentity(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  if (plan.repository !== EXPECTED_REPOSITORY) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  if (plan.productionProjectRef !== PRODUCTION_PROJECT_REF) fail('WRONG_PROJECT', 'release plan Production project is not canonical');
  const mainSha = exactSha(plan.mainSha, 'plan.mainSha');
  const planDigest = exactDigest(plan.planDigest, 'plan.planDigest');
  const releaseId = String(plan.releaseId ?? '').trim();
  if (!releaseId) fail('RELEASE_ID_REQUIRED', 'releaseId is required');
  if (!Array.isArray(plan.migrations) || !plan.migrations.length) fail('PLAN_MIGRATIONS_REQUIRED', 'release plan has no migrations');
  return { mainSha, planDigest, releaseId };
}

function digestValue(value, label) {
  const algorithm = String(value?.algorithm ?? '').trim().toUpperCase();
  const digest = String(value?.value ?? '').trim().toLowerCase();
  if (algorithm !== 'SHA256' || !DIGEST.test(digest)) fail('INVALID_CAPTURE_DIGEST', `${label} must be SHA256`);
  return digest;
}

function assertFreshObservedAt(value, now) {
  const observed = Date.parse(String(value ?? ''));
  const current = Date.parse(String(now ?? ''));
  if (!Number.isFinite(observed) || !Number.isFinite(current)) fail('INVALID_POST_TEST_TIMESTAMP', 'observedAt/now must be valid timestamps');
  if (observed > current + 60_000) fail('FUTURE_POST_TEST_EVIDENCE', 'post-TEST schema evidence is in the future');
  if (current - observed > MAX_AGE_MS) fail('STALE_POST_TEST_EVIDENCE', 'post-TEST schema evidence is older than 15 minutes');
  return new Date(observed).toISOString();
}

/**
 * Validate a sanitized schema-drift TEST snapshot and bind it to the same release
 * plan and GitHub run as G3. This proves a fresh post-TEST recapture happened; it
 * does not replace the later G2 TEST/Production/local consistency comparison.
 *
 * @param {{
 *   snapshot: any,
 *   plan: any,
 *   sourceRunId: string|number,
 *   sourceRunAttempt: number,
 *   now?: string,
 *   normalizeSnapshot?: (value:any, currentMainSha:string)=>any,
 * }} input
 */
export function buildProductionDbPostTestSchemaEvidence({
  snapshot,
  plan,
  sourceRunId,
  sourceRunAttempt,
  now = new Date().toISOString(),
  normalizeSnapshot = normalizeObserverSnapshot,
}) {
  const { mainSha, planDigest, releaseId } = planIdentity(plan);
  const sourceRun = runIdentity(sourceRunId, sourceRunAttempt);
  const normalized = normalizeSnapshot(snapshot, mainSha);
  if (!normalized || normalized.status !== 'CAPTURED') {
    const reason = normalized?.reason ? ` (${normalized.reason})` : '';
    fail('POST_TEST_SCHEMA_CAPTURE_REQUIRED', `TEST schema snapshot must be CAPTURED${reason}`);
  }
  if (normalized.environment !== 'TEST' || normalized.projectRef !== TEST_PROJECT_REF) {
    fail('POST_TEST_SCHEMA_PROJECT_MISMATCH', 'post-TEST schema snapshot must be canonical TEST');
  }
  if (exactSha(normalized.observedMainSha, 'snapshot.observedMainSha') !== mainSha) {
    fail('POST_TEST_SCHEMA_MAIN_MISMATCH', 'post-TEST schema snapshot belongs to another main SHA');
  }
  if (normalized.rawDataIncluded !== false) fail('POST_TEST_SCHEMA_RAW_DATA_FORBIDDEN', 'post-TEST schema evidence must remain sanitized');
  const observedAt = assertFreshObservedAt(normalized.observedAt, now);
  const captureDigest = digestValue(normalized.captureDigest, 'snapshot.captureDigest');
  const migrationLedgerDigest = digestValue(normalized.migrationLedger?.digest, 'snapshot.migrationLedger.digest');
  const identities = Array.isArray(normalized.migrationLedger?.identities) ? normalized.migrationLedger.identities : [];

  const plannedMigrations = [];
  for (const migration of plan.migrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    if (!repoFile) fail('INVALID_PLAN_MIGRATION', 'release plan migration name is missing');
    const matches = identities.filter((entry) => String(entry?.name ?? '').trim() === repoFile);
    if (matches.length !== 1) {
      fail('POST_TEST_LEDGER_MISMATCH', `${repoFile} must exist exactly once in the post-TEST provider ledger`);
    }
    plannedMigrations.push({ repoFile, ledgerVersion: String(matches[0]?.version ?? '') });
  }

  return {
    schemaVersion: 1,
    status: 'TEST_POST_APPLY_SCHEMA_CAPTURED',
    repository: EXPECTED_REPOSITORY,
    testProjectRef: TEST_PROJECT_REF,
    mainSha,
    planDigest,
    releaseId,
    sourceRunId: sourceRun.runId,
    sourceRunAttempt: sourceRun.runAttempt,
    observedAt,
    captureDigest,
    migrationLedgerDigest,
    plannedMigrations,
    comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED',
    readOnly: true,
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
  };
}

/**
 * Capture canonical TEST through the existing schema-drift observer, then bind the
 * sanitized snapshot to the current G3 release/run. No compare is performed here.
 *
 * @param {{
 *   plan:any,
 *   sourceRunId:string|number,
 *   sourceRunAttempt:number,
 *   token?:string,
 *   now?:string,
 *   captureSnapshot?: typeof captureEnvironmentSnapshot,
 * }} input
 */
export async function captureProductionDbPostTestSchemaEvidence({
  plan,
  sourceRunId,
  sourceRunAttempt,
  token = process.env.SCHEMA_OBSERVER_TOKEN,
  now = new Date().toISOString(),
  captureSnapshot = captureEnvironmentSnapshot,
}) {
  const { mainSha } = planIdentity(plan);
  const observerToken = String(token ?? '').trim();
  if (!observerToken) fail('MISSING_SCHEMA_OBSERVER_TOKEN', 'SCHEMA_OBSERVER_TOKEN is required');
  if (process.env.SUPABASE_ACCESS_TOKEN) fail('BROAD_SCHEMA_TOKEN_FORBIDDEN', 'post-TEST schema capture rejects broad SUPABASE_ACCESS_TOKEN');
  const snapshot = await captureSnapshot({
    environment: 'TEST',
    currentMainSha: mainSha,
    token: observerToken,
    observedAt: now,
  });
  const evidence = buildProductionDbPostTestSchemaEvidence({
    snapshot,
    plan,
    sourceRunId,
    sourceRunAttempt,
    now,
  });
  return { snapshot, evidence };
}

async function main() {
  const [command, planPath, snapshotPath, evidencePath] = process.argv.slice(2);
  try {
    if (command !== 'capture' || !planPath || !snapshotPath || !evidencePath) {
      fail('USAGE', 'capture <plan.json> <snapshot.json> <evidence.json>');
    }
    const plan = JSON.parse(readFileSync(planPath, 'utf8'));
    if (process.env.GITHUB_SHA && exactSha(process.env.GITHUB_SHA, 'GITHUB_SHA') !== exactSha(plan.mainSha, 'plan.mainSha')) {
      fail('GITHUB_SHA_PLAN_MISMATCH', 'GITHUB_SHA does not equal the release plan main SHA');
    }
    const result = await captureProductionDbPostTestSchemaEvidence({
      plan,
      sourceRunId: process.env.GITHUB_RUN_ID,
      sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
    });
    writeFileSync(snapshotPath, `${JSON.stringify(result.snapshot, null, 2)}\n`);
    writeFileSync(evidencePath, `${JSON.stringify(result.evidence, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-g3-post-test-schema.mjs')) main();
