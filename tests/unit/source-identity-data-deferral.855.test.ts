import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { evaluateAstra, evaluateGithubAstra, routing, changeDigestOf } from '../../scripts/agents/astra-review-policy.mjs';
import { finalRiskReviewerErrors } from '../../scripts/agents/final-risk-cost-policy.mjs';

const scope = routing.sourceIdentityDataDeferral;
const proof = { trusted: true, currentMainSha: 'a'.repeat(40), scope, approvalBodySha256: scope.approvalBodySha256, technicalReviewBodySha256: scope.technicalReviewBodySha256 };
const context = { repository: scope.repository, prNumber: scope.prNumber, headSha: scope.headSha, currentHeadSha: scope.headSha,
  baseSha: 'a'.repeat(40), changeDigest: scope.changeDigest, policyVersion: routing.version,
  reviewSurface: 'PRODUCT_SOURCE_FINAL_RISK', testBaseline: 'actual frozen source CI passed', schemaBaseline: 'original eight only, no DB write',
  sourceIdentityDataDeferralEvidence: proof };
const payload = { ...context, sourceIdentityDataDeferralEvidence: undefined,
  reviewerTier: 'AUDIT', requestedModel: routing.models.audit, actualModel: 'unknown', identityEvidence: 'UNKNOWN',
  executionEvidence: 'OPERATOR_ATTESTED', servedVerified: false, costPolicyVersion: '2026-09-17.1',
  downgradeReason: 'HISTORY_UNAVAILABLE', downgradeEvidenceRef: scope.approvalComment,
  reviewLineage: 'source-855-preserved-review-lineage', executionRef: 'operator-scoped-independent-final-review-855',
  adversarialEvidence: 'Checked raw drift, scoped closure and G6 stale catalog refusal', priorFindingsReviewed: true,
  unresolvedFindingCount: 0, verdict: 'PASS', report: scope.technicalReviewComment, findings: 'Independent technical source review found zero unresolved findings' };
const body = `WORKSTREAM: PRODUCT_MAINLINE\nASTRA_RISK: IRREVERSIBLE_DATA\nASTRA_RATIONALE: Source release safety boundary\nASTRA_TEST_BASELINE: ${context.testBaseline}\nASTRA_SCHEMA_BASELINE: ${context.schemaBaseline}`;
const review = () => ({ id: 1, state: 'COMMENTED', commit_id: scope.headSha, submitted_at: '2026-10-13T05:00:00Z', trusted: true,
  body: '```astra-review\n' + JSON.stringify(payload) + '\n```' });
const evaluate = (ctx: Record<string, unknown> = context, reviews = [review()], policy = routing) => evaluateAstra({
  body, changedFiles: ['scripts/db/controlled-production-db-release.mjs'], context: ctx, reviews }, policy);

