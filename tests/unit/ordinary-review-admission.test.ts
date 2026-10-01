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
import { resolveReviewWakeup, resolveRoleReceiptWakeup, finalRiskGateStatus } from '../../scripts/agents/astra-review-policy.mjs';
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
  it('decoded review fallback ignores closed same-branch history and accepts advanced current head', async () => {
    const { github, live } = wakeupFixture({ head_sha: 'a'.repeat(40) }, false);
    const advanced = { ...live, head: { ...live.head, sha: 'd'.repeat(40) } };
    github.rest.pulls.get.mockResolvedValue({ data: advanced });
    github.paginate.mockResolvedValue([{ ...live, number: 899, state: 'closed' }, advanced]);
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const decoded = parsed.jobs.review_wakeup.steps.find((step: any) => step.with?.script).with.script;
    const astra = await import('../../scripts/agents/astra-review-policy.mjs'); const setOutput = vi.fn();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', decoded.replace(/\bimport\s*\(/g, 'loadPolicy('))(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd() } }, github, { eventName: 'workflow_run', repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' }, payload: { workflow_run: { id: 42 } } }, { setOutput }, async () => astra);
    expect(setOutput).toHaveBeenCalledWith('pr_numbers', '[900]');
    expect(github.paginate).toHaveBeenCalledWith(github.rest.pulls.list, expect.objectContaining({ state: 'open', head: 'smallwei0301:feature' }));
  });
  it('fallback rejects a candidate closed during live read and preserves true two-open ambiguity', async () => {
    const { github, live } = wakeupFixture({}, false);
    github.rest.pulls.get.mockResolvedValue({ data: { ...live, state: 'closed' } });
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
    await new AsyncFunction('github', 'context', 'owner', 'repo', 'current', 'astra', 'policy', 'core', 'reviewWakeup', branch)(github, { eventName: 'workflow_run' }, 'smallwei0301', 'vibeaico-admin-rebuild', live, astra, policy, { summary }, true);
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
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', executable)(nodeRequire, { env: { GITHUB_WORKSPACE: '/trusted' } }, github, { eventName: 'workflow_run', repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' }, payload: { workflow_run: { id: 42 } } }, { setOutput }, async () => astra);
    expect(setOutput).toHaveBeenCalledWith('pr_numbers', '[900]');
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


