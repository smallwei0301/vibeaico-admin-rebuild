#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';

const EXPECTED_REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const TEST_HOST = `${TEST_PROJECT_REF}.supabase.co`;
const SHOP_A_ID = 'a1000000-0000-4000-8000-000000000001';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

const AUTHZ_CONTRACTS = Object.freeze({
  '0105_issue_44_traveler_risk_policies': Object.freeze({
    requiredFile: 'tests/integration/db/traveler-risk-policy.44.test.ts',
    tenantBoundaryAssertions: Object.freeze([
      'A owner 指派一筆政策後，B owner 完全查不到',
      'A owner 想寫入 tenant_id=B 店',
    ]),
    negativeRoleAssertions: Object.freeze([
      'STAFF 讀得到，但寫不了',
    ]),
  }),
});

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function exactSha(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact main SHA`);
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

function assertPlan(plan) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  if (plan.repository !== EXPECTED_REPOSITORY) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  if (plan.productionProjectRef !== 'egehnijjpgijmccagxac') fail('WRONG_PROJECT', 'release plan Production project is not canonical');
  const mainSha = exactSha(plan.mainSha, 'plan.mainSha');
  const planDigest = exactDigest(plan.planDigest, 'plan.planDigest');
  if (!String(plan.releaseId ?? '').trim()) fail('RELEASE_ID_REQUIRED', 'releaseId is required');
  if (!Array.isArray(plan.migrations) || !plan.migrations.length) fail('PLAN_MIGRATIONS_REQUIRED', 'release plan has no migrations');
  return { mainSha, planDigest };
}

function repoTestPath(value) {
  const path = String(value ?? '').replaceAll('\\', '/');
  if (path.startsWith('tests/')) return path;
  const marker = '/tests/';
  const index = path.lastIndexOf(marker);
  return index >= 0 ? path.slice(index + 1) : path;
}

function passedAssertions(report) {
  const rows = [];
  for (const file of Array.isArray(report?.testResults) ? report.testResults : []) {
    const filePath = repoTestPath(file?.name ?? file?.testFilePath ?? '');
    for (const assertion of Array.isArray(file?.assertionResults) ? file.assertionResults : []) {
      if (String(assertion?.status ?? '').toLowerCase() !== 'passed') continue;
      rows.push({
        file: filePath,
        name: String(assertion?.fullName ?? assertion?.title ?? '').trim(),
      });
    }
  }
  return rows;
}

function includesAssertion(rows, file, fragment) {
  return rows.some((row) => row.file === file && row.name.includes(fragment));
}

/**
 * Build machine-readable coverage evidence from Vitest's JSON reporter output.
 * The report must represent a completely passing real run. AUTHZ migrations are
 * bound to explicit files and required negative/tenant-boundary assertions.
 *
 * @param {{report: any, plan: any, sourceRunId: string|number, sourceRunAttempt: number}} input
 */
export function buildProductionDbTestCoverageEvidence({ report, plan, sourceRunId, sourceRunAttempt }) {
  const { mainSha } = assertPlan(plan);
  const sourceRun = runIdentity(sourceRunId, sourceRunAttempt);
  if (!report || typeof report !== 'object' || Array.isArray(report)) fail('INVALID_VITEST_REPORT', 'Vitest JSON report is required');
  const total = Number(report.numTotalTests);
  const passed = Number(report.numPassedTests);
  const failed = Number(report.numFailedTests ?? 0);
  const pending = Number(report.numPendingTests ?? 0);
  const todo = Number(report.numTodoTests ?? 0);
  if (report.success !== true || !Number.isSafeInteger(total) || total < 1 || passed !== total || failed !== 0 || pending !== 0 || todo !== 0) {
    fail('INCOMPLETE_VITEST_COVERAGE', `Vitest report must be fully passing: total=${total}, passed=${passed}, failed=${failed}, pending=${pending}, todo=${todo}`);
  }

  const assertions = passedAssertions(report);
  const executedFiles = [...new Set((Array.isArray(report.testResults) ? report.testResults : [])
    .map((item) => repoTestPath(item?.name ?? item?.testFilePath ?? ''))
    .filter(Boolean))].sort();
  if (!executedFiles.length) fail('EMPTY_TEST_FILE_EVIDENCE', 'Vitest report has no executed test files');

  /** @type {Record<string, {status:string, executedFiles:string[], tenantBoundaryVerified:boolean, negativeRoleTestsPassed:boolean}>} */
  const migrations = {};
  for (const migration of plan.migrations) {
    if (String(migration?.riskTier ?? '').trim().toUpperCase() !== 'AUTHZ') continue;
    const repoFile = String(migration?.repoFile ?? '').trim();
    const contract = AUTHZ_CONTRACTS[repoFile];
    if (!contract) fail('AUTHZ_TEST_MAPPING_REQUIRED', `no explicit AUTHZ coverage contract exists for ${repoFile || '<unknown>'}`);
    if (!executedFiles.includes(contract.requiredFile)) {
      fail('AUTHZ_REQUIRED_TEST_FILE_MISSING', `${repoFile} did not execute ${contract.requiredFile}`);
    }
    const tenantBoundaryVerified = contract.tenantBoundaryAssertions.every((fragment) =>
      includesAssertion(assertions, contract.requiredFile, fragment));
    const negativeRoleTestsPassed = contract.negativeRoleAssertions.every((fragment) =>
      includesAssertion(assertions, contract.requiredFile, fragment));
    if (!tenantBoundaryVerified) fail('TENANT_BOUNDARY_TEST_REQUIRED', `${repoFile} required tenant-boundary assertions did not pass`);
    if (!negativeRoleTestsPassed) fail('NEGATIVE_ROLE_TEST_REQUIRED', `${repoFile} required negative-role assertions did not pass`);
    migrations[repoFile] = {
      status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
      executedFiles: [contract.requiredFile],
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    };
  }

  return {
    schemaVersion: 1,
    status: 'TEST_COVERAGE_VERIFIED',
    mainSha,
    testProjectRef: TEST_PROJECT_REF,
    sourceRunId: sourceRun.runId,
    sourceRunAttempt: sourceRun.runAttempt,
    executedTests: total,
    executedFiles,
    migrations,
    reportSuccess: true,
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
  };
}

function canonicalTestUrl(value) {
  let url;
  try {
    url = new URL(String(value ?? ''));
  } catch {
    fail('INVALID_TEST_URL', 'TEST Supabase URL is invalid');
  }
  if (url.protocol !== 'https:' || url.hostname !== TEST_HOST) {
    fail('WRONG_TEST_PROJECT', `cleanup evidence only supports https://${TEST_HOST}`);
  }
  return url.origin;
}

