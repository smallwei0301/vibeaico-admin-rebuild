import { describe, expect, it, vi } from 'vitest';
import { changeDigestOf, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { buildProductionDbFinalRiskEvidenceFromGithub } from '../../scripts/agents/production-db-final-risk-evidence.mjs';
import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';
import { finalRiskReviewerErrors } from '../../scripts/agents/final-risk-cost-policy.mjs';

// Current policy, no mock: independentReviewerRequired must be true for this suite to mean anything.
const REPO = 'smallwei0301/vibeaico-admin-rebuild';
const BASE = '1'.repeat(40), HEAD = '2'.repeat(40), MAIN = '5'.repeat(40), PLAN = '4'.repeat(64);
const RELEASE = 'release-20260914-001';
const BOT = { login: 'claude[bot]', id: 209825114, type: 'Bot' };
const FILES = [{ filename: 'ops/production-db-releases/release-20260914-001.json', previous_filename: null, status: 'added', sha: 'a'.repeat(40) }];
const CHANGE = changeDigestOf(FILES);
const TEST_BASELINE = 'trusted main shared TEST integration and E2E evidence';
const SCHEMA_BASELINE = 'scoped Production DB schema release evidence';
const BUILD_URL = `https://github.com/${REPO}/pull/999#issuecomment-101`;
const REVIEW_URL = `https://github.com/${REPO}/pull/999#issuecomment-102`;
const EXEC_REF = 'final-risk-execution-755';

const packet = () => ({
  schemaVersion: 1, releaseId: RELEASE, repository: REPO, productionProjectRef: 'egehnijjpgijmccagxac', mainSha: MAIN,
  planDigest: PLAN, riskTier: 'ADDITIVE',
  source: { status: 'SOURCE_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false },
  consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T09:50:00Z', mainSha: MAIN, planDigest: PLAN },
  test: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 12, cleanup: 'PASSED', mainSha: MAIN, planDigest: PLAN },
  recovery: { status: 'RECOVERY_VERIFIED', backupObservedAt: '2026-09-14T09:30:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z', storageObjectsCovered: false },
});

const receipt = (kind: 'BUILD' | 'REVIEW', patch: Record<string, unknown> = {}) => ({
  role: kind, repository: REPO, headSha: HEAD, changeDigest: CHANGE,
  sourceRef: kind === 'BUILD' ? BUILD_URL : REVIEW_URL,
  actorId: `actor-${kind}`, sessionId: `session-${kind}`, executionRef: kind === 'REVIEW' ? EXEC_REF : 'build-execution-755',
  startedAt: kind === 'BUILD' ? '2026-09-14T09:00:00Z' : '2026-09-14T09:11:00Z',
  completedAt: kind === 'BUILD' ? '2026-09-14T09:10:00Z' : '2026-09-14T09:20:00Z',
  freshContext: kind === 'REVIEW', executionEvidence: 'OPERATOR_ATTESTED', ...patch,
});

function setup(opts: { builderPatch?: Record<string, unknown>; reviewerPatch?: Record<string, unknown>; withBuilderField?: boolean } = {}) {
  const { builderPatch = {}, reviewerPatch = {}, withBuilderField = true } = opts;
  const attestation = {
    repository: REPO, policyVersion: routing.version, baseSha: BASE, headSha: HEAD,
    testBaseline: TEST_BASELINE, schemaBaseline: SCHEMA_BASELINE, changeDigest: CHANGE,
    requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1', identityEvidence: 'OPERATOR_ATTESTED',
    verdict: 'PASS', report: `https://github.com/${REPO}/pull/999#pullrequestreview-456`,
    findings: 'Production DB release independently reviewed.', executionRef: EXEC_REF, reviewerExecutionReceipt: REVIEW_URL,
    productionDbReviewScope: 'PRODUCTION_DB_RELEASE', productionDbReleaseId: RELEASE, productionDbPlanDigest: PLAN,
    productionDbEvidenceDigest: releaseEvidenceDigestOf(packet()),
  };
  const reviews = [{ state: 'COMMENTED', commit_id: HEAD, submitted_at: '2026-09-14T09:25:00Z', id: 456, user: BOT,
    body: `astra-review\n\n\`\`\`astra-review\n${JSON.stringify(attestation)}\n\`\`\`` }];
  const body = ['WORKSTREAM: PRODUCT_MAINLINE', 'ASTRA_RISK: GOVERNANCE_GATE',
    'ASTRA_RATIONALE: Production DB release changes a protected database execution boundary.',
    `ASTRA_TEST_BASELINE: ${TEST_BASELINE}`, `ASTRA_SCHEMA_BASELINE: ${SCHEMA_BASELINE}`,
    ...(withBuilderField ? [`BUILDER_EXECUTION_RECEIPT: ${BUILD_URL}`] : [])].join('\n');
  const listFiles = vi.fn(), listReviews = vi.fn();
  const comments: Record<number, unknown> = {
    101: receipt('BUILD', builderPatch), 102: receipt('REVIEW', reviewerPatch),
  };
  const github = {
    rest: {
      pulls: { get: vi.fn(async () => ({ data: { number: 999, body, changed_files: FILES.length, created_at: '2026-09-14T08:00:00Z',
        base: { sha: BASE }, head: { sha: HEAD } } })), listFiles, listReviews },
      repos: { getCollaboratorPermissionLevel: vi.fn(async () => ({ data: { permission: 'read' } })) },
      issues: { getComment: vi.fn(async ({ comment_id }: { comment_id: number }) => ({ data: {
        html_url: (comments[comment_id] as any).sourceRef, user: BOT, updated_at: '2026-09-14T09:21:00Z',
        body: '```agent-role-execution\n' + JSON.stringify(comments[comment_id]) + '\n```' } })) },
    },
    paginate: vi.fn(async (m: unknown) => m === listFiles ? FILES : m === listReviews ? reviews : Promise.reject(new Error('unexpected'))),
  };
  return github;
}

const run = (github: any) => buildProductionDbFinalRiskEvidenceFromGithub({
  github, owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', prNumber: 999, releasePacket: packet() });

describe('Production DB Final Risk role evidence read-back (Owner option A)', () => {
  it('uses the current policy with independent reviewer required', () => {
    expect(routing.openaiBuilderDecision.independentReviewerRequired).toBe(true);
  });

  it('accepts trusted BUILD/REVIEW receipts and preflight sees no role error', async () => {
    const evidence: any = await run(setup());
    expect(evidence.roleEvidence).toMatchObject({ trusted: true,
      builder: { role: 'BUILD', headSha: HEAD }, reviewer: { role: 'REVIEW', executionRef: EXEC_REF } });
    const errors = finalRiskReviewerErrors(evidence, routing, { repository: REPO, headSha: evidence.headSha,
      changeDigest: evidence.changeDigest, roleEvidence: evidence.roleEvidence, fallbackSourceEvidence: evidence.fallbackSourceEvidence });
    expect(errors).toEqual([]);
    // No context (the pre-fix preflight call) still fails closed.
    expect(finalRiskReviewerErrors(evidence, routing)).toContain('Missing independently read-back builder/reviewer role evidence');
  });

  it('rejects when BUILDER_EXECUTION_RECEIPT is missing', async () => {
    await expect(run(setup({ withBuilderField: false }))).rejects.toThrow(/FINAL_RISK_NOT_APPROVED/);
  });

  it('rejects when builder and reviewer are the same actor', async () => {
    await expect(run(setup({ builderPatch: { actorId: 'actor-REVIEW' } }))).rejects.toThrow(/FINAL_RISK_NOT_APPROVED/);
  });

  it('rejects when a receipt headSha does not match', async () => {
    await expect(run(setup({ reviewerPatch: { headSha: '9'.repeat(40) } }))).rejects.toThrow(/FINAL_RISK_NOT_APPROVED/);
  });
});
