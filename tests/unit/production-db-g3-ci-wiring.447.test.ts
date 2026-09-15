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

  it('executes exact-plan TEST validation before integration/E2E and evidence assembly after both', () => {
    const releaseApply = position('- name: Validate exact Production DB release plan on canonical TEST');
    const integration = position('- name: Run integration tests');
    const e2e = position('- name: Run E2E tests');
    const raw = position('- name: Emit trusted-main shared TEST raw evidence');
    const coverage = position('- name: Build Production DB G3 coverage evidence');
    const cleanup = position('- name: Verify Production DB G3 migration-scoped cleanup');
    const assemble = position('- name: Assemble final Production DB G3 TEST_VERIFIED evidence');
    const upload = position('- name: Upload Production DB G3 trusted evidence bundle');

    expect(releaseApply).toBeLessThan(integration);
    expect(integration).toBeLessThan(e2e);
    expect(e2e).toBeLessThan(raw);
    expect(raw).toBeLessThan(coverage);
    expect(coverage).toBeLessThan(cleanup);
    expect(cleanup).toBeLessThan(assemble);
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

  it('keeps final machine evidence assembled from separate plan/run/cleanup/coverage artifacts', () => {
    const assembleStart = position('- name: Assemble final Production DB G3 TEST_VERIFIED evidence');
    const uploadStart = position('- name: Upload Production DB G3 trusted evidence bundle');
    const block = source.slice(assembleStart, uploadStart);
    expect(block).toContain('assemble-production-db-test-evidence.mjs');
    expect(block).toContain('production-db-release-plan.json');
    expect(block).toContain('shared-test-run-evidence.json');
    expect(block).toContain('production-db-test-release-evidence.json');
    expect(block).toContain('production-db-test-cleanup-evidence.json');
    expect(block).toContain('production-db-test-coverage-evidence.json');
    expect(block).toContain('production-db-test-verified.json');
  });
});
