#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import process from 'node:process';
import {
  getProductionDbG3AuthzContract,
  PRODUCTION_DB_G3_AUTHZ_CONTRACTS,
} from './production-db-g3-authz-contracts.mjs';

const EXPECTED_REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const TEST_HOST = `${TEST_PROJECT_REF}.supabase.co`;
const SHOP_A_ID = 'a1000000-0000-4000-8000-000000000001';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

// These suites are intentionally scoped to LOCAL_ISOLATED PostgreSQL or to the
// pre-0121 downgrade contract.  The shared canonical TEST lane has the current
// schema, so Vitest reports them as pending there even though the real remote
// integration and E2E suites execute normally.  Keep this allowlist narrow and
// bind each entry to its suite title so a newly skipped test cannot silently
// enlarge the G3 evidence boundary.
const CANONICAL_TEST_PENDING_ALLOWLIST = Object.freeze([
  Object.freeze({
    file: 'tests/integration/api/booking-addons.17.test.ts',
    suite: 'schema 尚未套用 migration 0121 時的安全降級',
  }),
  Object.freeze({
    file: 'tests/integration/db/richmenu-asset-retirement.589.test.ts',
    suite: 'Issue #589 real PostgreSQL retirement contract',
  }),
  Object.freeze({
    file: 'tests/integration/db/production-db-writer-mechanics.447.test.ts',
    suite: 'Issue #447 dedicated Production-writer mechanics on isolated PostgreSQL',
  }),
]);

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

function pendingAssertions(report) {
  const rows = [];
  for (const file of Array.isArray(report?.testResults) ? report.testResults : []) {
    const filePath = repoTestPath(file?.name ?? file?.testFilePath ?? '');
    for (const assertion of Array.isArray(file?.assertionResults) ? file.assertionResults : []) {
      const status = String(assertion?.status ?? '').toLowerCase();
      if (status !== 'pending' && status !== 'skipped') continue;
      rows.push({
        file: filePath,
        name: String(assertion?.fullName ?? assertion?.title ?? '').trim(),
      });
    }
  }
  return rows;
}

function isAllowedCanonicalTestPending(row) {
  return CANONICAL_TEST_PENDING_ALLOWLIST.some((entry) =>
    row.file === entry.file && row.name.includes(entry.suite));
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
  const counts = [total, passed, failed, pending, todo];
  if (report.success !== true || counts.some((value) => !Number.isSafeInteger(value) || value < 0) || total < 1
    || passed + failed + pending + todo !== total || failed !== 0 || todo !== 0) {
    fail('INCOMPLETE_VITEST_COVERAGE', `Vitest report must be fully passing apart from the explicit canonical-TEST pending allowlist: total=${total}, passed=${passed}, failed=${failed}, pending=${pending}, todo=${todo}`);
  }

  const pendingRows = pendingAssertions(report);
  if (pendingRows.length !== pending) {
    fail('INCOMPLETE_VITEST_COVERAGE', `Vitest reported ${pending} pending tests but exposed ${pendingRows.length} pending assertion rows`);
  }
  const unapprovedPending = pendingRows.filter((row) => !isAllowedCanonicalTestPending(row));
  if (unapprovedPending.length) {
    fail('UNAPPROVED_VITEST_PENDING', `canonical TEST pending assertions are outside the explicit allowlist: ${unapprovedPending.map((row) => `${row.file}:${row.name}`).join(' | ')}`);
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
    const contract = getProductionDbG3AuthzContract(repoFile);
    if (!contract) fail('AUTHZ_TEST_MAPPING_REQUIRED', `no explicit AUTHZ coverage contract exists for ${repoFile || '<unknown>'}`);
    for (const requiredFile of contract.requiredFiles) {
      if (!executedFiles.includes(requiredFile)) {
        fail('AUTHZ_REQUIRED_TEST_FILE_MISSING', `${repoFile} did not execute ${requiredFile}`);
      }
    }
    const tenantBoundaryVerified = contract.tenantBoundaryAssertions.every((assertion) =>
      includesAssertion(assertions, assertion.file, assertion.fragment));
    const negativeRoleTestsPassed = contract.negativeRoleAssertions.every((assertion) =>
      includesAssertion(assertions, assertion.file, assertion.fragment));
    if (!tenantBoundaryVerified) fail('TENANT_BOUNDARY_TEST_REQUIRED', `${repoFile} required tenant-boundary assertions did not pass`);
    if (!negativeRoleTestsPassed) fail('NEGATIVE_ROLE_TEST_REQUIRED', `${repoFile} required negative-role assertions did not pass`);
    migrations[repoFile] = {
      status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
      executedFiles: [...contract.requiredFiles],
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
    executedTests: passed,
    totalTests: total,
    pendingTests: pending,
    allowedPendingTests: pendingRows.length,
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
  if (plan.migrations.some((migration) => String(migration?.repoFile ?? '') === '0115_issue_21_external_calendars')) {
    scopes.push({
      migration: '0115_issue_21_external_calendars',
      table: 'external_calendars',
      filterColumn: 'name',
      filterOperator: 'like',
      filterValue: '[G3-447] external-calendar%',
    });
  }
  if (plan.migrations.some((migration) => String(migration?.repoFile ?? '') === '0116_issue_18_owner_notify')) {
    scopes.push({
      migration: '0116_issue_18_owner_notify',
      table: 'line_users',
      // line_users uses the composite (tenant_id, line_user_id) primary key;
      // it deliberately has no synthetic id column.
      select: 'tenant_id,line_user_id',
      filterColumn: 'line_user_id',
      filterOperator: 'like',
      filterValue: 'g3-447-owner-notify-%',
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
    const params = new URLSearchParams({ select: scope.select ?? 'id' });
    params.set(scope.filterColumn, `${scope.filterOperator ?? 'eq'}.${scope.filterValue}`);
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
      filter: `${scope.filterColumn}=${scope.filterOperator ?? 'eq'}.${scope.filterValue}`,
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

export const G3_TEST_AUTHZ_CONTRACTS = PRODUCTION_DB_G3_AUTHZ_CONTRACTS;
