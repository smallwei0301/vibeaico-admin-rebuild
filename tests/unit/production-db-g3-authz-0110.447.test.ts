import { describe, expect, it } from 'vitest';

import { buildProductionDbTestCoverageEvidence } from '../../scripts/agents/production-db-g3-test-artifacts.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const AUTHZ_FILE = 'tests/integration/api/tour-order-authz.447.test.ts';
const SETTINGS_FILE = 'tests/integration/api/plan-advanced-settings.10.test.ts';
const ORDERS_FILE = 'tests/integration/api/tour-orders.10.test.ts';

function plan() {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260915-0110-authz',
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'AUTHZ',
    migrations: [{
      repoFile: '0110_issue_42_plan_duration_pricetype_yearround',
      riskTier: 'AUTHZ',
      sha256: '1'.repeat(64),
    }],
  };
}

function testResult(name: string, assertions: string[]) {
  return {
    name: `/home/runner/work/repo/repo/${name}`,
    assertionResults: assertions.map((fullName) => ({ status: 'passed', fullName })),
  };
}

function report() {
  const testResults = [
    testResult(AUTHZ_FILE, [
      '#447 / 0110 create_tour_order AUTHZ boundary STAFF cannot use the MANAGER-only manual-order route',
      '#447 / 0110 create_tour_order AUTHZ boundary cross-tenant owner cannot use another tenant departure',
      '#447 / 0110 create_tour_order AUTHZ boundary authenticated role cannot invoke SECURITY DEFINER create_tour_order directly',
    ]),
    testResult(SETTINGS_FILE, [
      '#42 Advanced Settings persistence 持久化時長／計價方式／全年販售，重新 GET 後值不變',
    ]),
    testResult(ORDERS_FILE, [
      '建單佔名額，且名額由 DB 原子扣減 別家店的團次 → 404，且不扣名額',
    ]),
  ];
  const total = testResults.reduce((sum, item) => sum + item.assertionResults.length, 0);
  return {
    numTotalTests: total,
    numPassedTests: total,
    numFailedTests: 0,
    numPendingTests: 0,
    numTodoTests: 0,
    success: true,
    testResults,
  };
}

function build(input = report()) {
  return buildProductionDbTestCoverageEvidence({
    report: input,
    plan: plan(),
    sourceRunId: '34929999999',
    sourceRunAttempt: 1,
  });
}

describe('Production DB G3 AUTHZ contract for current-main 0110 #447', () => {
  it('requires the AUTHZ boundary, pricing persistence, and tour-order invariant integration files together', () => {
    const result = build();
    expect(result.migrations['0110_issue_42_plan_duration_pricetype_yearround']).toEqual({
      status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
      executedFiles: [AUTHZ_FILE, SETTINGS_FILE, ORDERS_FILE],
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
    });
    expect(result.executedFiles).toEqual([AUTHZ_FILE, SETTINGS_FILE, ORDERS_FILE].sort());
  });

  it.each([AUTHZ_FILE, SETTINGS_FILE, ORDERS_FILE])('fails closed when required file %s did not execute', (missing) => {
    const input = report();
    input.testResults = input.testResults.filter((item) => !item.name.endsWith(missing));
    const total = input.testResults.reduce((sum, item) => sum + item.assertionResults.length, 0);
    input.numTotalTests = total;
    input.numPassedTests = total;
    expect(() => build(input)).toThrow(/AUTHZ_REQUIRED_TEST_FILE_MISSING/);
  });

  it('fails closed when the cross-tenant assertion is missing', () => {
    const input = report();
    const authz = input.testResults.find((item) => item.name.endsWith(AUTHZ_FILE))!;
    authz.assertionResults = authz.assertionResults.filter((item) => !item.fullName.includes('cross-tenant owner cannot use another tenant departure'));
    input.numTotalTests -= 1;
    input.numPassedTests -= 1;
    expect(() => build(input)).toThrow(/TENANT_BOUNDARY_TEST_REQUIRED/);
  });

  it.each([
    'STAFF cannot use the MANAGER-only manual-order route',
    'authenticated role cannot invoke SECURITY DEFINER create_tour_order directly',
  ])('fails closed when negative-role assertion is missing: %s', (fragment) => {
    const input = report();
    const authz = input.testResults.find((item) => item.name.endsWith(AUTHZ_FILE))!;
    authz.assertionResults = authz.assertionResults.filter((item) => !item.fullName.includes(fragment));
    input.numTotalTests -= 1;
    input.numPassedTests -= 1;
    expect(() => build(input)).toThrow(/NEGATIVE_ROLE_TEST_REQUIRED/);
  });
});
