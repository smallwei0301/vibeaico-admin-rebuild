import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as policy from '../../scripts/agents/agent-wip-policy.mjs';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const start = workflow.indexOf('      - name: Revalidate shared TEST admission after queue');
const end = workflow.indexOf('      - name: Validate optional Production DB G3 dispatch contract', start);
const block = workflow.slice(start, end);
const script = block.split('          script: |\n')[1].split('\n').map(line => line.slice(12)).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
// Inject only the real imported module because Vitest VM lacks native dynamic-import callback.
const load = "await import(pathToFileURL(path.join(process.env.GITHUB_WORKSPACE, 'scripts/agents/agent-wip-policy.mjs')).href)";
const execute = new AsyncFunction('require', 'context', 'github', 'policyModule', script.replace(load, 'policyModule'));
const sha = 'a'.repeat(40), base = 'b'.repeat(40);
const body = `<!-- pr-lifecycle\nissue: 755\nstate: ACTIVE\nsupersedes: none\n-->\n` + Object.entries({
  WORK_ORIGIN: 'AGENT', AGENT_LANE: 'TEST_VALIDATION', LANE_STATE: 'ACTIVE', ACTIVE_CANDIDATE: 'false',
  CLOSEABILITY_SCORE: '4', SELECTION_REASON: 'CLOSE_READY', REMAINING_AUTONOMOUS_STEPS: 'canonical test',
  OWNER_OR_EXTERNAL_BLOCKER: 'none', CLOSURE_SWEEP_TARGET: 'EMPTY_WITH_SCAN', TEST_LANE_REQUIRED: 'true',
  WHY_NOT_CLOSER_CANDIDATE: 'none', 'REQUESTED_MODEL / ACTUAL_MODEL': 'requested=not_requested; actual=unknown',
  BPLUS_MODE: 'true', RUN_ID: '2026-10-05-issue-755-atomic-publication-r01', RESERVE_BOUNDARY: 'none',
  SCORECARD_PATH: 'docs/metrics/agent-runs/2026-10-05-issue-755-atomic-publication-r01.json',
}).map(([k,v]) => `${k}: ${v}`).join('\n');
const pr = { number: 755, state: 'open', body, head: { sha, ref: 'feature', repo: { full_name: 'owner/repo' } }, base: { sha: base } };
async function run({ event = 'pull_request', live = pr, holders = [live], main = sha, apiFails = false } = {}) {
  const inputs = { dispatch_reason: 'lane_transition', test_lane_pr: '755', expected_head: sha, base_revision: base };
  const context = { eventName: event, ref: event === 'pull_request' ? 'refs/pull/755/merge' : 'refs/heads/feature', sha,
    repo: { owner: 'owner', repo: 'repo' }, payload: { pull_request: pr, inputs } };
  if (event === 'main_manual') {
    context.eventName = 'workflow_dispatch'; context.ref = 'refs/heads/main'; inputs.dispatch_reason = 'main_manual';
  } else if (event === 'push') context.ref = 'refs/heads/main';
  const github = { rest: { pulls: { get: async () => { if (apiFails) throw new Error('API_UNAVAILABLE'); return { data: live }; }, list: () => {} },
    repos: { getCommit: async () => ({ data: { sha: main } }) } }, paginate: async () => holders };
  const old = process.env.GITHUB_WORKSPACE;
  process.env.GITHUB_WORKSPACE = resolve('.');
  try { await execute(createRequire(import.meta.url), context, github, policy); }
  finally { if (old === undefined) delete process.env.GITHUB_WORKSPACE; else process.env.GITHUB_WORKSPACE = old; }
}
describe('execute actual queued shared TEST admission step #755', () => {
  it('runs before TEST dependency install and every writer and keeps original admission condition', () => {
    expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start);
    expect(block).toContain("needs.classify-changes.outputs.run_test_validation == 'true'");
    for (const marker of ['      - name: Install dependencies', '      - name: Validate exact Production DB release plan on canonical TEST', '      - name: Apply explicit canonical TEST 0098 baseline'])
      expect(start).toBeLessThan(workflow.indexOf(marker, start));
  });
  it('accepts current sole holder for PR and branch dispatch', async () => { await run(); await run({ event: 'workflow_dispatch' }); });
  it('rejects changed head or closed PR', async () => {
    await expect(run({ live: { ...pr, head: { ...pr.head, sha: base } } })).rejects.toThrow('STALE_QUEUED_TEST_HEAD');
    await expect(run({ live: { ...pr, state: 'closed' } })).rejects.toThrow('STALE_QUEUED_TEST_HEAD');
  });
  it('rejects PARKED former holder and transferred/conflicting holders', async () => {
    await expect(run({ live: { ...pr, body: body.replace('LANE_STATE: ACTIVE', 'LANE_STATE: PARKED') } })).rejects.toThrow('STALE_QUEUED_TEST_ADMISSION');
    await expect(run({ holders: [{ ...pr, number: 756 }] })).rejects.toThrow('STALE_QUEUED_TEST_ADMISSION');
    await expect(run({ holders: [pr, { ...pr, number: 756 }] })).rejects.toThrow('STALE_QUEUED_TEST_ADMISSION');
  });
  it('fails closed on live read failure', async () => { await expect(run({ apiFails: true })).rejects.toThrow('API_UNAVAILABLE'); });
  it('rejects advanced main manual dispatch while preserving ordinary canonical main push', async () => {
    await run({ event: 'main_manual' });
    await expect(run({ event: 'main_manual', main: base })).rejects.toThrow('STALE_QUEUED_MAIN_DISPATCH');
    await run({ event: 'push', main: base });
  });
});
