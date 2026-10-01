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
