#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';

import {
  buildProductionDbReleasePlan,
  verifyProductionDbReleasePlan,
} from '../agents/production-db-release-plan.mjs';

const API = 'https://api.supabase.com';
const REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';
const CREATED_BY = 'vibeaico-g3-test-validator';
const LOCK_KEY = `vibeaico-g3-test-release:${TEST_PROJECT_REF}`;
const SHA = /^[0-9a-f]{40}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function textArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(', ')}]::text[]`;
}

function exactSha(value, label = 'mainSha') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact 40-character SHA`);
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

export function assertTrustedMainCheckout(expectedMainSha, repoRoot = process.cwd(), runner = spawnSync) {
  const expected = exactSha(expectedMainSha, 'expectedMainSha');
  runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main'], runner);
  const head = exactSha(runGit(repoRoot, ['rev-parse', 'HEAD'], runner), 'checkout HEAD');
  const main = exactSha(runGit(repoRoot, ['rev-parse', 'origin/main'], runner), 'origin/main');
  if (head !== expected || main !== expected) {
    fail('TRUSTED_MAIN_CHECKOUT_MISMATCH', `checkout=${head}, origin/main=${main}, expected=${expected}`);
  }
  return { status: 'TRUSTED_MAIN_VERIFIED', mainSha: expected, databaseMutationAuthorized: false };
}

export function assertTestReleaseTarget(projectRef) {
  const value = String(projectRef ?? '').trim();
  if (value === PRODUCTION_PROJECT_REF) fail('PRODUCTION_TARGET_FORBIDDEN', 'G3 TEST validator may never target Production');
  if (value !== TEST_PROJECT_REF) fail('CANONICAL_TEST_TARGET_REQUIRED', 'G3 TEST validator only targets canonical TEST');
  return value;
}

function assertAtomicCompatibleSql(sql, repoFile) {
  const text = String(sql ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  if (/\b(create|reindex)\s+index\s+concurrently\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} uses CONCURRENTLY and cannot run in the atomic G3 validator`);
  }
  if (/\b(vacuum|cluster|alter\s+system|create\s+database|drop\s+database)\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} contains a command not admitted by the atomic G3 validator`);
  }
}

function canonicalReader(repoRoot) {
  return (path) => readFileSync(resolve(repoRoot, path), 'utf8');
}

function readAliasMap(repoRoot) {
  return JSON.parse(readFileSync(resolve(repoRoot, 'supabase/ledger-alias-map.json'), 'utf8'));
}

export function buildTestReleasePlanFromCheckout({
  releaseId,
  mainSha,
  plannedAt,
  repoRoot = process.cwd(),
  runner = spawnSync,
} = {}) {
  const exactMain = exactSha(mainSha);
  assertTrustedMainCheckout(exactMain, repoRoot, runner);
  return buildProductionDbReleasePlan({
    releaseId,
    mainSha: exactMain,
    plannedAt,
    aliasMap: readAliasMap(repoRoot),
    readCanonicalSql: canonicalReader(repoRoot),
  });
}