describe('role receipt edit/delete authoritative fan-out (synthetic)', () => {
  const wake = { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', repository: repo, issueNumber: 900, commentId: 101 };
  function inventoryFixture(kind = 'builder', latestNegative = false) {
    const f = fixture({ latestVeto: latestNegative });
    const base = { ...current, base: { ...current.base, repo: { full_name: repo } } };
    const pr2 = { ...base, number: 901, head: { sha: 'd'.repeat(40) }, body: body };
    const list = vi.fn(); const original = f.github.paginate;
    const github: any = f.github;
    github.rest.pulls.list = list;
    github.rest.pulls.get = vi.fn(async ({ pull_number }: any) => ({ data: pull_number === 900 ? base : pr2 }));
    github.paginate = vi.fn(async (method: any, args: any) => {
      if (method === list) return [base, pr2];
      if (method === github.rest.pulls.listReviews && kind === 'reviewer') return original(method);
      if (method === github.rest.pulls.listReviews) return [];
      return original(method);
    });
    return { github, base, pr2 };
  }
  it.each([false, true])('fans one BUILD comment out to both referenced heads; native=%s never hides second PR', async nativePr => {
    const { github } = inventoryFixture();
    expect(await resolveRoleReceiptWakeup({ github, ...wake, nativePr })).toEqual({ numbers: [900, 901], associationIncomplete: false });
  });
  it.each(['CHANGES_REQUESTED', 'DISMISSED'])('older trusted REVIEW locator is retained when latest %s supersedes PASS', async state => {
    const { github } = inventoryFixture('reviewer', true);
    const original = github.paginate;
    github.paginate = vi.fn(async (method: any, args: any) => { const records = await original(method, args); return method === github.rest.pulls.listReviews ? records.map((record: any) => record.id === 2 ? { ...record, state } : record) : records; });
    expect(await resolveRoleReceiptWakeup({ github, ...wake, commentId: 102 })).toEqual({ numbers: [900, 901], associationIncomplete: false });
  });
  it('executes decoded readonly issue-comment resolver and fans out native plus referenced PRs', async () => {
    const { github } = inventoryFixture();
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const script = parsed.jobs.review_wakeup.steps.find((step: any) => step.with?.script).with.script;
    const astra = await import('../../scripts/agents/astra-review-policy.mjs'); const setOutput = vi.fn();
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', script.replace(/\bimport\s*\(/g, 'loadPolicy('))(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd() } }, github, { eventName: 'issue_comment', repo: { owner: wake.owner, repo: wake.repo }, payload: { repository: { full_name: repo }, issue: { number: 900, pull_request: {} }, comment: { id: 101, body: 'payload body is not read as evidence' } } }, { setOutput }, async () => astra);
    expect(setOutput).toHaveBeenCalledWith('pr_numbers', '[900,901]');
    expect(parsed.jobs.review_wakeup.permissions).toEqual({ contents: 'read', actions: 'read', 'pull-requests': 'read' });
    expect(parsed.jobs.guard.concurrency.group).toBe('agent-wip-guard-${{ github.repository }}-${{ matrix.pr_number }}');
  });
  it('cross-issue receipt references fan out without guessing a native PR', async () => {
    const { github, base, pr2 } = inventoryFixture();
    for (const pr of [base, pr2]) pr.body = pr.body.replace(source(101), `https://github.com/${repo}/issues/700#issuecomment-101`);
    expect(await resolveRoleReceiptWakeup({ github, ...wake, issueNumber: 700 })).toEqual({ numbers: [900, 901], associationIncomplete: false });
  });
  it('untrusted reviews or canonical commit/attested-head mismatches do not manufacture reference associations', async () => {
    for (const malformed of ['untrusted', 'commit-mismatch']) {
      const { github } = inventoryFixture('reviewer'); const original = github.paginate;
      github.paginate = vi.fn(async (method: any, args: any) => {
        const records = await original(method, args);
        return method === github.rest.pulls.listReviews ? records.map((record: any) => malformed === 'untrusted' ? { ...record, user: { login: 'untrusted-actor', id: 999, type: 'User' } } : { ...record, commit_id: 'e'.repeat(40) }) : records;
      });
      expect(await resolveRoleReceiptWakeup({ github, ...wake, commentId: 102 })).toEqual({ numbers: [], associationIncomplete: false });
    }
  });
  it('association review read failure preserves every already located head for pending invalidation', async () => {
    const { github } = inventoryFixture(); const list = github.rest.pulls.list;
    const original = github.paginate;
    github.paginate = vi.fn(async (method: any, args: any) => method === list ? original(method, args) : Promise.reject(new Error('Synthetic association API unavailable')));
    expect(await resolveRoleReceiptWakeup({ github, ...wake, nativePr: true })).toEqual({ numbers: [900, 901], associationIncomplete: true });
  });
  it.each(['reviews', 'permission', 'native-read'])('decoded resolver keeps known potential heads on %s fault, then decoded guard invalidates them pending', async mode => {
    const { github, base, pr2 } = inventoryFixture('reviewer');
    for (const pr of [base, pr2]) pr.body = pr.body.replace(source(101), 'none');
    const original = github.paginate;
    if (mode === 'reviews') github.paginate = vi.fn(async (method: any, args: any) => method === github.rest.pulls.listReviews ? Promise.reject(new Error('Synthetic review listing fault')) : original(method, args));
    if (mode === 'permission') {
      github.paginate = vi.fn(async (method: any, args: any) => { const records = await original(method, args); return method === github.rest.pulls.listReviews ? records.map((record: any) => ({ ...record, user: { login: 'synthetic-write-actor', id: 999, type: 'User' } })) : records; });
      github.rest.repos.getCollaboratorPermissionLevel.mockRejectedValue(Object.assign(new Error('Synthetic permission fault'), { status: 503 }));
    }
    if (mode === 'native-read') github.rest.pulls.get.mockRejectedValueOnce(new Error('Synthetic native PR read fault'));
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const resolver = parsed.jobs.review_wakeup.steps.find((step: any) => step.with?.script).with.script;
    const guard = parsed.jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    const astra = await import('../../scripts/agents/astra-review-policy.mjs'); const policy = await import('../../scripts/agents/dual-terra-wip-policy.mjs');
    const outputs: Record<string, string> = {};
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const execute = (script: string) => new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', script.replace(/\bimport\s*\(/g, 'loadPolicy('));
    await execute(resolver)(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd() } }, github, { eventName: 'issue_comment', repo: { owner: wake.owner, repo: wake.repo }, payload: { repository: { full_name: repo }, issue: { number: 900, ...(mode === 'native-read' ? { pull_request: {} } : {}) }, comment: { id: 102 } } }, { setOutput: (key: string, value: string) => { outputs[key] = value; }, warning: vi.fn() }, async () => astra);
    expect(outputs).toEqual({ pr_numbers: '[900,901]', association_incomplete: 'true' });
    const statuses: any[] = []; github.rest.repos.createCommitStatus = vi.fn(async (record: any) => statuses.push(record)); github.rest.actions = { createWorkflowDispatch: vi.fn() }; github.rest.issues.createComment = vi.fn();
    const loadPolicy = async (url: string) => url.includes('astra-review-policy') ? astra : url.includes('dual-terra-wip-policy') ? policy : {};
    for (const number of JSON.parse(outputs.pr_numbers)) await expect(execute(guard)(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd(), REVIEW_WAKEUP_PR: String(number), RECEIPT_ASSOCIATION_INCOMPLETE: outputs.association_incomplete } }, github, { eventName: 'issue_comment', repo: { owner: wake.owner, repo: wake.repo }, payload: { action: 'deleted' } }, {}, loadPolicy)).rejects.toThrow('Receipt association inventory is incomplete');
    expect(statuses.map(record => [record.sha, record.state])).toEqual([[head, 'pending'], ['d'.repeat(40), 'pending']]);
    expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled(); expect(github.rest.issues.createComment).not.toHaveBeenCalled();
  });
  it.each([null, { number: 900, state: 'open', head: { sha: head }, base: { repo: { full_name: 'foreign/repo' } } }])('malformed/foreign native GET data still rejects rather than becoming partial authority', async data => {
    const { github } = inventoryFixture(); github.rest.pulls.get.mockResolvedValue({ data });
    await expect(resolveRoleReceiptWakeup({ github, ...wake, nativePr: true })).rejects.toThrow('Foreign or invalid native receipt PR');
  });
  it('foreign repository/source cannot become a trusted receipt wake-up', async () => {
    const { github } = inventoryFixture();
    await expect(resolveRoleReceiptWakeup({ github, ...wake, repository: 'foreign/repo' })).rejects.toThrow('Invalid canonical receipt event');
  });
  it('decoded partial-association fan-out invalidates every known head before refusing evidence reads', async () => {
    const f = fixture(); const github: any = f.github; const statuses: any[] = [];
    github.rest.repos.createCommitStatus = vi.fn(async (record: any) => statuses.push(record));
    github.rest.issues.createComment = vi.fn(); github.rest.actions = { createWorkflowDispatch: vi.fn() };
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const decoded = parsed.jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    const astra = await import('../../scripts/agents/astra-review-policy.mjs');
    const policy = await import('../../scripts/agents/dual-terra-wip-policy.mjs');
    const loadPolicy = async (url: string) => url.includes('astra-review-policy') ? astra : url.includes('dual-terra-wip-policy') ? policy : {};
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    for (const [number, sha] of [[900, head], [901, 'd'.repeat(40)]] as const) {
      github.rest.pulls.get = vi.fn(async () => ({ data: { ...current, number, head: { sha } } }));
      await expect(new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', decoded.replace(/\bimport\s*\(/g, 'loadPolicy('))(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd(), REVIEW_WAKEUP_PR: String(number), RECEIPT_ASSOCIATION_INCOMPLETE: 'true' } }, github, { eventName: 'issue_comment', repo: { owner: wake.owner, repo: wake.repo }, payload: { action: 'deleted' } }, {}, loadPolicy)).rejects.toThrow('Receipt association inventory is incomplete');
    }
    expect(statuses.map(record => [record.sha, record.state])).toEqual([[head, 'pending'], ['d'.repeat(40), 'pending']]);
    expect(f.github.paginate).not.toHaveBeenCalled(); expect(github.rest.issues.createComment).not.toHaveBeenCalled(); expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
  });
  it.each(['edited', 'deleted'])('decoded full guard %s receipt makes pending before canonical GET failure and then fails without TEST/comments', async action => {
    const f = fixture(); const github: any = f.github; const statuses: string[] = ['success'];
    github.rest.pulls.get = vi.fn(async () => ({ data: current }));
    github.rest.repos.createCommitStatus = vi.fn(async (record: any) => statuses.push(record.state));
    github.rest.issues.getComment = vi.fn(async () => { throw Object.assign(new Error('Synthetic deleted role'), { status: 404 }); });
    github.rest.issues.createComment = vi.fn(); github.rest.actions = { createWorkflowDispatch: vi.fn() };
    const parsed = parse(readFileSync('.github/workflows/agent-wip-guard.yml', 'utf8'));
    const decoded = parsed.jobs.guard.steps.find((step: any) => step.with?.script).with.script;
    const astra = await import('../../scripts/agents/astra-review-policy.mjs');
    const policy = await import('../../scripts/agents/dual-terra-wip-policy.mjs');
    const summary: any = { addHeading: () => summary, addRaw: () => summary, write: async () => undefined };
    const loadPolicy = async (url: string) => url.includes('astra-review-policy') ? astra : url.includes('dual-terra-wip-policy') ? policy : {};
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('require', 'process', 'github', 'context', 'core', 'loadPolicy', decoded.replace(/\bimport\s*\(/g, 'loadPolicy('))(createRequire(import.meta.url), { env: { GITHUB_WORKSPACE: process.cwd(), REVIEW_WAKEUP_PR: '900' } }, github, { eventName: 'issue_comment', repo: { owner: wake.owner, repo: wake.repo }, payload: { action, issue: { number: 900 }, comment: { body: 'untrusted payload is never proof' } } }, { summary }, loadPolicy);
    expect(statuses).toEqual(['success', 'pending', 'failure']);
    expect(github.rest.issues.getComment).toHaveBeenCalled(); expect(github.rest.issues.createComment).not.toHaveBeenCalled(); expect(github.rest.actions.createWorkflowDispatch).not.toHaveBeenCalled();
    expect(parsed.on.issue_comment.types).toEqual(['created', 'edited', 'deleted']);
    expect(parsed.jobs.guard.strategy.matrix.pr_number).toContain('fromJSON');
    expect(parsed.jobs.guard.strategy['fail-fast']).toBe(false);
    expect(parsed.jobs.guard.concurrency.group).toContain('matrix.pr_number');
  });
});
