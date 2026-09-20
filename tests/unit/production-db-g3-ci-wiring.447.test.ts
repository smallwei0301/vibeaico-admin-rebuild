import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/ci.yml', 'utf8');
const position = (text: string) => {
  const index = source.indexOf(text);
  expect(index, `missing workflow contract: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
};

describe('Production DB G3 trusted-main CI wiring #447', () => {
  it('keeps release mode explicit and restricted to main_manual on main', () => {
    expect(source).toContain('production_db_release_id:');
    expect(source).toContain('production_db_planned_at:');
    const releaseStep = source.slice(position('- name: Validate exact Production DB release plan on canonical TEST'));
    const condition = releaseStep.slice(0, releaseStep.indexOf('shell: bash'));
    expect(condition).toContain("github.event_name == 'workflow_dispatch'");
    expect(condition).toContain("github.ref == 'refs/heads/main'");
    expect(condition).toContain("inputs.dispatch_reason == 'main_manual'");
    expect(condition).toContain("inputs.production_db_release_id != ''");
    expect(condition).toContain("inputs.production_db_planned_at != ''");
    expect(source).toContain("needs.classify-changes.outputs.run_test_validation == 'true'");
    expect(source).toContain("needs.classify-changes.outputs.docs_only == 'true' && needs.classify-changes.outputs.run_test_validation != 'true'");
  });

  it('uses only the dedicated TEST release token for the Management API TEST writer', () => {
    const releaseStart = position('- name: Validate exact Production DB release plan on canonical TEST');
    const integrationStart = position('- name: Run integration tests');
    const releaseBlock = source.slice(releaseStart, integrationStart);
    expect(releaseBlock).toContain('TEST_DB_RELEASE_TOKEN: ${{ secrets.TEST_DB_RELEASE_TOKEN }}');
    expect(releaseBlock).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(releaseBlock).toContain('TEST_PROJECT_REF: nmwhwngojosmagjuvxol');
    expect(releaseBlock).toContain('validate-production-db-release-on-test.mjs plan');
    expect(releaseBlock).toContain('validate-production-db-release-on-test.mjs apply');
  });

  it('executes exact-plan TEST validation before integration/E2E and captures TEST-after schema before final assembly', () => {
    const releaseApply = position('- name: Validate exact Production DB release plan on canonical TEST');
    const integration = position('- name: Run integration tests');
    const e2e = position('- name: Run E2E tests');
    const raw = position('- name: Emit trusted-main shared TEST raw evidence');
    const coverage = position('- name: Build Production DB G3 coverage evidence');
    const cleanup = position('- name: Verify Production DB G3 migration-scoped cleanup');
    const postSchema = position('- name: Capture Production DB G3 post-TEST schema evidence');
    const assemble = position('- name: Assemble final Production DB G3 TEST_VERIFIED evidence');
    const upload = position('- name: Upload Production DB G3 trusted evidence bundle');

    expect(releaseApply).toBeLessThan(integration);
    expect(integration).toBeLessThan(e2e);
    expect(e2e).toBeLessThan(raw);
    expect(raw).toBeLessThan(coverage);
    expect(coverage).toBeLessThan(cleanup);
    expect(cleanup).toBeLessThan(postSchema);
    expect(postSchema).toBeLessThan(assemble);
    expect(assemble).toBeLessThan(upload);
  });

  it('keeps raw shared TEST workflow success explicitly weaker than TEST_VERIFIED', () => {
    const rawStart = position('- name: Emit trusted-main shared TEST raw evidence');
    const coverageStart = position('- name: Build Production DB G3 coverage evidence');
    const rawBlock = source.slice(rawStart, coverageStart);
    expect(rawBlock).toContain("cleanupClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS'");
    expect(rawBlock).toContain("authzCoverageClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS'");
    expect(rawBlock).toContain('databaseMutationAuthorized: false');
    expect(rawBlock).toContain('productionMutationPerformed: false');
  });

  it('uses read-only schema observer evidence after TEST and explicitly rejects broad Management API token fallback', () => {
    const postSchemaStart = position('- name: Capture Production DB G3 post-TEST schema evidence');
    const assembleStart = position('- name: Assemble final Production DB G3 TEST_VERIFIED evidence');
    const block = source.slice(postSchemaStart, assembleStart);
    expect(block).toContain('SCHEMA_OBSERVER_TOKEN: ${{ secrets.SCHEMA_OBSERVER_TOKEN }}');
    expect(block).toContain('test -n "$SCHEMA_OBSERVER_TOKEN"');
    expect(block).toContain('test -z "${SUPABASE_ACCESS_TOKEN:-}"');
    expect(block).toContain('production-db-g3-post-test-schema.mjs capture');
    expect(block).toContain('production-db-test-post-schema-snapshot.json');
    expect(block).toContain('production-db-test-post-schema-evidence.json');
  });

  it('keeps final machine evidence assembled from separate plan/run/cleanup/coverage/post-schema artifacts', () => {
    const assembleStart = position('- name: Assemble final Production DB G3 TEST_VERIFIED evidence');
    const uploadStart = position('- name: Upload Production DB G3 trusted evidence bundle');
    const block = source.slice(assembleStart, uploadStart);
    expect(block).toContain('assemble-production-db-test-evidence.mjs');
    expect(block).toContain('production-db-release-plan.json');
    expect(block).toContain('shared-test-run-evidence.json');
    expect(block).toContain('production-db-test-release-evidence.json');
    expect(block).toContain('production-db-test-cleanup-evidence.json');
    expect(block).toContain('production-db-test-coverage-evidence.json');
    expect(block).toContain('production-db-test-post-schema-evidence.json');
    expect(block).toContain('production-db-test-verified.json');
  });

  it('retains both the sanitized post-TEST snapshot and its release-bound evidence in the durable bundle', () => {
    const uploadStart = position('- name: Upload Production DB G3 trusted evidence bundle');
    const rawUploadStart = position('- name: Upload trusted-main shared TEST raw evidence');
    const block = source.slice(uploadStart, rawUploadStart);
    expect(block).toContain('production-db-test-post-schema-snapshot.json');
    expect(block).toContain('production-db-test-post-schema-evidence.json');
    expect(block).toContain('production-db-test-verified.json');
  });
});