function cleanupScopes(plan) {
  const scopes = [];
  if (plan.migrations.some((migration) => String(migration?.repoFile ?? '') === '0105_issue_44_traveler_risk_policies')) {
    scopes.push({
      migration: '0105_issue_44_traveler_risk_policies',
      table: 'traveler_risk_policies',
      filterColumn: 'tenant_id',
      filterValue: SHOP_A_ID,
    });
  }
  return scopes;
}

/**
 * Read-only cleanup verification for release-specific fixtures. This deliberately
 * does not claim the whole canonical TEST database is globally residue-free.
 *
 * @param {{plan: any, testSupabaseUrl: string, serviceRoleKey: string, sourceRunId: string|number, sourceRunAttempt: number, fetchImpl?: typeof fetch}} input
 */
export async function captureProductionDbTestCleanupEvidence({
  plan,
  testSupabaseUrl,
  serviceRoleKey,
  sourceRunId,
  sourceRunAttempt,
  fetchImpl = fetch,
}) {
  const { mainSha } = assertPlan(plan);
  const sourceRun = runIdentity(sourceRunId, sourceRunAttempt);
  const origin = canonicalTestUrl(testSupabaseUrl);
  const key = String(serviceRoleKey ?? '').trim();
  if (!key) fail('MISSING_TEST_SERVICE_ROLE', 'TEST service-role key is required for read-only cleanup verification');

  const scopes = cleanupScopes(plan);
  let residueCount = 0;
  const checkedScopes = [];
  for (const scope of scopes) {
    const params = new URLSearchParams({ select: 'id' });
    params.set(scope.filterColumn, `eq.${scope.filterValue}`);
    const response = await fetchImpl(`${origin}/rest/v1/${scope.table}?${params.toString()}`, {
      method: 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
      },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(body)) {
      fail('TEST_CLEANUP_READ_FAILED', `${scope.table} cleanup read failed with HTTP ${response.status}`);
    }
    residueCount += body.length;
    checkedScopes.push({
      migration: scope.migration,
      table: scope.table,
      filter: `${scope.filterColumn}=eq.${scope.filterValue}`,
      residueCount: body.length,
    });
  }

  if (residueCount !== 0) fail('TEST_CLEANUP_RESIDUE', `release-specific TEST fixture residue count is ${residueCount}`);
  return {
    schemaVersion: 1,
    status: 'TEST_CLEANUP_VERIFIED',
    mainSha,
    testProjectRef: TEST_PROJECT_REF,
    sourceRunId: sourceRun.runId,
    sourceRunAttempt: sourceRun.runAttempt,
    cleanup: 'PASSED',
    residueCount: 0,
    scopeKind: scopes.length ? 'PRODUCTION_DB_RELEASE_MIGRATION_FIXTURES' : 'NO_RELEASE_SPECIFIC_FIXTURES',
    checkedScopes,
    readOnly: true,
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
  };
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'coverage') {
      const [planPath, inputPath, outputPath] = args;
      if (!planPath || !inputPath || !outputPath) fail('USAGE', 'coverage <plan.json> <vitest-report.json> <output.json>');
      const evidence = buildProductionDbTestCoverageEvidence({
        plan: JSON.parse(readFileSync(planPath, 'utf8')),
        report: JSON.parse(readFileSync(inputPath, 'utf8')),
        sourceRunId: process.env.GITHUB_RUN_ID,
        sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      });
      writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    if (command === 'cleanup') {
      const [planPath, outputOrLegacyPlaceholder, legacyOutputPath] = args;
      const outputPath = legacyOutputPath || outputOrLegacyPlaceholder;
      if (!planPath || !outputPath) fail('USAGE', 'cleanup <plan.json> <output.json> | cleanup <plan.json> <legacy-placeholder> <output.json>');
      const evidence = await captureProductionDbTestCleanupEvidence({
        plan: JSON.parse(readFileSync(planPath, 'utf8')),
        testSupabaseUrl: process.env.TEST_SUPABASE_URL,
        serviceRoleKey: process.env.TEST_SUPABASE_SERVICE_ROLE_KEY,
        sourceRunId: process.env.GITHUB_RUN_ID,
        sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      });
      writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    fail('USAGE', 'use coverage or cleanup');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-g3-test-artifacts.mjs')) main();

export const G3_TEST_AUTHZ_CONTRACTS = AUTHZ_CONTRACTS;
