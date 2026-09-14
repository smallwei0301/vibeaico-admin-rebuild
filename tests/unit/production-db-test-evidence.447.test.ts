import { describe, expect, it } from 'vitest';

import { buildProductionDbTestEvidence } from '../../scripts/agents/production-db-test-evidence.mjs';

const REPO = 'smallwei0301/vibeaico-admin-rebuild';
const PROD = 'egehnijjpgijmccagxac';
const TEST = 'nmwhwngojosmagjuvxol';
const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const RUN_ID = '44703';
const RUN_ATTEMPT = 1;
const AUTHZ_FILE = 'tests/integration/db/traveler-risk-policy.44.test.ts';

function plan(migrations: any[] = [
  { repoFile: '0105_issue_44_traveler_risk_policies', riskTier: 'AUTHZ' },
  { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR' },
]) {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260915-447',
    repository: REPO,
    productionProjectRef: PROD,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: migrations.some((item) => item.riskTier === 'AUTHZ') ? 'AUTHZ' : 'SCHEMA_REPAIR',
    migrations,
  };
}

function raw(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'SHARED_TEST_RUN_VERIFIED',
    policySkip: false,
    repository: REPO,
    workflowPath: '.github/workflows/ci.yml',
    event: 'workflow_dispatch',
    dispatchReason: 'main_manual',
    mainSha: MAIN,
    expectedHead: MAIN,
    baseRevision: 'c'.repeat(40),
    testProjectRef: TEST,
    sourceRunId: RUN_ID,
    sourceRunAttempt: RUN_ATTEMPT,
    policyReason: 'main_manual',
    integrationStep: 'PASSED',
    e2eStep: 'PASSED',
    cleanupClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS',
    authzCoverageClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS',
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
    emittedAt: '2026-09-15T00:00:00.000Z',
    ...overrides,
  };
}

function cleanup(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'TEST_CLEANUP_VERIFIED',
    mainSha: MAIN,
    testProjectRef: TEST,
    sourceRunId: RUN_ID,
    sourceRunAttempt: RUN_ATTEMPT,
    cleanup: 'PASSED',
    residueCount: 0,
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
    ...overrides,
  };
}

function coverage(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'TEST_COVERAGE_VERIFIED',
    mainSha: MAIN,
    testProjectRef: TEST,
    sourceRunId: RUN_ID,
    sourceRunAttempt: RUN_ATTEMPT,
    executedTests: 560,
    executedFiles: [AUTHZ_FILE, 'tests/integration/db/tour-order-formation.41.test.ts'],
    migrations: {
      '0105_issue_44_traveler_risk_policies': {
        status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
        executedFiles: [AUTHZ_FILE],
        tenantBoundaryVerified: true,
        negativeRoleTestsPassed: true,
      },
    },
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
    ...overrides,
  };
}

describe('Production DB G3 TEST evidence adapter #447', () => {
  it('builds TEST_VERIFIED only from matching raw run + cleanup + explicit AUTHZ coverage', () => {
    expect(buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: plan(),
    })).toMatchObject({
      status: 'TEST_VERIFIED',
      policySkip: false,
      executedTests: 560,
      cleanup: 'PASSED',
      mainSha: MAIN,
      planDigest: PLAN,
      testProjectRef: TEST,
      sourceRunId: RUN_ID,
      sourceRunAttempt: RUN_ATTEMPT,
      integrationStep: 'PASSED',
      e2eStep: 'PASSED',
      tenantBoundaryVerified: true,
      negativeRoleTestsPassed: true,
      authzMigrationCount: 1,
      databaseMutationAuthorized: false,
    });
  });

  it('never lets raw workflow success self-approve cleanup or AUTHZ', () => {
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw({ cleanupClaim: 'PASSED' }),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: plan(),
    })).toThrow(/RAW_TEST_CLEANUP_OVERCLAIM/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw({ authzCoverageClaim: 'PASSED' }),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: plan(),
    })).toThrow(/RAW_TEST_AUTHZ_OVERCLAIM/);
  });

  it('requires independent zero-residue cleanup evidence from the same exact run', () => {
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: undefined,
      coverageEvidence: coverage(),
      plan: plan(),
    })).toThrow(/TEST_CLEANUP_EVIDENCE_REQUIRED/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup({ residueCount: 1 }),
      coverageEvidence: coverage(),
      plan: plan(),
    })).toThrow(/TEST_CLEANUP_REQUIRED/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup({ sourceRunId: 'other-run' }),
      coverageEvidence: coverage(),
      plan: plan(),
    })).toThrow(/TEST_EVIDENCE_RUN_MISMATCH/);
  });

  it('rejects generic suite-green evidence when 0105 specific AUTHZ test coverage is absent', () => {
    const missing = coverage({
      executedFiles: ['tests/integration/db/other.test.ts'],
      migrations: {
        '0105_issue_44_traveler_risk_policies': {
          status: 'MIGRATION_TEST_COVERAGE_VERIFIED',
          executedFiles: ['tests/integration/db/other.test.ts'],
          tenantBoundaryVerified: true,
          negativeRoleTestsPassed: true,
        },
      },
    });
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup(),
      coverageEvidence: missing,
      plan: plan(),
    })).toThrow(/AUTHZ_REQUIRED_TEST_FILE_MISSING/);
  });

  it('fails closed for an unknown AUTHZ migration instead of inheriting 0105 coverage', () => {
    const unknownPlan = plan([
      { repoFile: '0110_unknown_authz', riskTier: 'AUTHZ' },
    ]);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: unknownPlan,
    })).toThrow(/AUTHZ_TEST_MAPPING_REQUIRED/);
  });

  it('allows SCHEMA_REPAIR to use generic real execution + cleanup without inventing tenant-boundary claims', () => {
    const schemaPlan = plan([
      { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR' },
    ]);
    const result = buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage({ migrations: {} }),
      plan: schemaPlan,
    });
    expect(result).toMatchObject({
      status: 'TEST_VERIFIED',
      tenantBoundaryVerified: false,
      negativeRoleTestsPassed: false,
      authzMigrationCount: 0,
    });
  });

  it('rejects coverage from another main/project/run or an empty executed test set', () => {
    for (const badCoverage of [
      coverage({ mainSha: 'd'.repeat(40) }),
      coverage({ testProjectRef: 'other-test-project' }),
      coverage({ sourceRunAttempt: 2 }),
      coverage({ executedTests: 0 }),
    ]) {
      expect(() => buildProductionDbTestEvidence({
        rawRunEvidence: raw(),
        cleanupEvidence: cleanup(),
        coverageEvidence: badCoverage,
        plan: plan(),
      })).toThrow(/TEST_COVERAGE_|TEST_EVIDENCE_RUN_MISMATCH|EMPTY_TEST_EVIDENCE/);
    }
  });
});
