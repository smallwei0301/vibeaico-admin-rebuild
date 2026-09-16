import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { buildProductionDbPostTestSchemaEvidence } from '../../scripts/agents/production-db-g3-post-test-schema.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const TEST = 'nmwhwngojosmagjuvxol';
const NOW = '2026-09-15T00:20:00.000Z';

function plan() {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260915-447',
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'AUTHZ',
    migrations: [
      { repoFile: '0105_issue_44_traveler_risk_policies', riskTier: 'AUTHZ', sha256: '1'.repeat(64) },
      { repoFile: '0109_issue_41_schema_precondition_assertions', riskTier: 'SCHEMA_REPAIR', sha256: '2'.repeat(64) },
    ],
  };
}

function normalizedSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 2,
    status: 'CAPTURED',
    environment: 'TEST',
    projectRef: TEST,
    observedAt: '2026-09-15T00:10:00.000Z',
    observedMainSha: MAIN,
    rawDataIncluded: false,
    captureDigest: { algorithm: 'SHA256', value: '3'.repeat(64) },
    migrationLedger: {
      state: 'PRESENT',
      identities: [
        { version: '20260914060524', name: '0105_issue_44_traveler_risk_policies' },
        { version: '20260915000001', name: '0109_issue_41_schema_precondition_assertions' },
      ],
      digest: { algorithm: 'SHA256', value: '4'.repeat(64) },
    },
    ...overrides,
  };
}

const normalizer = (value: any) => value;

describe('Production DB G3 post-TEST schema evidence #447', () => {
  it('binds a fresh canonical TEST snapshot to the exact release and GitHub run without claiming G2 comparison', () => {
    const result = buildProductionDbPostTestSchemaEvidence({
      snapshot: normalizedSnapshot(),
      plan: plan(),
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
      now: NOW,
      normalizeSnapshot: normalizer,
    });
    expect(result).toMatchObject({
      status: 'TEST_POST_APPLY_SCHEMA_CAPTURED',
      testProjectRef: TEST,
      mainSha: MAIN,
      planDigest: PLAN,
      releaseId: 'release-20260915-447',
      sourceRunId: '34920000000',
      sourceRunAttempt: 1,
      comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED',
      readOnly: true,
      databaseMutationAuthorized: false,
      productionMutationPerformed: false,
    });
    expect(result.plannedMigrations).toEqual([
      { repoFile: '0105_issue_44_traveler_risk_policies', ledgerVersion: '20260914060524' },
      { repoFile: '0109_issue_41_schema_precondition_assertions', ledgerVersion: '20260915000001' },
    ]);
  });

  it('rejects stale or future TEST-after snapshots', () => {
    expect(() => buildProductionDbPostTestSchemaEvidence({
      snapshot: normalizedSnapshot({ observedAt: '2026-09-15T00:00:00.000Z' }),
      plan: plan(), sourceRunId: '1', sourceRunAttempt: 1, now: NOW,
      normalizeSnapshot: normalizer,
    })).toThrow(/STALE_POST_TEST_EVIDENCE/);

    expect(() => buildProductionDbPostTestSchemaEvidence({
      snapshot: normalizedSnapshot({ observedAt: '2026-09-15T00:22:00.000Z' }),
      plan: plan(), sourceRunId: '1', sourceRunAttempt: 1, now: NOW,
      normalizeSnapshot: normalizer,
    })).toThrow(/FUTURE_POST_TEST_EVIDENCE/);
  });

  it('rejects wrong TEST project/main or raw-data snapshots', () => {
    for (const bad of [
      normalizedSnapshot({ projectRef: 'other-test' }),
      normalizedSnapshot({ environment: 'PRODUCTION' }),
      normalizedSnapshot({ observedMainSha: 'd'.repeat(40) }),
      normalizedSnapshot({ rawDataIncluded: true }),
    ]) {
      expect(() => buildProductionDbPostTestSchemaEvidence({
        snapshot: bad,
        plan: plan(), sourceRunId: '1', sourceRunAttempt: 1, now: NOW,
        normalizeSnapshot: normalizer,
      })).toThrow(/POST_TEST_SCHEMA_/);
    }
  });

  it('requires every release migration to exist exactly once in the post-TEST provider ledger', () => {
    const missing = normalizedSnapshot({
      migrationLedger: {
        state: 'PRESENT',
        identities: [{ version: '20260914060524', name: '0105_issue_44_traveler_risk_policies' }],
        digest: { algorithm: 'SHA256', value: '4'.repeat(64) },
      },
    });
    expect(() => buildProductionDbPostTestSchemaEvidence({
      snapshot: missing,
      plan: plan(), sourceRunId: '1', sourceRunAttempt: 1, now: NOW,
      normalizeSnapshot: normalizer,
    })).toThrow(/POST_TEST_LEDGER_MISMATCH/);

    const duplicate = normalizedSnapshot({
      migrationLedger: {
        state: 'PRESENT',
        identities: [
          { version: '20260914060524', name: '0105_issue_44_traveler_risk_policies' },
          { version: '20260914060525', name: '0105_issue_44_traveler_risk_policies' },
          { version: '20260915000001', name: '0109_issue_41_schema_precondition_assertions' },
        ],
        digest: { algorithm: 'SHA256', value: '4'.repeat(64) },
      },
    });
    expect(() => buildProductionDbPostTestSchemaEvidence({
      snapshot: duplicate,
      plan: plan(), sourceRunId: '1', sourceRunAttempt: 1, now: NOW,
      normalizeSnapshot: normalizer,
    })).toThrow(/POST_TEST_LEDGER_MISMATCH/);
  });

  it('keeps the capture implementation pinned to TEST and rejects broad Management API token fallback', () => {
    const source = readFileSync('scripts/agents/production-db-g3-post-test-schema.mjs', 'utf8');
    expect(source).toContain("environment: 'TEST'");
    expect(source).toContain('SCHEMA_OBSERVER_TOKEN');
    expect(source).toContain('SUPABASE_ACCESS_TOKEN');
    expect(source).toContain('BROAD_SCHEMA_TOKEN_FORBIDDEN');
    expect(source).toContain("comparisonClaim: 'CAPTURE_ONLY_G2_COMPARISON_REQUIRED'");
  });
});
