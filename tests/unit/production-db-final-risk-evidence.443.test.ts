import { describe, expect, it, vi } from 'vitest';

import { changeDigestOf, routing } from '../../scripts/agents/astra-review-policy.mjs';
import {
  buildProductionDbFinalRiskEvidence,
  buildProductionDbFinalRiskEvidenceFromGithub,
} from '../../scripts/agents/production-db-final-risk-evidence.mjs';
import { releaseEvidenceDigestOf } from '../../scripts/agents/production-db-release-preflight.mjs';

const BASE = '1'.repeat(40);
const HEAD = '2'.repeat(40);
const CHANGE = '3'.repeat(64);
const PLAN = '4'.repeat(64);
const MAIN = '5'.repeat(40);
const RELEASE = 'release-20260914-001';
const BODY = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'ASTRA_RISK: GOVERNANCE_GATE',
  'ASTRA_RATIONALE: Production DB release changes a protected database execution boundary.',
].join('\n');
const LIVE_TEST_BASELINE = 'trusted main shared TEST integration and E2E evidence';
const LIVE_SCHEMA_BASELINE = 'scoped Production DB schema release evidence';
const LIVE_BODY = [
  BODY,
  `ASTRA_TEST_BASELINE: ${LIVE_TEST_BASELINE}`,
  `ASTRA_SCHEMA_BASELINE: ${LIVE_SCHEMA_BASELINE}`,
].join('\n');
const LIVE_FILES = [
  {
    filename: 'ops/production-db-releases/release-20260914-001.json',
    previous_filename: null,
    status: 'added',
    sha: 'a'.repeat(40),
  },
];
const LIVE_CHANGE = changeDigestOf(LIVE_FILES);

