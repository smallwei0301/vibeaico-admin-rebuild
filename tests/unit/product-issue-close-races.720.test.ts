import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as policy from '../../scripts/agents/product-issue-close-policy.mjs';
import * as astra from '../../scripts/agents/astra-review-policy.mjs';

// Execute the actual github-script body against a mock API; no DB or GitHub writes.
const workflow = fs.readFileSync('.github/workflows/agent-product-issue-close-guard.yml', 'utf8');
const script = workflow.split('          script: |\n')[1]
  .split('\n').map((line) => line.replace(/^            /, '')).join('\n');
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const main = 'a'.repeat(40);
const closeAt = '2026-10-01T01:00:00Z';
const runId = '2026-10-01-product-r01';
const head = 'b'.repeat(40);
const user = { login: 'smallwei0301', type: 'User' };
const issue = { number: 704, state: 'closed', closed_at: closeAt,
  body: 'WORKSTREAM: PRODUCT_MAINLINE', labels: [{ name: 'workstream:product-mainline' }] };
const approval = { id: 9001, user, issue_url: 'https://api.github.com/repos/o/r/issues/704',
  created_at: '2026-10-01T00:44:00Z', updated_at: '2026-10-01T00:44:00Z',
  body: `REVIEW_ROLE: SOL\nVERDICT: CLOSE_APPROVED\nRUN_ID: ${runId}\nEXACT_HEAD: ${head}` };
const ready = { id: 9002, user, created_at: '2026-10-01T00:46:00Z', updated_at: '2026-10-01T00:46:00Z',
  body: ['RUN_CAPTURE_HANDOFF', `RUN_ID: ${runId}`, 'EVENT: ISSUE_CLOSE_READY',
    'EVIDENCE_REF: github:workflow#12345', 'CLOSE_APPROVED_REF: github:issuecomment#9001',
    `REVIEWED_HEAD: ${head}`, 'OBSERVED_AT: 2026-10-01T00:45:00Z',
    'WRITER_BLOCKER: protected ledger', 'NEXT_SAFE_WRITE_PATH: reconcile owning Run'].join('\n') };

