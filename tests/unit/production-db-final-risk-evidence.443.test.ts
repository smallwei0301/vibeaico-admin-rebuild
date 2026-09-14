import { describe, expect, it } from 'vitest';

import { routing } from '../../scripts/agents/astra-review-policy.mjs';
import { buildProductionDbFinalRiskEvidence } from '../../scripts/agents/production-db-final-risk-evidence.mjs';
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
});