export async function captureTestProviderLedger({
  token,
  projectRef = TEST_PROJECT_REF,
  fetchImpl = fetch,
} = {}) {
  const target = assertTestReleaseTarget(projectRef);
  if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN is required');
  const response = await fetchImpl(`${API}/v1/projects/${target}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'select version, name, created_by, idempotency_key from supabase_migrations.schema_migrations order by version, name',
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) fail('TEST_LEDGER_READ_FAILED', `TEST ledger read failed with HTTP ${response.status}`);
  return body.map((row) => ({
    version: String(row?.version ?? ''),
    name: String(row?.name ?? ''),
    created_by: row?.created_by == null ? null : String(row.created_by),
    idempotency_key: row?.idempotency_key == null ? null : String(row.idempotency_key),
  }));
}

function assertPlanLedgerAdmission(plan, liveLedgerRows) {
  if (!Array.isArray(liveLedgerRows)) fail('INVALID_TEST_LEDGER_ROWS', 'TEST ledger rows must be an array');
  const decisions = [];
  for (const migration of plan.migrations) {
    const name = String(migration.repoFile);
    const matches = liveLedgerRows.filter((row) => row.name === name);
    if (matches.length > 1) fail('DUPLICATE_TEST_LEDGER_NAME', `${name} appears multiple times in TEST provider ledger`);
    const idempotencyKey = `g3:${plan.releaseId}:${name}`;
    if (matches.length === 1) {
      decisions.push({ repoFile: name, existedBefore: true, existingVersion: matches[0].version, idempotencyKey });
      continue;
    }
    const versionCollision = liveLedgerRows.find((row) => row.version === String(migration.ledgerVersion));
    if (versionCollision) {
      fail('TEST_LEDGER_VERSION_COLLISION', `${migration.ledgerVersion} already belongs to ${versionCollision.name}`);
    }
    const keyCollision = liveLedgerRows.find((row) => row.idempotency_key === idempotencyKey);
    if (keyCollision) fail('TEST_LEDGER_IDEMPOTENCY_COLLISION', `${idempotencyKey} already belongs to ${keyCollision.name}`);
    decisions.push({ repoFile: name, existedBefore: false, existingVersion: null, idempotencyKey });
  }
  return decisions;
}

export function buildAtomicTestReleaseValidationSql({
  plan,
  aliasMap,
  liveLedgerRows,
  readCanonicalSql,
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  const decisions = assertPlanLedgerAdmission(plan, liveLedgerRows);
  const baseline = [...liveLedgerRows]
    .map((row) => `${row.version}:${row.name}`)
    .sort();
  const statements = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    `do $lock$ begin if not pg_try_advisory_xact_lock(hashtextextended(${sqlLiteral(LOCK_KEY)}, 0)) then raise exception 'G3_TEST_RELEASE_LOCK_BUSY'; end if; end $lock$;`,
    `do $baseline$ declare actual text[]; expected text[] := ${textArray(baseline)}; begin select coalesce(array_agg(version || ':' || name order by version, name), array[]::text[]) into actual from supabase_migrations.schema_migrations; if actual is distinct from expected then raise exception 'G3_TEST_LEDGER_CHANGED_AFTER_LOCK'; end if; end $baseline$;`,
  ];

  for (const migration of plan.migrations) {
    const decision = decisions.find((item) => item.repoFile === migration.repoFile);
    const sql = String(readCanonicalSql(migration.path));
    assertAtomicCompatibleSql(sql, migration.repoFile);
    statements.push(`-- G3 exact-main validation ${migration.repoFile}\n${sql.trim()}${sql.trim().endsWith(';') ? '' : ';'}`);
    if (!decision.existedBefore) {
      statements.push(
        `insert into supabase_migrations.schema_migrations(version, statements, name, created_by, idempotency_key) values (` +
        `${sqlLiteral(migration.ledgerVersion)}, null, ${sqlLiteral(migration.repoFile)}, ${sqlLiteral(CREATED_BY)}, ${sqlLiteral(decision.idempotencyKey)});`,
      );
    }
  }

  const plannedNames = plan.migrations.map((item) => item.repoFile);
  statements.push(
    `do $postledger$ declare missing text[]; begin select array_agg(x) into missing from unnest(${textArray(plannedNames)}) x where not exists (select 1 from supabase_migrations.schema_migrations m where m.name=x); if missing is not null then raise exception 'G3_TEST_POST_LEDGER_MISSING:%', array_to_string(missing, ','); end if; end $postledger$;`,
    'commit;',
  );

  return { sql: statements.join('\n\n'), decisions };
}

async function executeAtomicTestRelease({ token, projectRef = TEST_PROJECT_REF, sql, fetchImpl = fetch } = {}) {
  const target = assertTestReleaseTarget(projectRef);
  if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN is required');
  const response = await fetchImpl(`${API}/v1/projects/${target}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) fail('TEST_RELEASE_APPLY_FAILED', `atomic TEST release validation failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
}

function verifyPostTestLedger(plan, rows) {
  const result = new Map();
  for (const migration of plan.migrations) {
    const matches = rows.filter((row) => row.name === migration.repoFile);
    if (matches.length !== 1) fail('TEST_POST_LEDGER_MISMATCH', `${migration.repoFile} must exist exactly once after G3 validation`);
    result.set(migration.repoFile, matches[0]);
  }
  return result;
}

export async function validateProductionDbReleasePlanOnTest({
  plan,
  token,
  projectRef = TEST_PROJECT_REF,
  sourceRunId,
  sourceRunAttempt,
  repoRoot = process.cwd(),
  fetchImpl = fetch,
  runner = spawnSync,
} = {}) {
  const target = assertTestReleaseTarget(projectRef);
  if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN is required');
  const runId = String(sourceRunId ?? '').trim();
  const runAttempt = Number(sourceRunAttempt);
  if (!runId || !Number.isSafeInteger(runAttempt) || runAttempt < 1) fail('INVALID_TEST_RUN_IDENTITY', 'GitHub run id/attempt are required');
  assertTrustedMainCheckout(plan?.mainSha, repoRoot, runner);
  const aliasMap = readAliasMap(repoRoot);
  const readCanonicalSql = canonicalReader(repoRoot);
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });

  const before = await captureTestProviderLedger({ token, projectRef: target, fetchImpl });
  const built = buildAtomicTestReleaseValidationSql({ plan, aliasMap, liveLedgerRows: before, readCanonicalSql });
  await executeAtomicTestRelease({ token, projectRef: target, sql: built.sql, fetchImpl });
  const after = await captureTestProviderLedger({ token, projectRef: target, fetchImpl });
  const post = verifyPostTestLedger(plan, after);

  return {
    schemaVersion: 1,
    status: 'TEST_RELEASE_PLAN_VERIFIED',
    repository: REPOSITORY,
    testProjectRef: target,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
    releaseId: plan.releaseId,
    sourceRunId: runId,
    sourceRunAttempt: runAttempt,
    migrations: plan.migrations.map((migration) => {
      const decision = built.decisions.find((item) => item.repoFile === migration.repoFile);
      const ledger = post.get(migration.repoFile);
      return {
        repoFile: migration.repoFile,
        sha256: migration.sha256,
        riskTier: migration.riskTier,
        execution: decision.existedBefore ? 'REPLAY_VERIFIED' : 'APPLIED_VERIFIED',
        ledgerVersion: ledger.version,
      };
    }),
    testMutationPerformed: true,
    productionMutationPerformed: false,
    databaseMutationAuthorized: false,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'plan') {
      const [releaseId, mainSha, plannedAt, outputPath] = args;
      if (!releaseId || !mainSha || !plannedAt || !outputPath) fail('USAGE', 'plan <releaseId> <mainSha> <plannedAt> <output.json>');
      const plan = buildTestReleasePlanFromCheckout({ releaseId, mainSha, plannedAt });
      writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    if (command === 'apply') {
      const [planPath, outputPath] = args;
      if (!planPath || !outputPath) fail('USAGE', 'apply <plan.json> <evidence.json>');
      const plan = JSON.parse(readFileSync(planPath, 'utf8'));
      const evidence = await validateProductionDbReleasePlanOnTest({
        plan,
        token: process.env.TEST_DB_RELEASE_TOKEN,
        projectRef: process.env.TEST_PROJECT_REF || TEST_PROJECT_REF,
        sourceRunId: process.env.GITHUB_RUN_ID,
        sourceRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
      });
      writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    fail('USAGE', 'use plan or apply');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('validate-production-db-release-on-test.mjs')) main();

export const G3_TEST_PROJECT_REF = TEST_PROJECT_REF;