function releasePacket() {
  return {
    schemaVersion: 1,
    releaseId: RELEASE,
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'ADDITIVE',
    source: { status: 'SOURCE_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false },
    consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T09:50:00Z', mainSha: MAIN, planDigest: PLAN },
    test: { status: 'TEST_VERIFIED', policySkip: false, executedTests: 12, cleanup: 'PASSED', mainSha: MAIN, planDigest: PLAN },
    recovery: { status: 'RECOVERY_VERIFIED', backupObservedAt: '2026-09-14T09:30:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z', storageObjectsCovered: false },
  };
}

function context() {
  return {
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    baseSha: BASE,
    headSha: HEAD,
    policyVersion: routing.version,
    testBaseline: 'TEST baseline passed with real execution',
    schemaBaseline: 'schema baseline matched scoped release evidence',
    changeDigest: CHANGE,
    createdAt: '2026-09-14T08:00:00Z',
  };
}

function review(overrides: Record<string, unknown> = {}) {
  const packet = releasePacket();
  const evidenceDigest = releaseEvidenceDigestOf(packet);
  const attestation = {
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    policyVersion: routing.version,
    baseSha: BASE,
    headSha: HEAD,
    testBaseline: 'TEST baseline passed with real execution',
    schemaBaseline: 'schema baseline matched scoped release evidence',
    changeDigest: CHANGE,
    requestedModel: 'claude-fable-5-1',
    actualModel: 'claude-fable-5-1',
    identityEvidence: 'OPERATOR_ATTESTED',
    verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/999#pullrequestreview-123',
    findings: 'Production DB release plan and evidence were independently reviewed.',
    productionDbReviewScope: 'PRODUCTION_DB_RELEASE',
    productionDbReleaseId: RELEASE,
    productionDbPlanDigest: PLAN,
    productionDbEvidenceDigest: evidenceDigest,
    ...overrides,
  };
  return {
    trusted: true,
    trustSource: 'TRUSTED_AGENT_BOT',
    state: 'COMMENTED',
    commit_id: HEAD,
    submitted_at: '2026-09-14T09:20:00Z',
    id: 123,
    user: { login: 'claude[bot]', id: 209825114, type: 'Bot' },
    body: `astra-review\n\n\`\`\`astra-review\n${JSON.stringify(attestation)}\n\`\`\``,
  };
}

function liveReview(overrides: Record<string, unknown> = {}, user: any = { login: 'claude[bot]', id: 209825114, type: 'Bot' }) {
  const packet = releasePacket();
  const attestation = {
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    policyVersion: routing.version,
    baseSha: BASE,
    headSha: HEAD,
    testBaseline: LIVE_TEST_BASELINE,
    schemaBaseline: LIVE_SCHEMA_BASELINE,
    changeDigest: LIVE_CHANGE,
    requestedModel: 'claude-fable-5-1',
    actualModel: 'claude-fable-5-1',
    identityEvidence: 'OPERATOR_ATTESTED',
    verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/999#pullrequestreview-456',
    findings: 'Live GitHub Final Risk independently reviewed the exact Production DB release evidence.',
    productionDbReviewScope: 'PRODUCTION_DB_RELEASE',
    productionDbReleaseId: RELEASE,
    productionDbPlanDigest: PLAN,
    productionDbEvidenceDigest: releaseEvidenceDigestOf(packet),
    ...overrides,
  };
  return {
    state: 'COMMENTED',
    commit_id: HEAD,
    submitted_at: '2026-09-14T09:25:00Z',
    id: 456,
    user,
    body: `astra-review\n\n\`\`\`astra-review\n${JSON.stringify(attestation)}\n\`\`\``,
  };
}

function fakeGithub({
  files = LIVE_FILES,
  reviews = [liveReview()],
  changedFiles = files.length,
  permission = 'read',
} = {}) {
  const listFiles = vi.fn();
  const listReviews = vi.fn();
  const get = vi.fn(async () => ({
    data: {
      number: 999,
      body: LIVE_BODY,
      changed_files: changedFiles,
      created_at: '2026-09-14T08:00:00Z',
      base: { sha: BASE },
      head: { sha: HEAD },
    },
  }));
  const getCollaboratorPermissionLevel = vi.fn(async () => ({ data: { permission } }));
  const github = {
    rest: {
      pulls: { get, listFiles, listReviews },
      repos: { getCollaboratorPermissionLevel },
    },
    paginate: vi.fn(async (method: any) => {
      if (method === listFiles) return files;
      if (method === listReviews) return reviews;
      throw new Error('unexpected paginate method');
    }),
  };
  return { github, get, getCollaboratorPermissionLevel };
}

describe('Production DB Final Risk evidence adapter', () => {
  it('converts a trusted existing Astra/Fable review into release-bound evidence', () => {
    const packet = releasePacket();
    const result = buildProductionDbFinalRiskEvidence({
      body: BODY,
      changedFiles: ['ops/production-db-releases/release-20260914-001.json'],
      context: context(),
      reviews: [review()],
      releasePacket: packet,
    });
    expect(result).toMatchObject({
      status: 'ASTRA_APPROVED',
      requestedModel: 'claude-fable-5-1',
      actualModel: 'claude-fable-5-1',
      releaseId: RELEASE,
      planDigest: PLAN,
      evidenceDigest: releaseEvidenceDigestOf(packet),
      databaseMutationAuthorized: false,
    });
  });

  it('rejects release, plan, or evidence mismatch even when the ordinary Product review is otherwise PASS', () => {
    for (const overrides of [
      { productionDbReleaseId: 'release-other-001' },
      { productionDbPlanDigest: '6'.repeat(64) },
      { productionDbEvidenceDigest: '7'.repeat(64) },
    ]) {
      expect(() => buildProductionDbFinalRiskEvidence({
        body: BODY,
        changedFiles: ['ops/production-db-releases/release-20260914-001.json'],
        context: context(),
        reviews: [review(overrides)],
        releasePacket: releasePacket(),
      })).toThrow(/FINAL_RISK_(RELEASE|PLAN|EVIDENCE)_MISMATCH/);
    }
  });

  it('rejects a review that is not explicitly scoped to Production DB release', () => {
    expect(() => buildProductionDbFinalRiskEvidence({
      body: BODY,
      changedFiles: ['ops/production-db-releases/release-20260914-001.json'],
      context: context(),
      reviews: [review({ productionDbReviewScope: 'SOURCE_PR_ONLY' })],
      releasePacket: releasePacket(),
    })).toThrow(/FINAL_RISK_SCOPE_MISMATCH/);
  });

  it('does not resurrect a FIX_REQUIRED review just because release metadata matches', () => {
    expect(() => buildProductionDbFinalRiskEvidence({
      body: BODY,
      changedFiles: ['ops/production-db-releases/release-20260914-001.json'],
      context: context(),
      reviews: [review({ verdict: 'FIX_REQUIRED' })],
      releasePacket: releasePacket(),
    })).toThrow(/FINAL_RISK_NOT_APPROVED/);
  });

  it('does not accept an untrusted review record', () => {
    const untrusted = review();
    untrusted.trusted = false;
    expect(() => buildProductionDbFinalRiskEvidence({
      body: BODY,
      changedFiles: ['ops/production-db-releases/release-20260914-001.json'],
      context: context(),
      reviews: [untrusted],
      releasePacket: releasePacket(),
    })).toThrow(/FINAL_RISK_NOT_APPROVED/);
  });

  it('reconstructs Final Risk from live GitHub PR/files/reviews using the trusted bot root', async () => {
    const { github, getCollaboratorPermissionLevel } = fakeGithub();
    const packet = releasePacket();
    const result = await buildProductionDbFinalRiskEvidenceFromGithub({
      github,
      owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild',
      prNumber: 999,
      releasePacket: packet,
    });
    expect(result).toMatchObject({
      status: 'ASTRA_APPROVED',
      releaseId: RELEASE,
      planDigest: PLAN,
      evidenceDigest: releaseEvidenceDigestOf(packet),
      sourcePrNumber: 999,
      sourcePrHeadSha: HEAD,
      changeDigest: LIVE_CHANGE,
      trustSource: 'TRUSTED_AGENT_BOT',
      databaseMutationAuthorized: false,
    });
    expect(getCollaboratorPermissionLevel).not.toHaveBeenCalled();
  });

  it('fails closed when GitHub changed-file inventory is incomplete', async () => {
    const { github } = fakeGithub({ changedFiles: 2 });
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({
      github,
      owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild',
      prNumber: 999,
      releasePacket: releasePacket(),
    })).rejects.toThrow(/FINAL_RISK_CHANGED_FILES_INCOMPLETE/);
  });

  it('does not trust a lookalike bot without the trusted immutable identity or write permission', async () => {
    const lookalike = liveReview({}, { login: 'claude[bot]', id: 1, type: 'Bot' });
    const { github, getCollaboratorPermissionLevel } = fakeGithub({ reviews: [lookalike], permission: 'read' });
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({
      github,
      owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild',
      prNumber: 999,
      releasePacket: releasePacket(),
    })).rejects.toThrow(/FINAL_RISK_NOT_APPROVED/);
    expect(getCollaboratorPermissionLevel).toHaveBeenCalledWith({
      owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild', username: 'claude[bot]',
    });
  });

  it('rejects a release packet for another repository before querying the PR', async () => {
    const { github, get } = fakeGithub();
    const packet = { ...releasePacket(), repository: 'smallwei0301/other-repo' };
    await expect(buildProductionDbFinalRiskEvidenceFromGithub({
      github,
      owner: 'smallwei0301',
      repo: 'vibeaico-admin-rebuild',
      prNumber: 999,
      releasePacket: packet,
    })).rejects.toThrow(/FINAL_RISK_REPOSITORY_MISMATCH/);
    expect(get).not.toHaveBeenCalled();
  });
});
