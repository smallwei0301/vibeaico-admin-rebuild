import { describe, expect, it } from 'vitest';
import { changeDigestOf, evaluateAstra, routing } from '../../scripts/agents/astra-review-policy.mjs';
import { FINAL_RISK_COST_POLICY_VERSION } from '../../scripts/agents/final-risk-cost-policy.mjs';

const files = [
  { filename: 'scripts/agents/production-db-release-plan.mjs', status: 'modified', sha: '1'.repeat(40) },
  { filename: 'scripts/db/controlled-production-db-release.mjs', status: 'modified', sha: '2'.repeat(40) },
];
const digest = changeDigestOf(files);
const body = [
  'WORKSTREAM: PRODUCT_MAINLINE',
  'ASTRA_RISK: IRREVERSIBLE_DATA',
  'ASTRA_RATIONALE: Production DB mutation boundary requires adversarial review',
  'ASTRA_TEST_BASELINE: exact-head CI and isolated database tests passed',
  'ASTRA_SCHEMA_BASELINE: isolated PostgreSQL rebuilt and verified from zero',
].join('\n');
const context = {
  repository: 'smallwei0301/vibeaico-admin-rebuild',
  baseSha: 'a'.repeat(40),
  headSha: 'b'.repeat(40),
  changeDigest: digest,
  policyVersion: routing.version,
  testBaseline: 'exact-head CI and isolated database tests passed',
  schemaBaseline: 'isolated PostgreSQL rebuilt and verified from zero',
};

// Synthetic review fixture; not a claim about a real #551 model execution.
function trustedSolReview() {
  const payload = {
    repository: context.repository,
    baseSha: context.baseSha,
    headSha: context.headSha,
    changeDigest: digest,
    policyVersion: routing.version,
    testBaseline: context.testBaseline,
    schemaBaseline: context.schemaBaseline,
    requestedModel: 'gpt-5.6-sol',
    actualModel: 'gpt-5.6-sol',
    identityEvidence: 'OPERATOR_ATTESTED',
    reviewerTier: 'AUDIT',
    costPolicyVersion: FINAL_RISK_COST_POLICY_VERSION,
    downgradeReason: 'PREMIUM_REVIEW_COMPLETED',
    downgradeEvidenceRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/551',
    reviewLineage: 'vibeaico-admin-rebuild#447',
    executionRef: 'fixture-sol-review-447',
    adversarialEvidence: 'Fixture checks source identity, replay and unresolved finding rejection',
    priorFindingsReviewed: true,
    unresolvedFindingCount: 0,
    verdict: 'PASS',
    report: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/551',
    findings: 'Owner-directed #447 adversarial review found no blocking counterexample',
  };
  return {
    id: 1,
    state: 'COMMENTED',
    commit_id: context.headSha,
    submitted_at: '2026-09-17T00:00:00Z',
    trusted: true,
    user: { login: 'smallwei0301', id: 206991894, type: 'User' },
    body: `\`\`\`astra-review\n${JSON.stringify(payload)}\n\`\`\``,
  };
}

describe('Owner #447 Sol review continues under the permanent #552 downgrade policy', () => {
  it('keeps Fable as initial premium default and Sol in the conditional downgrade allowlist', () => {
    expect(routing.models.finalRisk).toBe('claude-fable-5-1');
    expect(routing.models.finalRiskAllowedModels).not.toContain('gpt-5.6-sol');
    expect(routing.models.finalRiskDowngradeAllowedModels).toContain('gpt-5.6-sol');
    expect(routing.finalRiskCostControl.version).toBe(FINAL_RISK_COST_POLICY_VERSION);
  });

  it('accepts a truthful trusted Sol adversarial review with the shared downgrade evidence', () => {
    const result = evaluateAstra({
      body,
      changedFiles: files.map((file) => file.filename),
      context,
      reviews: [trustedSolReview()],
    });
    expect(result.status).toBe('ASTRA_APPROVED');
    expect(result.errors).toEqual([]);
  });
});