type Scenario = {
  branches?: string[]; issues?: typeof issue[]; invalid?: boolean; ci?: Record<string, unknown>;
  capture?: boolean; branchReadError?: boolean; issueReadError?: boolean;
  checkoutSha?: string; checkoutReadError?: boolean;
};
async function execute(options: Scenario = {}) {
  vi.stubEnv('GITHUB_WORKSPACE', path.resolve('.'));
  const branches = options.branches ?? [main];
  const issues = options.issues ?? [issue];
  let branchReads = 0; let issueReads = 0;
  const comments: any[] = options.invalid ? [] : [approval, ready];
  if (options.capture) comments.push({ id: 9003, user: { login: 'github-actions[bot]', type: 'Bot' },
    created_at: '2026-10-01T01:01:00Z', body: `${policy.PRODUCT_ISSUE_CLOSE_CAPTURE_MARKER}\nRUN_CAPTURE_HANDOFF\nRUN_ID: ${runId}\nEVENT: ISSUE_CLOSED_OBSERVED\nEVIDENCE_REF: github:issue#704\nOBSERVED_AT: ${closeAt}\nWRITER_BLOCKER: protected ledger\nNEXT_SAFE_WRITE_PATH: reconcile` });
  const api = {
    issues: {
      get: vi.fn(async () => {
        if (options.issueReadError && issueReads > 0) throw new Error('issue read unavailable');
        const data = issues[Math.min(issueReads++, issues.length - 1)]; return { data };
      }),
      listComments: vi.fn(), getComment: vi.fn(async () => ({ data: approval })),
      getLabel: vi.fn(async () => ({ data: {} })), createLabel: vi.fn(),
      update: vi.fn(async () => ({})), addLabels: vi.fn(async () => ({})),
      removeLabel: vi.fn(async () => ({})), createComment: vi.fn(async (_input: { body: string }) => ({})),
    },
    repos: {
      get: vi.fn(async () => ({ data: { default_branch: 'main' } })),
      getBranch: vi.fn(async () => {
        if (options.branchReadError && branchReads > 0) throw new Error('branch read unavailable');
        return { data: { commit: { sha: branches[Math.min(branchReads++, branches.length - 1)] } } };
      }),
      getCollaboratorPermissionLevel: vi.fn(async () => ({ data: { permission: 'write' } })),
      compareCommits: vi.fn(async () => ({ data: { status: 'ahead' } })),
      getContent: vi.fn(async () => ({ data: { type: 'file', encoding: 'base64',
        content: Buffer.from(JSON.stringify({ schemaVersion: 2, deliveryTruthVersion: 4, runId,
          status: 'IN_PROGRESS', sources: [{ ref: 'issue/704' }],
          closeout: { state: 'OPEN', ownerRole: 'PRODUCT_MAIN_SESSION' } })).toString('base64') } })),
    },
    pulls: { list: vi.fn() },
    actions: { getWorkflowRun: vi.fn(async () => ({ data: { id: 12345, name: 'ci',
      path: '.github/workflows/ci.yml', event: 'push', conclusion: 'success', head_sha: main, ...options.ci } })) },
  };
  const github = { rest: api, paginate: vi.fn(async (fn, args) => {
    if (fn === api.issues.listComments) return comments;
    if (args.state === 'open') return [];
    return [{ number: 705, state: 'closed', merged_at: '2026-10-01T00:40:00Z',
      head: { sha: head }, merge_commit_sha: 'e'.repeat(40),
      body: '<!-- pr-lifecycle\nissue: 704\nstate: MERGED\n-->\nWORKSTREAM: PRODUCT_MAINLINE' }];
  }) };
  const summary: any = { addHeading: vi.fn(() => summary), addTable: vi.fn(() => summary), write: vi.fn(async () => {}) };
  const core = { summary, warning: vi.fn(), notice: vi.fn(), setFailed: vi.fn() };
  let error: unknown;
  try {
    // Vitest's VM cannot dynamically import inside a constructed function. Adapt
    // only the two imports to the same real modules; keep all API/control flow.
    const loadModule = async (url: string) => {
      if (url.endsWith('/product-issue-close-policy.mjs')) return policy;
      if (url.endsWith('/astra-review-policy.mjs')) return astra;
      throw new Error(`Unexpected import: ${url}`);
    };
    await new AsyncFunction('require', 'github', 'context', 'core', 'loadModule', script.replace(/\bimport\(/g, 'loadModule('))(
      (name: string) => name === 'node:child_process' ? { execFileSync: () => {
        if (options.checkoutReadError) throw new Error('checkout identity unavailable');
        return `${options.checkoutSha ?? main}\n`;
      } } : createRequire(import.meta.url)(name),
      github, { repo: { owner: 'o', repo: 'r' }, payload: { issue } }, core, loadModule);
  } catch (caught) { error = caught; }
  return { api, core, error, branchReads };
}

afterEach(() => vi.unstubAllEnvs());
describe('#720 close generation / canonical main races', () => {
  it.each(['different', 'unavailable'])('fails closed before admission when checked-out policy is %s', async (mode) => {
    const r = await execute(mode === 'different' ? { checkoutSha: 'd'.repeat(40) } : { checkoutReadError: true });
    expect(r.error ?? r.core.setFailed.mock.calls[0]).toBeDefined();
    expect(r.api.repos.getContent).not.toHaveBeenCalled();
    expect(r.api.issues.update).not.toHaveBeenCalled();
    expect(r.api.issues.createComment).not.toHaveBeenCalled();
  });
  it('captures a valid stable-main close with immutable Run read', async () => {
    const r = await execute(); expect(r.error).toBeUndefined();
    expect(r.api.issues.update).not.toHaveBeenCalled();
    expect(r.api.issues.createComment).toHaveBeenCalledWith(expect.objectContaining({ body: expect.stringContaining('EVENT: ISSUE_CLOSED_OBSERVED') }));
    expect(r.api.repos.getContent).toHaveBeenCalledWith(expect.objectContaining({ ref: main }));
  });
  it('rejects old-green evidence when main advances during verification', async () => {
    const r = await execute({ branches: [main, 'c'.repeat(40)] });
    expect(r.error).toBeUndefined(); expect(r.core.setFailed).toHaveBeenCalled();
    expect(r.api.issues.update).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }));
    expect(r.api.issues.createComment.mock.calls.every(([x]) => !x.body.includes('EVENT: ISSUE_CLOSED_OBSERVED'))).toBe(true);
  });
  it('also rechecks main after fresh capture-comment pagination', async () => {
    const r = await execute({ branches: [main, main, 'c'.repeat(40)] });
    expect(r.core.setFailed).toHaveBeenCalled();
    expect(r.api.issues.createComment.mock.calls.every(([x]) => !x.body.includes('EVENT: ISSUE_CLOSED_OBSERVED'))).toBe(true);
  });
  it.each(['reopened', 'reclosed'])('does not mutate a newer %s generation on old rejection', async (state) => {
    const fresh = { ...issue, state: state === 'reopened' ? 'open' : 'closed',
      closed_at: state === 'reopened' ? null : '2026-10-01T01:05:00Z' } as typeof issue;
    const r = await execute({ invalid: true, issues: [issue, fresh] });
    expect(r.api.issues.update).not.toHaveBeenCalled(); expect(r.api.issues.addLabels).not.toHaveBeenCalled();
    expect(r.api.issues.createComment).not.toHaveBeenCalled(); expect(r.core.notice).toHaveBeenCalled();
  });
  it('ignores a stale close event already replaced before initial read', async () => {
    const r = await execute({ invalid: true, issues: [{ ...issue, closed_at: '2026-10-01T01:05:00Z' }] });
    expect(r.api.issues.update).not.toHaveBeenCalled(); expect(r.api.issues.createComment).not.toHaveBeenCalled();
  });
  it('still reopens an invalid unchanged close generation', async () => {
    const r = await execute({ invalid: true }); expect(r.error).toBeUndefined();
    expect(r.api.issues.update).toHaveBeenCalledWith(expect.objectContaining({ state: 'open' }));
    expect(r.core.setFailed).toHaveBeenCalled();
  });
  it('keeps same-generation capture reruns idempotent', async () => {
    const r = await execute({ capture: true }); expect(r.error).toBeUndefined();
    expect(r.api.issues.update).not.toHaveBeenCalled(); expect(r.api.issues.createComment).not.toHaveBeenCalled();
  });
  it('does not capture a close when current-main CI is still pending', async () => {
    const r = await execute({ ci: { conclusion: null } }); expect(r.core.setFailed).toHaveBeenCalled();
    expect(r.api.issues.createComment.mock.calls.every(([x]) => !x.body.includes('EVENT: ISSUE_CLOSED_OBSERVED'))).toBe(true);
  });
  it.each(['branchReadError', 'issueReadError'] as const)('fails closed on %s without reopening or capture', async (key) => {
    const r = await execute({ [key]: true, invalid: key === 'issueReadError' });
    expect(r.error).toBeDefined(); expect(r.api.issues.update).not.toHaveBeenCalled();
    expect(r.api.issues.createComment).not.toHaveBeenCalled();
  });
});
