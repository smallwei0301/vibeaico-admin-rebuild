import { describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { classifyChangeRecords, classifyEvent, classifyToolingOnly, parseNameStatus } from '../../scripts/ci/classify-changes.mjs';
import { computeIntegrationReachableSet } from '../../scripts/agents/integration-reachability.mjs';
import { decideTestValidation } from '../../scripts/agents/agent-wip-policy.mjs';
import { decideSameShaG3Reuse, findSameShaG3Reuse } from '../../scripts/agents/same-sha-g3-reuse.mjs';

const out = (...parts: string[]) => Buffer.from(parts.join('\0'));
const records = (...parts: string[]) => parseNameStatus(out(...parts));
const realReach = () => computeIntegrationReachableSet(process.cwd());
const sha = 'a'.repeat(40);
const base = 'b'.repeat(40);

describe('classifier tooling_only (real repo graph)', () => {
  it('is true for unreachable scripts/agents, scripts/metrics, tests/unit, docs/metrics and docs mixes', () => {
    const r = classifyChangeRecords(records(
      'M', 'scripts/agents/governance-workstream-boundary.mjs',
      'M', 'scripts/metrics/governance-scoreboard.mjs',
      'A', 'tests/unit/new-thing.test.ts',
      'M', 'docs/metrics/agent-runs/x.json',
      'M', 'docs/AGENT-EXECUTION.md',
    ), { computeReachable: realReach });
    expect(r).toMatchObject({ docsOnly: false, toolingOnly: true });
  });
  it('is false when a changed scripts/agents file is imported by integration/E2E', () => {
    for (const path of ['scripts/agents/test-env-policy.mjs', 'scripts/agents/production-db-release-plan.mjs', 'scripts/agents/agent-wip-policy.mjs']) {
      const r = classifyChangeRecords(records('M', path, 'M', 'docs/a.md'), { computeReachable: realReach });
      expect(r.toolingOnly, path).toBe(false);
      expect(r.toolingDetail).toContain('integration-reachable');
    }
  });
  it('checks both sides of a rename', () => {
    const r = classifyChangeRecords(records('R100', 'scripts/agents/test-env-policy.mjs', 'scripts/agents/renamed-env.mjs'), { computeReachable: realReach });
    expect(r.toolingOnly).toBe(false);
    const ok = classifyChangeRecords(records('R100', 'scripts/agents/aaa-unreferenced.mjs', 'scripts/metrics/bbb.mjs'), { computeReachable: realReach });
    expect(ok.toolingOnly).toBe(true);
  });
  it('is false for any .github, src, supabase, package, lockfile, root-config or other script path', () => {
    for (const path of ['.github/workflows/ci.yml', 'src/lib/x.ts', 'supabase/migrations/1.sql', 'package.json', 'package-lock.json', 'vitest.config.mts', 'scripts/db/x.mjs', 'scripts/ci/classify-changes.mjs', 'scripts/agents/integration-reachability.mjs', 'scripts/agents/same-sha-g3-reuse.mjs', 'tests/integration/a.test.ts', 'tests/e2e/a.spec.ts']) {
      const r = classifyChangeRecords(records('M', 'scripts/agents/unreferenced-x.mjs', 'M', path), { computeReachable: realReach });
      expect(r.toolingOnly, path).toBe(false);
    }
  });
  it('is false for a docs-only diff (docs route handles it) and for empty / unavailable reachability', () => {
    expect(classifyChangeRecords(records('M', 'docs/a.md'), { computeReachable: realReach }).toolingOnly).toBe(false);
    expect(classifyChangeRecords(records('M', 'scripts/agents/unreferenced-x.mjs')).toolingOnly).toBe(false);
    expect(classifyToolingOnly([], realReach).toolingOnly).toBe(false);
  });
  it('fails closed when reachability throws or is not a Set', () => {
    const rec = records('M', 'scripts/agents/unreferenced-x.mjs');
    expect(classifyToolingOnly(rec, () => { throw new Error('parse'); })).toMatchObject({ toolingOnly: false, toolingDetail: 'reachability-uncertain' });
    expect(classifyToolingOnly(rec, (() => []) as never).toolingOnly).toBe(false);
  });
  it('only a main push may take the tooling lane', () => {
    const run = () => out('M', 'scripts/agents/unreferenced-x.mjs');
    const push = classifyEvent('push', { ref: 'refs/heads/main', before: base, after: sha }, run as never, realReach);
    expect(push.toolingOnly).toBe(true);
    const pr = classifyEvent('pull_request', { pull_request: { base: { sha: base }, head: { sha } } }, run as never, realReach);
    expect(pr.toolingOnly).toBe(false);
  });
});

describe('integration reachability on a synthetic tree', () => {
  function tree(files: Record<string, string>) {
    const root = mkdtempSync(join(tmpdir(), 'reach-'));
    const all: Record<string, string> = {
      'vitest.integration.config.mts': "export default { test: { globalSetup: ['tests/integration/global-setup.ts'] } };",
      'playwright.config.ts': 'export default {};',
      'package.json': '{"scripts":{"test:integration":"vitest run"}}',
      '.github/workflows/ci.yml': 'jobs:\n  check:\n    steps: []\n  integration:\n    steps:\n      - run: node scripts/agents/from-ci.mjs\n',
      'tests/e2e/a.spec.ts': '',
      ...files,
    };
    for (const [p, c] of Object.entries(all)) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), c); }
    return root;
  }
  it('follows transitive relative imports, ci.yml string refs and index files', () => {
    const root = tree({
      'tests/integration/global-setup.ts': "import { a } from '../../scripts/agents/a.mjs';",
      'scripts/agents/a.mjs': "export * from './lib/index.mjs'; const x = await import('./dyn.mjs');",
      'scripts/agents/lib/index.mjs': "import b from '../b.mjs';",
      'scripts/agents/b.mjs': '',
      'scripts/agents/dyn.mjs': '',
      'scripts/agents/from-ci.mjs': "import './from-ci-dep.mjs';",
      'scripts/agents/from-ci-dep.mjs': '',
      'scripts/agents/alone.mjs': '',
    });
    try {
      const set = computeIntegrationReachableSet(root);
      for (const p of ['scripts/agents/a.mjs', 'scripts/agents/lib/index.mjs', 'scripts/agents/b.mjs', 'scripts/agents/dyn.mjs', 'scripts/agents/from-ci.mjs', 'scripts/agents/from-ci-dep.mjs']) expect(set.has(p), p).toBe(true);
      expect(set.has('scripts/agents/alone.mjs')).toBe(false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
  it('throws (fail closed) on unresolvable imports, non-literal dynamic imports and split-segment paths', () => {
    for (const content of ["import x from './missing.mjs';", 'await import(name);', "path.join(root, 'scripts', 'agents', 'x.mjs')"]) {
      const root = tree({ 'tests/integration/global-setup.ts': content });
      try { expect(() => computeIntegrationReachableSet(root)).toThrow(); } finally { rmSync(root, { recursive: true, force: true }); }
    }
  });
});

describe('decideTestValidation tooling lane', () => {
  const common = { eventName: 'push', ref: 'refs/heads/main', sha };
  it('main push tooling_only => no shared TEST with explicit reason', () => {
    expect(decideTestValidation({ ...common, toolingOnly: true })).toMatchObject({ runTestValidation: false, reason: 'main_push_tooling_only', error: null });
  });
  it('main push otherwise still runs; docs_only keeps precedence; PRs are unaffected', () => {
    expect(decideTestValidation({ ...common })).toMatchObject({ runTestValidation: true, reason: 'main_push' });
    expect(decideTestValidation({ ...common, toolingOnly: false })).toMatchObject({ runTestValidation: true, reason: 'main_push' });
    expect(decideTestValidation({ ...common, docsOnly: true, toolingOnly: true }).reason).toBe('docs_only');
    expect(decideTestValidation({ eventName: 'pull_request', ref: 'refs/pull/1/merge', sha, toolingOnly: true }).reason).not.toBe('main_push_tooling_only');
  });
  it('G3 main dispatch with release inputs still runs even when toolingOnly is passed', () => {
    const d = decideTestValidation({
      eventName: 'workflow_dispatch', ref: 'refs/heads/main', sha, toolingOnly: true, docsOnly: true,
      inputs: { dispatch_reason: 'main_manual', expected_head: sha, base_revision: base, production_db_release_id: 'rel-1', production_db_planned_at: '2026-10-19T00:00:00Z' },
      currentCommit: { sha, parents: [{ sha: base }] },
    });
    expect(d).toMatchObject({ runTestValidation: true, reason: 'manual_main_g3_exact_head' });
  });
});

describe('same-SHA G3 dedupe decision', () => {
  const okSteps = [
    { name: 'Validate exact Production DB release plan on canonical TEST', conclusion: 'success' },
    { name: 'Run integration tests', conclusion: 'success' },
    { name: 'Run E2E tests', conclusion: 'success' },
    { name: 'Upload Production DB G3 trusted evidence bundle', conclusion: 'success' },
  ];
  const job = (steps = okSteps, conclusion = 'success') => [{ name: 'integration', conclusion, steps }];
  const run = (over = {}) => ({ id: 900, event: 'workflow_dispatch', head_branch: 'main', head_sha: sha, path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'success', html_url: 'u', ...over });
  const decide = (runs: unknown[], jobs: Record<string, unknown>, extra = {}) =>
    decideSameShaG3Reuse({ eventName: 'push', ref: 'refs/heads/main', sha, runs, jobsByRunId: jobs, currentRunId: 1, ...extra });

  it('skips and names the reused G3 run', () => {
    expect(decide([run()], { 900: job() })).toMatchObject({ skip: true, runId: 900, reason: 'same_sha_g3_success' });
  });
  it('prefers the newest verified run', () => {
    expect(decide([run({ id: 800 }), run({ id: 950 })], { 800: job(), 950: job() }).runId).toBe(950);
  });
  it('does not skip for failed, absent, other-SHA, branch-dispatch, in-progress runs', () => {
    expect(decide([], {}).skip).toBe(false);
    expect(decide([run({ conclusion: 'failure' })], { 900: job() }).skip).toBe(false);
    expect(decide([run({ status: 'in_progress', conclusion: null })], { 900: job() }).skip).toBe(false);
    expect(decide([run({ head_sha: 'c'.repeat(40) })], { 900: job() }).skip).toBe(false);
    expect(decide([run({ head_branch: 'feature' })], { 900: job() }).skip).toBe(false);
    expect(decide([run({ event: 'push' })], { 900: job() }).skip).toBe(false);
    expect(decide([run({ path: '.github/workflows/other.yml' })], { 900: job() }).skip).toBe(false);
  });
  it('does not skip when E2E or integration did not succeed, or the run is not a G3 release dispatch', () => {
    expect(decide([run()], { 900: job(okSteps.filter((s) => s.name !== 'Run E2E tests')) }).skip).toBe(false);
    expect(decide([run()], { 900: job(okSteps.map((s) => (s.name === 'Run integration tests' ? { ...s, conclusion: 'skipped' } : s))) }).skip).toBe(false);
    expect(decide([run()], { 900: job(okSteps, 'failure') }).skip).toBe(false);
    expect(decide([run()], { 900: job(okSteps.filter((s) => !/Production DB/.test(s.name))) }).skip).toBe(false);
    expect(decide([run()], {}).skip).toBe(false);
  });
  it('only applies to a main push', () => {
    expect(decide([run()], { 900: job() }, { eventName: 'workflow_dispatch' }).skip).toBe(false);
    expect(decide([run()], { 900: job() }, { ref: 'refs/heads/x' }).skip).toBe(false);
  });
  it('API errors never skip', async () => {
    const boom = { paginate: async () => { throw new Error('503'); }, rest: { actions: { listWorkflowRuns: 1, listJobsForWorkflowRun: 2 } } };
    expect(await findSameShaG3Reuse({ github: boom, owner: 'o', repo: 'r', eventName: 'push', ref: 'refs/heads/main', sha })).toMatchObject({ skip: false, reason: 'api_error' });
  });
  it('live wrapper skips when the API returns a verified G3 run', async () => {
    const github = { paginate: async (fn: unknown) => (fn === 'runs' ? [run()] : job()), rest: { actions: { listWorkflowRuns: 'runs', listJobsForWorkflowRun: 'jobs' } } };
    expect(await findSameShaG3Reuse({ github, owner: 'o', repo: 'r', eventName: 'push', ref: 'refs/heads/main', sha })).toMatchObject({ skip: true, runId: 900 });
  });
});

describe('ci.yml wiring', () => {
  const yml = readFileSync('.github/workflows/ci.yml', 'utf8');
  const stepIf = (name: string) => {
    const i = yml.indexOf(`      - name: ${name}\n`);
    expect(i, name).toBeGreaterThan(0);
    return yml.slice(i, yml.indexOf('\n      - ', i + 10)).match(/\n {8}if: (.*)/)?.[1] ?? '';
  };
  it('passes tooling_only into the test policy and gates every TEST-running step on the dedupe output', () => {
    expect(yml).toContain('TOOLING_ONLY: ${{ steps.classify.outputs.tooling_only }}');
    expect(yml.indexOf('id: g3_dedupe')).toBeGreaterThan(yml.indexOf('Revalidate shared TEST admission after queue'));
    expect(yml.indexOf('id: g3_dedupe')).toBeLessThan(yml.indexOf('      - name: Install dependencies\n        if: ${{ needs.classify-changes.outputs.run_test_validation'));
    for (const name of ['Install dependencies', 'Run integration tests', 'Run E2E tests']) {
      expect(stepIf(name), name).toContain("steps.g3_dedupe.outputs.skip != 'true'");
    }
    expect(stepIf('Reuse same-SHA successful G3 TEST run for main push')).toContain("github.event_name == 'push'");
  });
});