describe('Owner #855 identity-data deferral keeps source and DB gates distinct', () => {
  it('accepts only the current trusted exact source with truthful unknown identity', () => {
    expect(evaluate().status).toBe('ASTRA_APPROVED');
    expect(evaluate().errors).toEqual([]);
  });
  it.each([
    { prNumber: 854 }, { repository: 'other/repository' }, { headSha: 'b'.repeat(40) },
    { currentHeadSha: 'b'.repeat(40) }, { changeDigest: 'b'.repeat(64) },
    { reviewSurface: 'PRODUCTION_DB_FINAL_RISK' }, { reviewSurface: undefined },
    { sourceIdentityDataDeferralEvidence: undefined },
    { sourceIdentityDataDeferralEvidence: { ...proof, trusted: false } },
    { sourceIdentityDataDeferralEvidence: { ...proof, currentMainSha: 'main' } },
    { sourceIdentityDataDeferralEvidence: { ...proof, approvalBodySha256: 'b'.repeat(64) } },
    { sourceIdentityDataDeferralEvidence: { ...proof, scope: { ...scope, enabled: false } } },
  ])('rejects foreign/stale/non-source/missing main evidence %j', patch => {
    expect(evaluate({ ...context, ...patch }).status).toBe('ASTRA_PENDING');
    expect(finalRiskReviewerErrors(payload, routing, { ...context, ...patch }).join(' ')).toMatch(/role evidence/);
  });
  it('cannot be enabled by attestation payload or disabled/partial policy', () => {
    const malicious = { ...review(), body: '```astra-review\n' + JSON.stringify({ ...payload, sourceIdentityDataDeferralEvidence: proof }) + '\n```' };
    expect(evaluate({ ...context, sourceIdentityDataDeferralEvidence: undefined }, [malicious]).status).toBe('ASTRA_PENDING');
    expect(evaluate(context, [review()], { ...routing, sourceIdentityDataDeferral: { ...scope, enabled: false } }).status).toBe('ASTRA_PENDING');
    expect(finalRiskReviewerErrors(payload, { ...routing, sourceIdentityDataDeferral: { enabled: true, version: scope.version } }, context).length).toBeGreaterThan(0);
  });
  it.each([{ verdict: 'FIX_REQUIRED' }, { unresolvedFindingCount: 1 }, { priorFindingsReviewed: false },
    { testBaseline: 'stale test evidence' }, { schemaBaseline: 'stale schema evidence' },
    { requestedModel: 'gpt-6-astra' }, { identityEvidence: 'OPERATOR_ATTESTED' }, { servedVerified: true },
    { servedVerified: 'true' }, { executionEvidence: 'UNKNOWN' }, { report: scope.approvalComment }, { report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/855#issuecomment-1' }])('preserves findings/baseline/model gates %j', patch => {
    const changed = { ...review(), body: '```astra-review\n' + JSON.stringify({ ...payload, ...patch }) + '\n```' };
    expect(evaluate(context, [changed]).status).toBe('ASTRA_PENDING');
  });
  it('newer dismissal and changes requested cannot be covered by older PASS', () => {
    for (const state of ['DISMISSED', 'CHANGES_REQUESTED']) {
      expect(evaluate(context, [review(), { ...review(), id: 2, state, submitted_at: '2026-10-13T05:01:00Z' }]).status).toBe('ASTRA_PENDING');
    }
  });
});

describe('actual source GitHub adapter requires main bytes and unchanged pinned approval', () => {
  // Synthetic API fixtures only; no claim of real GitHub/DB approval.
  const files = [{ filename: 'scripts/db/controlled-production-db-release.mjs', status: 'modified', sha: 'c'.repeat(40) }];
  const digest = changeDigestOf(files);
  const approval = { html_url: scope.approvalComment, user: { login: scope.approvalActorLogin, id: scope.approvalActorId }, body: 'Owner synthetic deferral approval' };
  const technicalReview = { html_url: scope.technicalReviewComment, user: approval.user, body: 'Frozen independent technical PASS, not built by reviewer' };
  const scoped = { ...scope, changeDigest: digest, approvalBodySha256: createHash('sha256').update(approval.body).digest('hex'), technicalReviewBodySha256: createHash('sha256').update(technicalReview.body).digest('hex') };
  const policy = { ...routing, sourceIdentityDataDeferral: scoped };
  const current = { number: 855, state: 'open', draft: false, created_at: '2026-10-12T16:00:00Z', body: body + '\nLANE_STATE: ACTIVE',
    changed_files: 1, head: { sha: scope.headSha }, base: { sha: 'a'.repeat(40) } };
  const rawReview = { ...review(), user: { login: 'smallwei0301', id: 206991894, type: 'User' },
    body: '```astra-review\n' + JSON.stringify({ ...payload, changeDigest: digest }) + '\n```' };
  function github(overrides: Record<string, unknown> = {}) {
    const bytes = Buffer.from(JSON.stringify({ sourceIdentityDataDeferral: scoped }));
    const file = { type: 'file', encoding: 'base64', content: bytes.toString('base64'),
      sha: createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex') };
    let commits = 0;
    const pulls = { listFiles: 'files', listReviews: 'reviews' };
    return { paginate: async (method: string) => method === 'files' ? files : [rawReview], rest: { pulls,
      repos: { getCollaboratorPermissionLevel: async () => ({ data: { permission: 'admin' } }),
        getCommit: async () => ({ data: { sha: overrides.mainMoved && ++commits > 1 ? 'b'.repeat(40) : 'a'.repeat(40) } }),
        getContent: async () => ({ data: overrides.file ?? file }) },
      issues: { getComment: async ({ comment_id }: { comment_id: number }) => {
        if (comment_id === 6138187919) {
          if (overrides.reviewDeleted) throw Error('missing independent review');
          return { data: overrides.technicalReview ?? technicalReview };
        }
        if (overrides.deleted || comment_id !== 6137971029) throw Error('missing source');
        return { data: overrides.approval ?? approval };
      } } } };
  }
  it('accepts a real-adapter synthetic positive control without role receipts', async () => {
    expect((await evaluateGithubAstra({ github: github(), owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current }, policy)).status).toBe('ASTRA_APPROVED');
  });
  it.each([{ deleted: true }, { approval: { ...approval, body: 'edited approval' } },
    { approval: { ...approval, user: { ...approval.user, id: 1 } } },
    { approval: { ...approval, html_url: 'https://github.com/other/repo/pull/855#issuecomment-6137971029' } },
    { file: { type: 'file', encoding: 'base64', content: Buffer.from('{}').toString('base64'), sha: 'b'.repeat(40) } },
    { mainMoved: true }, { reviewDeleted: true },
    { technicalReview: { ...technicalReview, body: 'Builder self-review PASS replacing independent review' } },
    { technicalReview: { ...technicalReview, user: { ...technicalReview.user, id: 1 } } },
    { technicalReview: { ...technicalReview, html_url: scope.approvalComment } }])('rejects revoked/foreign/corrupt/racing source %j', async overrides => {
    expect((await evaluateGithubAstra({ github: github(overrides), owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', current }, policy)).status).toBe('ASTRA_PENDING');
  });
});
