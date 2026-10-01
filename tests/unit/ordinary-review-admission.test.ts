import { createRequire } from 'node:module';
import { parse } from 'yaml';
import { describe, expect, it, vi } from 'vitest';
import { changeDigestOf, evaluateGithubAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
const repo = 'smallwei0301/vibeaico-admin-rebuild';
const bot = { login: 'claude[bot]', id: 209825114, type: 'Bot' };
const files = [{ filename: 'src/lib/ordinary-fixture.ts', status: 'modified', sha: 'c'.repeat(40) }];
const digest = changeDigestOf(files), head = 'b'.repeat(40);
const source = (id: number) => `https://github.com/${repo}/pull/900#issuecomment-${id}`;
const body = 'WORKSTREAM: PRODUCT_MAINLINE\nAGENT_LANE: TERRA_BUILD\nLANE_STATE: ACTIVE\nASTRA_RISK: NONE\nASTRA_RATIONALE: Synthetic bounded ordinary source change\nBUILDER_EXECUTION_RECEIPT: ' + source(101);
const current = { number: 900, state: 'open', draft: false, changed_files: 1, created_at: '2026-10-01T00:00:00Z', body, head: { sha: head }, base: { sha: 'a'.repeat(40) } };
function fixture({ proof = true, self = false, latestVeto = false, rolePatch = {} as Record<string, unknown>, reviewPatch = {} as Record<string, unknown>, foreignSource = false, untrusted = false } = {}) {
  const role = (kind: string) => ({ role: kind, repository: repo, headSha: head, changeDigest: digest,
    actorId: self ? 'fixture-builder' : `fixture-${kind}`, sessionId: `session-${kind}`, executionRef: `execution-${kind}`,
    provider: 'OPENAI', providerEvidenceRef: source(104), requestedModel: 'gpt-6.1-sol',
    startedAt: '2026-10-01T00:01:00Z', completedAt: '2026-10-01T00:01:00Z', freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED', ...rolePatch });
  const receipt = { repository: repo, headSha: head, changeDigest: digest, policyVersion: routing.version,
    requestedModel: 'gpt-6.1-sol', actualModel: 'unknown', identityEvidence: 'UNKNOWN', servedVerified: false,
    executionRef: 'execution-REVIEW', reviewerExecutionReceipt: source(102), verdict: 'PASS',
    report: source(103), findings: 'Synthetic independent counterexamples checked', ...reviewPatch };
  const review = { id: 1, state: 'COMMENTED', commit_id: head, submitted_at: '2026-10-01T00:03:00Z', user: untrusted ? { ...bot, id: 999 } : bot,
    body: '```sol-review\n' + JSON.stringify(receipt) + '\n```' };
  const listFiles = vi.fn(), listReviews = vi.fn();
  const getComment = vi.fn(async ({ comment_id }: any) => {
    if (!proof) throw new Error('missing role capture');
    return { data: { html_url: foreignSource ? 'https://github.com/other/repo/issues/1#issuecomment-101' : source(comment_id), updated_at: '2026-10-01T00:02:00Z', user: bot,
      body: '```agent-role-execution\n' + JSON.stringify(role(comment_id === 101 ? 'BUILD' : 'REVIEW')) + '\n```' } };
  });
  return { listReviews, getComment, github: { rest: { pulls: { listFiles, listReviews }, issues: { getComment }, repos: { getCollaboratorPermissionLevel: vi.fn(async () => ({ data: { permission: 'read' } })) } },
    paginate: vi.fn(async (method: any) => method === listFiles ? files : [review, ...(latestVeto ? [{ ...review, id: 2, submitted_at: '2026-10-01T00:04:00Z', state: 'CHANGES_REQUESTED', body: 'blocking finding' }] : [])]) } };
}
const run = (f: ReturnType<typeof fixture>, pr = current) => evaluateGithubAstra({ github: f.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: pr });
describe('ordinary independent final review admission; all fixtures synthetic, no served identity claim', () => {
  it.each([{ proof: false }, { self: true }])('rejects missing or self-reviewed low-risk Product proof %j', async opts => {
    const result = await run(fixture(opts)); expect(result.required).toBe(false); expect(result.status).toBe('SOL_REVIEW_PENDING'); expect(result.errors.length).toBeGreaterThan(0);
  });
  it('accepts independent current Sol execution with honest unknown actual without premium review', async () => {
    const result = await run(fixture()); expect(result.required).toBe(false); expect(result.status).toBe('SOL_REVIEW_APPROVED'); expect(result.errors).toEqual([]);
  });
  it('does not let payload stage suppress the live non-draft final gate', async () => {
    const result = await run(fixture({ self: true }), { ...current, body: body + '\nSOL_REVIEW_STAGE: BUILD' }); expect(result.status).toBe('SOL_REVIEW_PENDING');
  });
  it('latest trusted finding vetoes older ordinary PASS', async () => expect((await run(fixture({ latestVeto: true }))).status).toBe('SOL_REVIEW_PENDING'));
  it.each([
    { foreignSource: true }, { untrusted: true }, { rolePatch: { headSha: 'e'.repeat(40) } },
    { rolePatch: { changeDigest: 'f'.repeat(64) } }, { rolePatch: { freshContext: false } },
    { rolePatch: { provider: 'UNKNOWN' } }, { rolePatch: { requestedModel: 'gpt-6-astra' } },
    { reviewPatch: { actualModel: 'unknown', servedVerified: true } },
    { reviewPatch: { actualModel: 'unknown', servedVerified: 'true' } },
    { reviewPatch: { headSha: 'e'.repeat(40) } }, { reviewPatch: { verdict: 'FAIL' } },
  ])('rejects invalid trusted-source/role/model/identity claims %j', async opts => {
    expect((await run(fixture(opts))).status).toBe('SOL_REVIEW_PENDING');
  });
  it('Draft BUILD remains outside final admission', async () => { const f = fixture({ proof: false }); expect((await run(f, { ...current, draft: true })).status).toBe('NOT_REQUIRED'); expect(f.listReviews).not.toHaveBeenCalled(); expect(f.getComment).not.toHaveBeenCalled(); });
  it('pure governance is exempt without ceremonial role receipts', async () => {
    const f = fixture({ proof: false }); f.github.paginate = vi.fn(async () => [{ filename: 'docs/MODEL-ROUTING.md', status: 'modified', sha: 'c'.repeat(40) }]) as any;
    const governance = { ...current, body: 'WORKSTREAM: MODEL_GOVERNANCE\nAGENT_LANE: GOVERNANCE\nASTRA_RISK: NONE\nASTRA_RATIONALE: Synthetic pure governance\nFINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY' };
    expect((await run(f, governance)).status).toBe('NOT_REQUIRED'); expect(f.getComment).not.toHaveBeenCalled();
  });
});

import { readFileSync } from 'node:fs';
import { resolveReviewWakeup, finalRiskGateStatus } from '../../scripts/agents/astra-review-policy.mjs';
function wakeupFixture(patch: Record<string, any> = {}, association = true) {
  const f = fixture({ latestVeto: true });
  const live = { ...current, base: { ...current.base, repo: { full_name: repo } }, head: { ...current.head, ref: 'feature', repo: { full_name: repo } } };
  const runRecord = { id: 42, workflow_id: 77, path: '.github/workflows/agent-review-wakeup.yml', event: 'pull_request_review', status: 'completed',
    repository: { full_name: repo }, head_repository: { full_name: repo, owner: { login: 'smallwei0301' } },
    head_branch: 'feature', pull_requests: association ? [{ number: 900 }] : [], ...patch };
  const github = f.github as any;
  github.rest.actions = { getWorkflowRun: vi.fn(async () => ({ data: runRecord })),
    getWorkflow: vi.fn(async () => ({ data: { id: 77, path: '.github/workflows/agent-review-wakeup.yml', state: 'active' } })) };
  github.rest.pulls.get = vi.fn(async () => ({ data: live }));
  github.rest.pulls.list = vi.fn();
  const paginate = github.paginate;
  github.paginate = vi.fn(async (method: any) => method === github.rest.pulls.list ? [live] : paginate(method));
  return { github, f, live };
}
describe('unprivileged review wake-up and trusted current-policy refresh', () => {
  it('review event refresh rereads current PR/latest negative and invalidates old stable success', async () => {
    const { github, live } = wakeupFixture();
    const number = await resolveReviewWakeup({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 });
    expect(number).toBe(900);
    expect(github.rest.pulls.get).toHaveBeenCalled();
    const result = await evaluateGithubAstra({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current: live });
    expect(finalRiskGateStatus({ hasErrors: result.errors.length > 0, finalRiskRequired: true })).toBe('failure');
  });
  it.each([{ path: '.github/workflows/foreign.yml' }, { path: undefined }, { workflow_id: 999 }, { event: 'workflow_dispatch' }, { repository: { full_name: 'foreign/repo' } }, { status: 'in_progress' }])('rejects invalid canonical producer run %j', async patch => {
    const { github } = wakeupFixture(patch);
    await expect(resolveReviewWakeup({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 })).rejects.toThrow();
  });
  it('uses canonical fork head/branch association when workflow_run PR inventory is empty', async () => {
    const { github } = wakeupFixture({}, false);
    expect(await resolveReviewWakeup({ github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 })).toBe(900);
  });
  it('executes the actual trusted consumer invalidation branch: latest veto writes failure with no TEST/comment/label mutation', async () => {
    const { github, live } = wakeupFixture();
    github.rest.repos.createCommitStatus = vi.fn(async () => ({}));
    github.rest.actions.createWorkflowDispatch = vi.fn(async () => { throw new Error('TEST dispatch forbidden'); });
    github.rest.issues.createComment = vi.fn(async () => { throw new Error('Comment mutation forbidden'); });
    const workflow = readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8');
    const parsedGuard = parse(workflow).jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    const branch = parsedGuard.split('// REVIEW_WAKEUP_INVALIDATION_BEGIN')[1].split('// REVIEW_WAKEUP_INVALIDATION_END')[0];
    const summary: any = { addHeading: vi.fn(() => summary), addRaw: vi.fn(() => summary), write: vi.fn(async () => undefined) };
    const astra = await import('../../scripts/agents/astra-review-policy.mjs');
    const policy = await import('../../scripts/agents/dual-terra-wip-policy.mjs');
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('github', 'context', 'owner', 'repo', 'current', 'astra', 'policy', 'core', branch)(github, { eventName: 'workflow_run' }, 'smallwei0301', 'vibeaico-admin-rebuild', live, astra, policy, { summary });
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({ sha: head, state: 'failure', context: 'Agent WIP Policy' }));
    expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });
  it.each(['incomplete-inventory', 'review-REST-unavailable'])('decoded full guard invalidates old success before %s throws', async mode => {
    const { github, live, f } = wakeupFixture();
    const statuses: string[] = ['success'];
    github.rest.repos.createCommitStatus = vi.fn(async (record: any) => { statuses.push(record.state); });
    github.rest.actions.createWorkflowDispatch = vi.fn();
    github.rest.issues.createComment = vi.fn();
    github.paginate = vi.fn(async (method: any) => {
      if (method === f.github.rest.pulls.listFiles) return mode === 'incomplete-inventory' ? [] : files;
      if (method === f.github.rest.pulls.listReviews) throw new Error('Synthetic review REST unavailable');
      throw new Error('Unexpected synthetic read');
    });
    const decoded = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8')).jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    const executable = decoded.replace(/\bimport\s*\(/g, 'loadPolicy(');
    const astra = await import('../../scripts/agents/astra-review-policy.mjs');
    const policy = await import('../../scripts/agents/dual-terra-wip-policy.mjs');
    const loadPolicy = async (url: string) => url.includes('astra-review-policy') ? astra : url.includes('dual-terra-wip-policy') ? policy : {};
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await expect(new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', executable)(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd(), REVIEW_WAKEUP_PR: '900' } }, github, { eventName: 'workflow_run', repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' }, payload: {} }, {}, loadPolicy)).rejects.toThrow(mode === 'incomplete-inventory' ? 'Incomplete changed-file inventory' : 'Synthetic review REST unavailable');
    expect(statuses).toEqual(['success', 'pending']);
    expect(github.rest.repos.createCommitStatus).toHaveBeenCalledWith(expect.objectContaining({ sha: live.head.sha, context: 'Agent WIP Policy', state: 'pending' }));
    expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });
  it('executes YAML-decoded readonly resolver JS and compiles the decoded guard', async () => {
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const resolver = parsed.jobs.review_wakeup;
    expect(resolver.permissions).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    expect(resolver.steps[0].with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(parsed.jobs.guard.steps[0].with.ref).toBe('${{ github.event.repository.default_branch }}');
    const script = resolver.steps.find((step: any) => step.with?.script).with.script;
    const { github } = wakeupFixture();
    const astra = await import('../../scripts/agents/astra-review-policy.mjs');
    const setOutput = vi.fn();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const executable = script.replace(/\bimport\s*\(/g, 'loadPolicy(');
    const nodeRequire = (name: string) => name === 'node:url' ? { pathToFileURL: (path: string) => ({ href: path }) } : { join: (...parts: string[]) => parts.join('/') };
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', executable)(nodeRequire, { env: { GITHUB_WORKSPACE: '/trusted' } }, github, { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' }, payload: { workflow_run: { id: 42 } } }, { setOutput }, async () => astra);
    expect(setOutput).toHaveBeenCalledWith('pr_number', 900);
    const guard = parsed.jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    expect(() => new AsyncFunction('require', 'process', 'github', 'context', 'core', guard)).not.toThrow();
  });
  it('failed producer still refreshes, while foreign PR or ambiguous fallback rejects', async () => {
    const failed = wakeupFixture({ conclusion: 'failure' });
    expect(await resolveReviewWakeup({ github: failed.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 })).toBe(900);
    const foreign = wakeupFixture(); foreign.github.rest.pulls.get.mockResolvedValue({ data: { ...foreign.live, base: { repo: { full_name: 'foreign/repo' } } } });
    await expect(resolveReviewWakeup({ github: foreign.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 })).rejects.toThrow();
    const ambiguous = wakeupFixture({}, false); ambiguous.github.paginate.mockResolvedValue([ambiguous.live, { ...ambiguous.live, number: 901 }]);
    await expect(resolveReviewWakeup({ github: ambiguous.github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', runId: 42 })).rejects.toThrow();
  });
  it('workflow consumer runs trusted-main policy and never dispatches TEST from review wakeups', () => {
    const guard = readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8');
    expect(guard).toContain('workflows: [agent-review-wakeup]');
    expect(guard).toContain("context.eventName !== 'workflow_run'");
    expect(guard).toContain('resolveReviewWakeup');
    const producer = readFileSync('.github/workflows/agent-review-wakeup.yml', 'utf8');
    expect(producer).toContain('permissions: {}');
    expect(producer).toContain('types: [submitted, edited, dismissed]');
    expect(producer).not.toContain('checkout');
    expect(producer).not.toContain('artifact');
    expect(producer).not.toContain('workflow_run:');
  });
});
