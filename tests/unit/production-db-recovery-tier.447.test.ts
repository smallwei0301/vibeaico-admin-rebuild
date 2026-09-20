import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  PRODUCTION_DB_POLICY,
  evaluateReleasePreflight,
  releaseEvidenceDigestOf,
} from '../../scripts/agents/production-db-release-preflight.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const NOW = '2026-09-14T12:40:00Z';

function packet(riskTier = 'ADDITIVE', restoreKind = 'LOCAL_LOGICAL_RESTORE_CANARY') {
  const value: any = {
    schemaVersion: 1,
    releaseId: 'release-recovery-447',
    repository: PRODUCTION_DB_POLICY.repository,
    productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier,
    source: { status: 'SOURCE_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false },
    consistency: { status: 'CONSISTENCY_VERIFIED', unexplainedDifferences: 0, observedAt: '2026-09-14T12:35:00Z', mainSha: MAIN, planDigest: PLAN },
    test: {
      status: 'TEST_VERIFIED', policySkip: false, executedTests: 4, cleanup: 'PASSED', mainSha: MAIN, planDigest: PLAN,
      tenantBoundaryVerified: riskTier === 'AUTHZ', negativeRoleTestsPassed: riskTier === 'AUTHZ',
    },
    recovery: {
      status: 'RECOVERY_VERIFIED', productionProjectRef: PRODUCTION_DB_POLICY.productionProjectRef, databaseMutationAuthorized: false,
      backupObservedAt: '2026-09-14T12:20:00Z', restoreRehearsedAt: '2026-09-01T03:00:00Z',
      restoreRehearsalKind: restoreKind, productionBackupRestored: restoreKind === 'PRODUCTION_BACKUP_CLONE',
      storageObjectsCovered: false, preimageBackupVerified: riskTier === 'BACKFILL',
    },
    finalRisk: {
      status: 'ASTRA_APPROVED', requestedModel: 'claude-fable-5-1', actualModel: 'claude-fable-5-1',
      planDigest: PLAN, evidenceDigest: '', reviewedAt: '2026-09-14T12:25:00Z',
      executionRef: 'https://github.com/smallwei0301/vibeaico-admin-rebuild/pull/450#review', reviewId: 'recovery-447',
    },
    data: { paymentFactsTouched: false, batchSize: 100, maxRows: 1000, executionBounded: riskTier === 'BACKFILL' },
  };
  value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
  return value;
}

describe('Production DB recovery evidence tiers #447', () => {
  it.each(['ADDITIVE', 'SCHEMA_REPAIR', 'AUTHZ'])('%s can reuse a fresh trusted local logical restore rehearsal', (riskTier) => {
    expect(evaluateReleasePreflight(packet(riskTier), { now: NOW })).toMatchObject({
      status: 'READY_FOR_LOCK', restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
    });
  });

  it('BACKFILL requires a real Production backup clone rather than local rehearsal', () => {
    expect(() => evaluateReleasePreflight(packet('BACKFILL'), { now: NOW })).toThrow(/PRODUCTION_BACKUP_RESTORE_REQUIRED/);
    // Even with a genuine Production backup clone/restore, v1 still does not execute
    // arbitrary BACKFILL SQL through the controlled writer (BACKFILL_EXECUTOR_NOT_ADMITTED
    // in assertRiskAdaptiveEvidence, mirrored by buildBoundedBackfillSql at the SQL-build
    // layer) — the clone/restore gate only proves the *recovery* evidence is real, it does
    // not by itself admit BACKFILL for execution.
    expect(() => evaluateReleasePreflight(packet('BACKFILL', 'PRODUCTION_BACKUP_CLONE'), { now: NOW }))
      .toThrow(/BACKFILL_EXECUTOR_NOT_ADMITTED/);
  });

  it('rejects a clone label that does not prove a Production backup was restored', () => {
    const value = packet('ADDITIVE', 'PRODUCTION_BACKUP_CLONE');
    value.recovery.productionBackupRestored = false;
    value.finalRisk.evidenceDigest = releaseEvidenceDigestOf(value);
    expect(() => evaluateReleasePreflight(value, { now: NOW })).toThrow(/PRODUCTION_BACKUP_CLONE_UNVERIFIED/);
  });

  it('keeps the local restore rehearsal exact-main bound and explicitly non-Production', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/production-db-restore-rehearsal.yml'), 'utf8');
    expect(workflow).toContain('workflow_call:');
    expect(workflow).toContain('expected_main_sha:');
    expect(workflow).toContain("ref: ${{ inputs.expected_main_sha || 'main' }}");
    expect(workflow).toContain('test "$CHECKED_SHA" = "$BOUND_SHA"');
    expect(workflow).toContain('test "$CURRENT_MAIN_SHA" = "$BOUND_SHA"');
    const projectIdTemplate = workflow.match(/^\s*LOCAL_PROJECT_ID:\s*(.+)$/m)?.[1];
    expect(projectIdTemplate).toBe('schema-proof-restore-${{ github.run_id }}-${{ github.run_attempt }}');
    const projectId = projectIdTemplate
      ?.replace('${{ github.run_id }}', '35519793130')
      .replace('${{ github.run_attempt }}', '1');
    expect(projectId).toMatch(/^schema-proof-[a-z0-9-]{1,50}$/);
    expect(workflow).toContain('LOCAL_PROJECT_ID: schema-proof-restore-${{ github.run_id }}-${{ github.run_attempt }}');
    const checked = workflow.indexOf('test "$CHECKED_SHA" = "$BOUND_SHA"');
    const current = workflow.indexOf('test "$CURRENT_MAIN_SHA" = "$BOUND_SHA"');
    const expectedHead = workflow.indexOf('echo "EXPECTED_HEAD=$BOUND_SHA" >> "$GITHUB_ENV"');
    const bootstrap = workflow.indexOf('node scripts/agents/fresh-install-baseline.mjs');
    expect(checked).toBeGreaterThan(0);
    expect(current).toBeGreaterThan(checked);
    expect(expectedHead).toBeGreaterThan(current);
    expect(bootstrap).toBeGreaterThan(expectedHead);
    expect(workflow).not.toContain('LOCAL_PROJECT_ID: production-db-restore-rehearsal-');
    expect(workflow).toContain("rehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY'");
    expect(workflow).toContain('expectedMainSha: process.env.BOUND_MAIN_SHA');
    expect(workflow).toContain('productionBackupRestored: false');
    expect(workflow).toContain('storageObjectsCovered: false');
    expect(workflow).toContain('databaseMutationAuthorized: false');
    expect(workflow).not.toContain('productionBackupRestored: true');
  });
});
