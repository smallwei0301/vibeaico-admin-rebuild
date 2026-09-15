const EXPECTED_REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;

const AUTHZ_TEST_CONTRACTS = Object.freeze({
  '0105_issue_44_traveler_risk_policies': Object.freeze({
    requiredFile: 'tests/integration/db/traveler-risk-policy.44.test.ts',
    requireTenantBoundary: true,
    requireNegativeRole: true,
  }),
});

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

function runIdentity(evidence, label) {
  const runId = String(evidence?.sourceRunId ?? '').trim();
  const runAttempt = Number(evidence?.sourceRunAttempt);
  if (!runId || !Number.isSafeInteger(runAttempt) || runAttempt < 1) {
    fail('INVALID_TEST_RUN_IDENTITY', `${label} has no valid GitHub run identity`);
  }
  return { runId, runAttempt };
}

function assertSameRun(evidence, expected, label) {
  const identity = runIdentity(evidence, label);
  if (identity.runId !== expected.runId || identity.runAttempt !== expected.runAttempt) {
    fail('TEST_EVIDENCE_RUN_MISMATCH', `${label} belongs to another GitHub run`);
  }
}

function assertReleasePlanExecutionEvidence(releasePlanEvidence, plan, sourceRun, mainSha, planDigest) {
  if (!releasePlanEvidence || releasePlanEvidence.status !== 'TEST_RELEASE_PLAN_VERIFIED') {
    fail('TEST_RELEASE_PLAN_EVIDENCE_REQUIRED', 'exact release-plan execution evidence on canonical TEST is required');
  }
  if (releasePlanEvidence.repository !== EXPECTED_REPOSITORY) {
    fail('TEST_RELEASE_PLAN_REPOSITORY_MISMATCH', 'release-plan TEST evidence belongs to another repository');
  }
  if (releasePlanEvidence.testProjectRef !== TEST_PROJECT_REF) {
    fail('TEST_RELEASE_PLAN_PROJECT_MISMATCH', 'release-plan TEST evidence belongs to another TEST project');
  }
  if (exactSha(releasePlanEvidence.mainSha, 'releasePlanEvidence.mainSha') !== mainSha) {
    fail('TEST_RELEASE_PLAN_MAIN_MISMATCH', 'release-plan TEST evidence belongs to another main SHA');
  }
  if (exactDigest(releasePlanEvidence.planDigest, 'releasePlanEvidence.planDigest') !== planDigest) {
    fail('TEST_RELEASE_PLAN_DIGEST_MISMATCH', 'release-plan TEST evidence belongs to another plan');
  }
  if (String(releasePlanEvidence.releaseId ?? '').trim() !== String(plan.releaseId ?? '').trim()) {
    fail('TEST_RELEASE_ID_MISMATCH', 'release-plan TEST evidence belongs to another release');
  }
  assertSameRun(releasePlanEvidence, sourceRun, 'releasePlanEvidence');
  if (releasePlanEvidence.testMutationPerformed !== true || releasePlanEvidence.productionMutationPerformed !== false) {
    fail('TEST_RELEASE_PLAN_SCOPE_MISMATCH', 'release-plan evidence must prove TEST execution and zero Production mutation');
  }
  if (releasePlanEvidence.databaseMutationAuthorized !== false) {
    fail('TEST_RELEASE_PLAN_SCOPE_ESCALATION', 'release-plan TEST evidence must not authorize Production mutation');
  }

  const observed = Array.isArray(releasePlanEvidence.migrations) ? releasePlanEvidence.migrations : [];
  if (observed.length !== plan.migrations.length) {
    fail('TEST_RELEASE_PLAN_MIGRATION_COUNT_MISMATCH', 'release-plan TEST evidence migration count differs from the locked plan');
  }
  for (const migration of plan.migrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    const match = observed.filter((entry) => String(entry?.repoFile ?? '').trim() === repoFile);
    if (match.length !== 1) fail('TEST_RELEASE_PLAN_MIGRATION_MISSING', `${repoFile || '<unknown>'} is not uniquely represented in TEST release evidence`);
    const entry = match[0];
    if (String(entry?.sha256 ?? '').trim().toLowerCase() !== String(migration?.sha256 ?? '').trim().toLowerCase()) {
      fail('TEST_RELEASE_PLAN_BYTES_MISMATCH', `${repoFile} TEST execution used different migration bytes`);
    }
    if (String(entry?.riskTier ?? '').trim().toUpperCase() !== String(migration?.riskTier ?? '').trim().toUpperCase()) {
      fail('TEST_RELEASE_PLAN_RISK_MISMATCH', `${repoFile} TEST execution used a different risk classification`);
    }
    if (!['APPLIED_VERIFIED', 'REPLAY_VERIFIED'].includes(String(entry?.execution ?? '').trim().toUpperCase())) {
      fail('TEST_RELEASE_PLAN_EXECUTION_UNVERIFIED', `${repoFile} has no verified TEST apply/replay result`);
    }
  }
}

