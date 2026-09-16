import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/production-db-automation-readiness.yml', 'utf8');

function position(text: string) {
  const index = source.indexOf(text);
  expect(index, `missing readiness workflow contract: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Production DB automation readiness workflow #447', () => {
  it('is an exact-main read-only observer and exposes no database credential', () => {
    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain('workflow_call:');
    expect(source).toContain('expected_main_sha:');
    expect(source).toContain('contents: read');
    expect(source).toContain('checks: read');
    expect(source).toContain('actions: read');
    expect(source).toContain('ref: ${{ inputs.expected_main_sha }}');
    expect(source).toContain('git rev-parse origin/main');
    expect(source).not.toContain('${{ secrets.');
    expect(source).not.toContain('PRODUCTION_DB_RELEASE_TOKEN');
    expect(source).not.toContain('TEST_DB_RELEASE_TOKEN');
    expect(source).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(source).not.toContain('/database/query');
    expect(source).not.toContain('databaseMutationAuthorized: true');
  });

  it('reconstructs exact-head CI from GitHub rather than accepting a caller green flag', () => {
    const query = position('github.rest.checks.listForRef');
    const build = position('production-db-automation-readiness-evidence.mjs build');
    expect(query).toBeLessThan(build);
    expect(source).toContain("run.name === 'check'");
    expect(source).toContain("latest.conclusion !== 'success'");
    expect(source).toContain("status: 'EXACT_HEAD_CI_GREEN'");
    expect(source).toContain('checkRunId: latest.id');
    expect(source).toContain('mainSha: expected');
  });

  it('runs the bounded Production DB counterexample suite before claiming it passed', () => {
    const suite = position('- name: Run Production DB counterexample suite');
    const ciEvidence = position('- name: Reconstruct exact-head required check evidence');
    expect(suite).toBeLessThan(ciEvidence);
    expect(source).toContain('production-db-release-preflight.443.test.ts');
    expect(source).toContain('production-db-consistency-evidence.443.test.ts');
    expect(source).toContain('production-db-test-evidence.447.test.ts');
    expect(source).toContain('production-db-final-risk-evidence.443.test.ts');
    expect(source).toContain('controlled-production-db-release.447.test.ts');
    expect(source).toContain('production-db-apply-receipt.447.test.ts');
    expect(source).toContain('production-db-postcheck.447.test.ts');
    expect(source).toContain('production-db-release-orchestrator.447.test.ts');
    expect(source).toContain('production-db-writer-bypass-audit.447.test.ts');
    expect(source).toContain('targetedCounterexampleSuitePassed: true');
  });

  it('keeps credential proof explicitly absent until a trusted proof source exists', () => {
    const buildStart = position('- name: Build machine automation readiness evidence');
    const publishStart = position('- name: Publish readiness truth');
    const block = source.slice(buildStart, publishStart);
    expect(block).toContain('production-db-exact-head-ci-evidence.json');
    expect(block).toContain('\n            - \\');
    expect(block).toContain('production-db-automation-evidence.json');
    expect(block).toContain('production-db-automation-readiness.json');
    expect(source).not.toContain('PRODUCTION_DB_SCOPED_CREDENTIAL_VERIFIED');
  });

  it('publishes sanitized machine-readable readiness evidence without treating pending as mutation authorization', () => {
    const publish = position('- name: Publish readiness truth');
    const upload = position('- name: Upload sanitized readiness artifacts');
    expect(publish).toBeLessThan(upload);
    expect(source).toContain("result.databaseMutationAuthorized !== false");
    expect(source).toContain('automationReady: ${result.automationReady}');
    expect(source).toContain('blockers: ${blockers.length ? blockers.join');
    expect(source).toContain('production-db-automation-readiness-${{ inputs.expected_main_sha }}');
    expect(source).toContain('production-db-exact-head-ci-evidence.json');
    expect(source).toContain('production-db-automation-evidence.json');
    expect(source).toContain('production-db-automation-readiness.json');
  });
});
