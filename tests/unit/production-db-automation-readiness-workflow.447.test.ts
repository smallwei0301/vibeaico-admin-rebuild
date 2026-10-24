import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync('.github/workflows/production-db-automation-readiness.yml', 'utf8');
const caBundle = readFileSync('config/supabase-production-root-bundle.crt', 'utf8');
const checkEvidenceScript = source
  .split('      - name: Reconstruct exact-head required check evidence\n')[1]
  .split('\n      - name: Download sanitized project-bound writer credential proof')[0]
  .split('          script: |\n')[1]
  .split('\n').map((line) => line.replace(/^ {12}/, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const mainSha = 'a'.repeat(40);
type CheckRun = {
  id: number; name: string; head_sha: string; status: string; conclusion: string | null;
  started_at: string; completed_at: string | null;
};
type CheckQuery = {
  owner: string; repo: string; ref: string; per_page: number; filter: string; page?: number;
};

function check(overrides: Partial<CheckRun> = {}): CheckRun {
  return {
    id: 201, name: 'check', head_sha: mainSha, status: 'completed', conclusion: 'success',
    started_at: '2026-10-06T01:00:00Z', completed_at: '2026-10-06T01:01:00Z', ...overrides,
  };
}

// Run the actual github-script body with page-shaped GitHub responses and isolated I/O.
async function reconstructChecks(pages: (CheckRun[] | Error)[], script = checkEvidenceScript) {
  const writeFileSync = vi.fn(); const setFailed = vi.fn();
  const setTimeout = vi.fn((resolve: () => void, _delay: number) => resolve());
  const listForRef = vi.fn(async ({ page = 1 }: CheckQuery) => {
    const runs = pages[page - 1];
    if (runs instanceof Error) throw runs;
    if (!runs) throw new Error(`unexpected check page ${page}`);
    return {
      data: { check_runs: runs },
      headers: { link: page < pages.length ? `<https://api.github.com/checks?page=${page + 1}>; rel="next"` : undefined },
    };
  });
  const paginate = vi.fn(async (method: typeof listForRef, query: CheckQuery) => {
    const all: CheckRun[] = [];
    for (let page = 1; ; page += 1) {
      const response = await method({ ...query, page });
      all.push(...response.data.check_runs);
      if (!response.headers.link) return all;
    }
  });
  let error: unknown;
  try {
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'setTimeout', script)(
      (name: string) => {
        if (name !== 'node:fs') throw new Error(`unexpected module ${name}`);
        return { writeFileSync };
      },
      { env: { EXPECTED_MAIN_SHA: mainSha, RUNNER_TEMP: '/fake-runner-temp' } },
      { rest: { checks: { listForRef } }, paginate },
      { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' } },
      { setFailed }, setTimeout,
    );
  } catch (caught) { error = caught; }
  return { error, writeFileSync, setFailed, setTimeout, listForRef, paginate };
}

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

  it('reads a successful exact-head required check beyond the first 100 check runs', async () => {
    const firstPage = Array.from({ length: 100 }, (_, id) => check({ id, name: 'unrelated' }));
    const result = await reconstructChecks([firstPage, [check()]]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).not.toHaveBeenCalled();
    expect(result.paginate).toHaveBeenCalledWith(result.listForRef, {
      owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', ref: mainSha, per_page: 100, filter: 'latest',
    });
    expect(result.listForRef.mock.calls.map(([query]) => query.page)).toEqual([1, 2]);
    expect(result.setTimeout).not.toHaveBeenCalled();
    expect(result.writeFileSync).toHaveBeenCalledTimes(1);
    const [path, content] = result.writeFileSync.mock.calls[0];
    expect(path).toBe('/fake-runner-temp/production-db-exact-head-ci-evidence.json');
    expect(JSON.parse(content)).toEqual({
      schemaVersion: 1, status: 'EXACT_HEAD_CI_GREEN', mainSha, checkName: 'check', checkRunId: 201,
      conclusion: 'success', targetedCounterexampleSuitePassed: true,
      observedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/), databaseMutationAuthorized: false,
    });
  });

  it('rejects the latest page-two red check instead of accepting an older page-one green', async () => {
    const result = await reconstructChecks([[check()], [check({
      id: 202, conclusion: 'failure', completed_at: '2026-10-06T02:01:00Z',
    })]]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).toHaveBeenCalledWith('latest exact-head check completed unsuccessfully: failure');
    expect(result.listForRef.mock.calls.map(([query]) => query.page)).toEqual([1, 2]);
    expect(result.writeFileSync).not.toHaveBeenCalled();
  });

  it('rejects a page-two green check for a different head and preserves the polling bound', async () => {
    const result = await reconstructChecks([[], [check({ head_sha: 'b'.repeat(40) })]]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).toHaveBeenCalledWith('latest exact-head check did not become successful before timeout: missing/missing');
    expect(result.paginate).toHaveBeenCalledTimes(60);
    expect(result.listForRef).toHaveBeenCalledTimes(120);
    expect(result.setTimeout).toHaveBeenCalledTimes(59);
    expect(result.setTimeout.mock.calls.every(([, delay]) => delay === 5000)).toBe(true);
    expect(result.writeFileSync).not.toHaveBeenCalled();
  });

  it.each(['in_progress', 'queued', 'unknown'])('does not fall back to an older green when page two is %s', async (status) => {
    const result = await reconstructChecks([[check()], [check({
      id: 202, status, conclusion: null, started_at: '2026-10-06T02:00:00Z', completed_at: null,
    })]]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).toHaveBeenCalledWith(`latest exact-head check did not become successful before timeout: ${status}/missing`);
    expect(result.paginate).toHaveBeenCalledTimes(60);
    expect(result.setTimeout).toHaveBeenCalledTimes(59);
    expect(result.writeFileSync).not.toHaveBeenCalled();
  });

  it.each([null, 'cancelled', 'timed_out', 'startup_failure', 'neutral'])('rejects page-two completed checks with conclusion %s', async (conclusion) => {
    const result = await reconstructChecks([[check()], [check({
      id: 202, conclusion, completed_at: '2026-10-06T02:01:00Z',
    })]]);
    expect(result.error).toBeUndefined();
    expect(result.setFailed).toHaveBeenCalledWith(`latest exact-head check completed unsuccessfully: ${conclusion || 'missing'}`);
    expect(result.setTimeout).not.toHaveBeenCalled();
    expect(result.writeFileSync).not.toHaveBeenCalled();
  });

  it('fails closed if reading page two fails even when page one has a green check', async () => {
    const result = await reconstructChecks([[check()], new Error('page two unavailable')]);
    expect(result.error).toBeInstanceOf(Error);
    expect((result.error as Error).message).toBe('page two unavailable');
    expect(result.listForRef.mock.calls.map(([query]) => query.page)).toEqual([1, 2]);
    expect(result.writeFileSync).not.toHaveBeenCalled();
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