function assertPostTestSchemaEvidence(postTestSchemaEvidence, plan, sourceRun, mainSha, planDigest) {
  if (!postTestSchemaEvidence || postTestSchemaEvidence.status !== 'TEST_POST_APPLY_SCHEMA_CAPTURED') {
    fail('POST_TEST_SCHEMA_EVIDENCE_REQUIRED', 'fresh post-TEST schema capture evidence is required');
  }
  if (postTestSchemaEvidence.repository !== EXPECTED_REPOSITORY) {
    fail('POST_TEST_SCHEMA_REPOSITORY_MISMATCH', 'post-TEST schema evidence belongs to another repository');
  }
  if (postTestSchemaEvidence.testProjectRef !== TEST_PROJECT_REF) {
    fail('POST_TEST_SCHEMA_PROJECT_MISMATCH', 'post-TEST schema evidence belongs to another TEST project');
  }
  if (exactSha(postTestSchemaEvidence.mainSha, 'postTestSchema.mainSha') !== mainSha) {
    fail('POST_TEST_SCHEMA_MAIN_MISMATCH', 'post-TEST schema evidence belongs to another main SHA');
  }
  if (exactDigest(postTestSchemaEvidence.planDigest, 'postTestSchema.planDigest') !== planDigest) {
    fail('POST_TEST_SCHEMA_PLAN_MISMATCH', 'post-TEST schema evidence belongs to another release plan');
  }
  if (String(postTestSchemaEvidence.releaseId ?? '').trim() !== String(plan.releaseId ?? '').trim()) {
    fail('POST_TEST_SCHEMA_RELEASE_MISMATCH', 'post-TEST schema evidence belongs to another release');
  }
  assertSameRun(postTestSchemaEvidence, sourceRun, 'postTestSchemaEvidence');
  if (postTestSchemaEvidence.comparisonClaim !== 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED') {
    fail('POST_TEST_SCHEMA_COMPARISON_OVERCLAIM', 'G3 post-TEST evidence must not claim the G2 three-way comparison');
  }
  if (postTestSchemaEvidence.readOnly !== true || postTestSchemaEvidence.databaseMutationAuthorized !== false || postTestSchemaEvidence.productionMutationPerformed !== false) {
    fail('POST_TEST_SCHEMA_SCOPE_ESCALATION', 'post-TEST schema evidence must remain read-only and non-Production');
  }
  exactDigest(postTestSchemaEvidence.captureDigest, 'postTestSchema.captureDigest');
  exactDigest(postTestSchemaEvidence.migrationLedgerDigest, 'postTestSchema.migrationLedgerDigest');
  if (!Number.isFinite(Date.parse(String(postTestSchemaEvidence.observedAt ?? '')))) {
    fail('POST_TEST_SCHEMA_TIMESTAMP_REQUIRED', 'post-TEST schema observedAt is invalid');
  }

  const observed = Array.isArray(postTestSchemaEvidence.plannedMigrations) ? postTestSchemaEvidence.plannedMigrations : [];
  if (observed.length !== plan.migrations.length) {
    fail('POST_TEST_SCHEMA_MIGRATION_COUNT_MISMATCH', 'post-TEST schema evidence migration count differs from the locked plan');
  }
  for (const migration of plan.migrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    const matches = observed.filter((entry) => String(entry?.repoFile ?? '').trim() === repoFile);
    if (matches.length !== 1 || !String(matches[0]?.ledgerVersion ?? '').trim()) {
      fail('POST_TEST_SCHEMA_LEDGER_MISMATCH', `${repoFile || '<unknown>'} is not uniquely represented in the post-TEST ledger evidence`);
    }
  }
}

/**
 * Convert trusted-main shared TEST raw evidence, exact release-plan execution,
 * independent cleanup/coverage and a fresh post-TEST schema recapture into the
 * TEST_VERIFIED shape consumed by release preflight. Generic workflow success is
 * never enough for migration execution, cleanup, AUTHZ or schema recapture claims.
 *
 * @param {{rawRunEvidence?: any, releasePlanEvidence?: any, postTestSchemaEvidence?: any, cleanupEvidence?: any, coverageEvidence?: any, plan?: any}} [input]
 */
