import { describe, expect, it } from 'vitest';

import { buildProductionDbTestEvidence as buildProductionDbTestEvidenceRaw } from '../../scripts/agents/production-db-test-evidence.mjs';

const REPO = 'smallwei0301/vibeaico-admin-rebuild';
const PROD = 'egehnijjpgijmccagxac';
const TEST = 'nmwhwngojosmagjuvxol';
const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const RUN_ID = '44703';
const RUN_ATTEMPT = 1;
const AUTHZ_FILE = 'tests/integration/db/traveler-risk-policy.44.test.ts';
const SHA_0105 = '1'.repeat(64);
const SHA_0109 = '2'.repeat(64);

function plan(migrations: any[] = [
  { repoFile: '0105_issue_44_traveler_risk_policies', riskTier: 'AUTHZ', sha256: SHA_0105 },
  { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: SHA_0109 },
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

function releasePlanEvidence(forPlan = plan(), overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'TEST_RELEASE_PLAN_VERIFIED',
    repository: REPO,
    testProjectRef: TEST,
    mainSha: MAIN,
    planDigest: forPlan.planDigest,
    releaseId: forPlan.releaseId,
    sourceRunId: RUN_ID,
    sourceRunAttempt: RUN_ATTEMPT,
    migrations: forPlan.migrations.map((migration: any, index: number) => ({
      repoFile: migration.repoFile,
      sha256: migration.sha256,
      riskTier: migration.riskTier,
      execution: index === 0 ? 'REPLAY_VERIFIED' : 'APPLIED_VERIFIED',
      ledgerVersion: `20260915000${index}00`,
    })),
    testMutationPerformed: true,
    productionMutationPerformed: false,
    databaseMutationAuthorized: false,
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

function postTestSchema(forPlan = plan(), overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'TEST_POST_APPLY_SCHEMA_CAPTURED',
    repository: REPO,
    testProjectRef: TEST,
    mainSha: MAIN,
    planDigest: forPlan.planDigest,
    releaseId: forPlan.releaseId,
    sourceRunId: RUN_ID,
    sourceRunAttempt: RUN_ATTEMPT,
    observedAt: '2026-09-15T00:10:00.000Z',
    captureDigest: '4'.repeat(64),
    migrationLedgerDigest: '5'.repeat(64),
    plannedMigrations: forPlan.migrations.map((migration: any, index: number) => ({
      repoFile: migration.repoFile,
      ledgerVersion: `20260915000${index}00`,
    })),
    comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED',
    readOnly: true,
    databaseMutationAuthorized: false,
    productionMutationPerformed: false,
    ...overrides,
  };
}

function buildProductionDbTestEvidence(input: any) {
  const forPlan = input?.plan ?? plan();
  return buildProductionDbTestEvidenceRaw({
    postTestSchemaEvidence: postTestSchema(forPlan),
    ...input,
  });
}

describe('Production DB G3 TEST evidence adapter #447', () => {
  it('builds TEST_VERIFIED only from matching raw run + exact release-plan TEST execution + cleanup + coverage + post-TEST schema capture', () => {
    const lockedPlan = plan();
    expect(buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
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
      releasePlanEvidenceStatus: 'TEST_RELEASE_PLAN_VERIFIED',
      postTestSchemaEvidenceStatus: 'TEST_POST_APPLY_SCHEMA_CAPTURED',
      postTestSchemaComparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED',
      databaseMutationAuthorized: false,
    });
  });

  it('requires exact release-plan TEST execution from the same plan and run', () => {
    const lockedPlan = plan();
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: undefined,
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_RELEASE_PLAN_EVIDENCE_REQUIRED/);

    const wrongBytes = releasePlanEvidence(lockedPlan, {
      migrations: lockedPlan.migrations.map((migration: any) => ({
        repoFile: migration.repoFile,
        sha256: migration.repoFile.startsWith('0105') ? '9'.repeat(64) : migration.sha256,
        riskTier: migration.riskTier,
        execution: 'REPLAY_VERIFIED',
      })),
    });
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: wrongBytes,
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_RELEASE_PLAN_BYTES_MISMATCH/);

    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan, { sourceRunId: 'other-run' }),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_EVIDENCE_RUN_MISMATCH/);
  });

  it('never lets raw workflow success self-approve cleanup or AUTHZ', () => {
    const lockedPlan = plan();
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw({ cleanupClaim: 'PASSED' }),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/RAW_TEST_CLEANUP_OVERCLAIM/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw({ authzCoverageClaim: 'PASSED' }),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/RAW_TEST_AUTHZ_OVERCLAIM/);
  });

  it('requires independent zero-residue cleanup evidence from the same exact run', () => {
    const lockedPlan = plan();
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: undefined,
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_CLEANUP_EVIDENCE_REQUIRED/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup({ residueCount: 1 }),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_CLEANUP_REQUIRED/);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup({ sourceRunId: 'other-run' }),
      coverageEvidence: coverage(),
      plan: lockedPlan,
    })).toThrow(/TEST_EVIDENCE_RUN_MISMATCH/);
  });

  it('rejects generic suite-green evidence when 0105 specific AUTHZ test coverage is absent', () => {
    const lockedPlan = plan();
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
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: missing,
      plan: lockedPlan,
    })).toThrow(/AUTHZ_REQUIRED_TEST_FILE_MISSING/);
  });

  it('fails closed for an unknown AUTHZ migration instead of inheriting 0105 coverage', () => {
    const unknownPlan = plan([
      { repoFile: '0110_unknown_authz', riskTier: 'AUTHZ', sha256: '3'.repeat(64) },
    ]);
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(unknownPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      plan: unknownPlan,
    })).toThrow(/AUTHZ_TEST_MAPPING_REQUIRED/);
  });

  it('allows SCHEMA_REPAIR to use generic real execution + cleanup without inventing tenant-boundary claims', () => {
    const schemaPlan = plan([
      { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: SHA_0109 },
    ]);
    const result = buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(schemaPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage({ migrations: {} }),
      plan: schemaPlan,
    });
    expect(result).toMatchObject({
      status: 'TEST_VERIFIED',
      tenantBoundaryVerified: false,
      negativeRoleTestsPassed: false,
      authzMigrationCount: 0,
      postTestSchemaEvidenceStatus: 'TEST_POST_APPLY_SCHEMA_CAPTURED',
    });
  });

  it('rejects coverage from another main/project/run or an empty executed test set', () => {
    const lockedPlan = plan();
    for (const badCoverage of [
      coverage({ mainSha: 'd'.repeat(40) }),
      coverage({ testProjectRef: 'other-test-project' }),
      coverage({ sourceRunAttempt: 2 }),
      coverage({ executedTests: 0 }),
    ]) {
      expect(() => buildProductionDbTestEvidence({
        rawRunEvidence: raw(),
        releasePlanEvidence: releasePlanEvidence(lockedPlan),
        cleanupEvidence: cleanup(),
        coverageEvidence: badCoverage,
        plan: lockedPlan,
      })).toThrow(/TEST_COVERAGE_|TEST_EVIDENCE_RUN_MISMATCH|EMPTY_TEST_EVIDENCE/);
    }
  });

  it('requires post-TEST schema capture from the same release/main/run and forbids claiming G2 compare', () => {
    const lockedPlan = plan();
    expect(() => buildProductionDbTestEvidence({
      rawRunEvidence: raw(),
      releasePlanEvidence: releasePlanEvidence(lockedPlan),
      cleanupEvidence: cleanup(),
      coverageEvidence: coverage(),
      postTestSchemaEvidence: undefined,
      plan: lockedPlan,
    })).toThrow(/POST_TEST_SCHEMA_EVIDENCE_REQUIRED/);

    for (const bad of [
      postTestSchema(lockedPlan, { mainSha: 'd'.repeat(40) }),
      postTestSchema(lockedPlan, { planDigest: 'e'.repeat(64) }),
      postTestSchema(lockedPlan, { sourceRunAttempt: 2 }),
      postTestSchema(lockedPlan, { comparisonClaim: 'G2_CONSISTENCY_VERIFIED' }),
      postTestSchema(lockedPlan, { plannedMigrations: [] }),
    ]) {
      expect(() => buildProductionDbTestEvidence({
        rawRunEvidence: raw(),
        releasePlanEvidence: releasePlanEvidence(lockedPlan),
        cleanupEvidence: cleanup(),
        coverageEvidence: coverage(),
        postTestSchemaEvidence: bad,
        plan: lockedPlan,
      })).toThrow(/POST_TEST_SCHEMA_|TEST_EVIDENCE_RUN_MISMATCH/);
    }
  });
});
