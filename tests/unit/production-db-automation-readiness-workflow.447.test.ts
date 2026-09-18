import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('.github/workflows/production-db-automation-readiness.yml', 'utf8');
const caBundle = readFileSync('config/supabase-production-root-bundle.crt', 'utf8');

function position(text: string) {
  const index = source.indexOf(text);
  expect(index, `missing readiness workflow contract: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Production DB automation readiness workflow #447', () => {
  it('keeps the writer credential in one protected, non-mutating proof job', () => {
    expect(source).toContain('workflow_dispatch:');
    expect(source).toContain('workflow_call:');
    expect(source).toContain('expected_main_sha:');
    expect(source).toContain('contents: read');
    expect(source).toContain('checks: read');
    expect(source).toContain('actions: read');
    expect(source).toContain("ref: ${{ github.event_name == 'push' && github.sha || inputs.expected_main_sha }}");
    expect(source).toContain('git rev-parse origin/main');
    expect(source).toContain('credential-proof:');
    expect(source).toContain('environment: production-db-writer');
    expect(source).toContain('PRODUCTION_DB_WRITER_URL: ${{ secrets.PRODUCTION_DB_WRITER_URL }}');
    expect(source).toContain('NODE_EXTRA_CA_CERTS: ${{ github.workspace }}/config/supabase-production-root-bundle.crt');
    expect(source).not.toContain('PRODUCTION_DB_SSL_ROOT_CERT');
    expect(source).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(source).not.toContain('rejectUnauthorized: false');
    expect(source).not.toContain('PRODUCTION_DB_RELEASE_TOKEN');
    expect(source).not.toContain('TEST_DB_RELEASE_TOKEN');
    expect(source).not.toContain('SUPABASE_ACCESS_TOKEN');
    expect(source).not.toContain('/database/query');
    expect(source).not.toContain('databaseMutationAuthorized: true');
  });

  it('pins the public Supabase production CA bundle used by the official CLI', () => {
    expect(caBundle.match(/-----BEGIN CERTIFICATE-----/g)?.length).toBe(2);
    expect(caBundle).not.toContain('PRIVATE KEY');
    expect(createHash('sha256').update(caBundle).digest('hex')).toBe(
      '6ecd239038a7db063a6619b71742372ecfe06c0b0ec12a9993fee4445bf0d4d6',
    );
  });

  it('fails closed when the sanitized credential proof is not actually verified', () => {
    const proofStart = position('- name: Verify project-bound writer credential without mutation');
    const upload = position('- uses: actions/upload-artifact@v4');
    expect(proofStart).toBeLessThan(upload);
    expect(source).toContain("proof.status !== 'PRODUCTION_DB_PROJECT_BOUND_WRITER_CREDENTIAL_VERIFIED'");
    expect(source).toContain("proof.databaseMutationAuthorized !== false");
    expect(source).toContain('if: ${{ always() }}');
    expect(source).toContain('test -s "$NODE_EXTRA_CA_CERTS"');
  });

  it('allows one protected-main activation marker without enabling readiness on every push', () => {
    expect(source).toContain('push:');
    expect(source).toContain('branches: [main]');
    expect(source).toContain("- 'docs/activation/production-db-automation-readiness.trigger'");
    expect(source).toContain("EXPECTED_MAIN_SHA: ${{ github.event_name == 'push' && github.sha || inputs.expected_main_sha }}");
    expect(source).toContain('EXPECTED_MAIN_SHA: ${{ needs.verify-exact-main.outputs.main_sha }}');
    expect(source).toContain('production-db-automation-readiness-${{ needs.verify-exact-main.outputs.main_sha }}');
  });

  it('reconstructs exact-head CI from GitHub rather than accepting a caller green flag', () => {
    const query = position('github.rest.checks.listForRef');
    const build = position('production-db-automation-readiness-evidence.mjs build');
    expect(query).toBeLessThan(build);
    expect(source).toContain("run.name === 'check'");
    expect(source).toContain('for (let attempt = 0; attempt < 60; attempt += 1)');
    expect(source).toContain('setTimeout(resolve, 5000)');
    expect(source).toContain("latest.conclusion !== 'success'");
    expect(source).toContain('did not become successful before timeout');
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

  it('builds readiness from the sanitized protected credential proof', () => {
    const buildStart = position('- name: Build machine automation readiness evidence');
    const publishStart = position('- name: Publish readiness truth');
    const block = source.slice(buildStart, publishStart);
    expect(block).toContain('production-db-exact-head-ci-evidence.json');
    expect(block).toContain('production-db-writer-credential-proof.json');
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
    expect(source).toContain('production-db-automation-readiness-${{ needs.verify-exact-main.outputs.main_sha }}');
    expect(source).toContain('production-db-exact-head-ci-evidence.json');
    expect(source).toContain('production-db-automation-evidence.json');
    expect(source).toContain('production-db-automation-readiness.json');
  });
});