export function buildProductionDbTestEvidence({
  rawRunEvidence,
  releasePlanEvidence,
  postTestSchemaEvidence,
  cleanupEvidence,
  coverageEvidence,
  plan,
} = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  if (plan.repository !== EXPECTED_REPOSITORY) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  if (plan.productionProjectRef !== PRODUCTION_PROJECT_REF) fail('WRONG_PROJECT', 'release plan project is not canonical Production');
  const mainSha = exactSha(plan.mainSha, 'plan.mainSha');
  const planDigest = exactDigest(plan.planDigest, 'plan.planDigest');
  if (!Array.isArray(plan.migrations) || !plan.migrations.length) fail('PLAN_MIGRATIONS_REQUIRED', 'release plan has no migrations');

  if (!rawRunEvidence || rawRunEvidence.status !== 'SHARED_TEST_RUN_VERIFIED') {
    fail('SHARED_TEST_RAW_EVIDENCE_REQUIRED', 'trusted shared TEST raw evidence is required');
  }
  if (rawRunEvidence.policySkip !== false) fail('TEST_POLICY_SKIP', 'POLICY_SKIP is not TEST evidence');
  if (rawRunEvidence.repository !== EXPECTED_REPOSITORY) fail('TEST_REPOSITORY_MISMATCH', 'raw TEST evidence belongs to another repository');
  if (rawRunEvidence.workflowPath !== '.github/workflows/ci.yml') fail('UNTRUSTED_TEST_WORKFLOW', 'raw TEST evidence must come from ci.yml');
  if (rawRunEvidence.event !== 'workflow_dispatch' || rawRunEvidence.dispatchReason !== 'main_manual') {
    fail('UNTRUSTED_TEST_DISPATCH', 'release TEST evidence must come from trusted main_manual dispatch');
  }
  if (exactSha(rawRunEvidence.mainSha, 'raw.mainSha') !== mainSha || exactSha(rawRunEvidence.expectedHead, 'raw.expectedHead') !== mainSha) {
    fail('TEST_MAIN_MISMATCH', 'raw TEST evidence is for another main SHA');
  }
  if (rawRunEvidence.testProjectRef !== TEST_PROJECT_REF) fail('TEST_PROJECT_MISMATCH', 'raw TEST evidence is for another TEST project');
  if (rawRunEvidence.integrationStep !== 'PASSED' || rawRunEvidence.e2eStep !== 'PASSED') {
    fail('TEST_EXECUTION_INCOMPLETE', 'integration and E2E must both execute successfully');
  }
  if (rawRunEvidence.cleanupClaim !== 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS') fail('RAW_TEST_CLEANUP_OVERCLAIM', 'raw workflow artifact may not self-approve cleanup');
  if (rawRunEvidence.authzCoverageClaim !== 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS') fail('RAW_TEST_AUTHZ_OVERCLAIM', 'raw workflow artifact may not self-approve AUTHZ coverage');
  if (rawRunEvidence.databaseMutationAuthorized !== false || rawRunEvidence.productionMutationPerformed !== false) {
    fail('RAW_TEST_SCOPE_ESCALATION', 'raw TEST evidence must not authorize or claim Production mutation');
  }
  const sourceRun = runIdentity(rawRunEvidence, 'rawRunEvidence');

  assertReleasePlanExecutionEvidence(releasePlanEvidence, plan, sourceRun, mainSha, planDigest);

  if (!cleanupEvidence || cleanupEvidence.status !== 'TEST_CLEANUP_VERIFIED') fail('TEST_CLEANUP_EVIDENCE_REQUIRED', 'independent TEST cleanup evidence is required');
  if (exactSha(cleanupEvidence.mainSha, 'cleanup.mainSha') !== mainSha) fail('TEST_CLEANUP_MAIN_MISMATCH', 'cleanup evidence is for another main SHA');
  if (cleanupEvidence.testProjectRef !== TEST_PROJECT_REF) fail('TEST_CLEANUP_PROJECT_MISMATCH', 'cleanup evidence is for another TEST project');
  assertSameRun(cleanupEvidence, sourceRun, 'cleanupEvidence');
  if (cleanupEvidence.cleanup !== 'PASSED' || cleanupEvidence.residueCount !== 0) fail('TEST_CLEANUP_REQUIRED', 'TEST cleanup must independently prove zero scoped residue');
  if (cleanupEvidence.databaseMutationAuthorized !== false || cleanupEvidence.productionMutationPerformed !== false) {
    fail('TEST_CLEANUP_SCOPE_ESCALATION', 'cleanup evidence must remain TEST/read-only admission evidence');
  }

  if (!coverageEvidence || coverageEvidence.status !== 'TEST_COVERAGE_VERIFIED') fail('TEST_COVERAGE_EVIDENCE_REQUIRED', 'independent TEST coverage evidence is required');
  if (exactSha(coverageEvidence.mainSha, 'coverage.mainSha') !== mainSha) fail('TEST_COVERAGE_MAIN_MISMATCH', 'coverage evidence is for another main SHA');
  if (coverageEvidence.testProjectRef !== TEST_PROJECT_REF) fail('TEST_COVERAGE_PROJECT_MISMATCH', 'coverage evidence is for another TEST project');
  assertSameRun(coverageEvidence, sourceRun, 'coverageEvidence');
  if (!Number.isSafeInteger(coverageEvidence.executedTests) || coverageEvidence.executedTests < 1) fail('EMPTY_TEST_EVIDENCE', 'coverage evidence must prove at least one real executed test');
  if (!Array.isArray(coverageEvidence.executedFiles) || !coverageEvidence.executedFiles.length) fail('EMPTY_TEST_FILE_EVIDENCE', 'coverage evidence must identify executed test files');
  if (coverageEvidence.databaseMutationAuthorized !== false || coverageEvidence.productionMutationPerformed !== false) {
    fail('TEST_COVERAGE_SCOPE_ESCALATION', 'coverage evidence must not authorize or claim Production mutation');
  }

  const authzMigrations = plan.migrations.filter((entry) => String(entry?.riskTier ?? '').toUpperCase() === 'AUTHZ');
  let tenantBoundaryVerified = false;
  let negativeRoleTestsPassed = false;
  for (const migration of authzMigrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    const contract = AUTHZ_TEST_CONTRACTS[repoFile];
    if (!contract) fail('AUTHZ_TEST_MAPPING_REQUIRED', `no explicit AUTHZ TEST contract exists for ${repoFile || '<unknown>'}`);
    const perMigration = coverageEvidence.migrations?.[repoFile];
    if (!perMigration || perMigration.status !== 'MIGRATION_TEST_COVERAGE_VERIFIED') {
      fail('AUTHZ_TEST_COVERAGE_REQUIRED', `${repoFile} has no migration-specific coverage evidence`);
    }
    const files = Array.isArray(perMigration.executedFiles) ? perMigration.executedFiles.map(String) : [];
    if (!files.includes(contract.requiredFile) || !coverageEvidence.executedFiles.map(String).includes(contract.requiredFile)) {
      fail('AUTHZ_REQUIRED_TEST_FILE_MISSING', `${repoFile} did not execute ${contract.requiredFile}`);
    }
    if (contract.requireTenantBoundary && perMigration.tenantBoundaryVerified !== true) {
      fail('TENANT_BOUNDARY_TEST_REQUIRED', `${repoFile} lacks explicit tenant-boundary evidence`);
    }
    if (contract.requireNegativeRole && perMigration.negativeRoleTestsPassed !== true) {
      fail('NEGATIVE_ROLE_TEST_REQUIRED', `${repoFile} lacks explicit negative-role evidence`);
    }
  }
  if (authzMigrations.length) {
    tenantBoundaryVerified = true;
    negativeRoleTestsPassed = true;
  }

  assertPostTestSchemaEvidence(postTestSchemaEvidence, plan, sourceRun, mainSha, planDigest);

  return {
    status: 'TEST_VERIFIED',
    policySkip: false,
    executedTests: coverageEvidence.executedTests,
    cleanup: 'PASSED',
    mainSha,
    planDigest,
    testProjectRef: TEST_PROJECT_REF,
    sourceRunId: sourceRun.runId,
    sourceRunAttempt: sourceRun.runAttempt,
    integrationStep: 'PASSED',
    e2eStep: 'PASSED',
    tenantBoundaryVerified,
    negativeRoleTestsPassed,
    authzMigrationCount: authzMigrations.length,
    releasePlanEvidenceStatus: releasePlanEvidence.status,
    cleanupEvidenceStatus: cleanupEvidence.status,
    coverageEvidenceStatus: coverageEvidence.status,
    postTestSchemaEvidenceStatus: postTestSchemaEvidence.status,
    postTestSchemaComparisonClaim: postTestSchemaEvidence.comparisonClaim,
    databaseMutationAuthorized: false,
  };
}

export const PRODUCTION_DB_AUTHZ_TEST_CONTRACTS = AUTHZ_TEST_CONTRACTS;
