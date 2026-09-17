import { describe, expect, it } from 'vitest';

import {
  assembleProductionDbConsistencyEvidence,
  assembleProductionDbRecoveryEvidence,
} from '../../scripts/agents/assemble-production-db-release-evidence.mjs';

const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const MIGRATION = '0109_issue_41_schema_precondition_assertions';

function plan() {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260915-447',
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier: 'ADDITIVE',
    migrations: [{ repoFile: MIGRATION, riskTier: 'ADDITIVE', sha256: '1'.repeat(64) }],
  };
}

function report(overrides: Record<string, unknown> = {}) {
  return {
    status: 'MATCH',
    observedMainSha: MAIN,
    safety: { authorizesDatabaseWrite: false },
    environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'MATCH' },
    environments: {
      TEST: { observedAt: '2026-09-15T01:00:00.000Z' },
      PRODUCTION: { observedAt: '2026-09-15T01:00:00.000Z' },
    },
    differences: [],
    exceptionSummary: { expired: 0, unmatched: 0 },
    ...overrides,
  };
}

const impactManifest = {
  schemaVersion: 1,
  entries: [{ repoFile: MIGRATION, impacts: [] }],
};

function backup(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'BACKUP_EVIDENCE_CAPTURED',
    projectRef: 'egehnijjpgijmccagxac',
    mainSha: MAIN,
    capturedAt: '2026-09-15T01:00:00.000Z',
    pitrEnabled: true,
    completedBackupCount: 1,
    storageObjectsCovered: false,
    databaseMutationPerformed: false,
    ...overrides,
  };
}

function restore(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'RESTORE_REHEARSAL_VERIFIED',
    rehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
    verifiedAt: '2026-09-15T01:00:00.000Z',
    mainSha: MAIN,
    expectedMainSha: MAIN,
    source: 'TRUSTED_MAIN_GITHUB_ACTIONS',
    productionBackupRestored: false,
    storageObjectsCovered: false,
    databaseMutationAuthorized: false,
    ...overrides,
  };
}

describe('Production DB release evidence assembler #447', () => {
  it('assembles G2 and G4 without inventing write authorization', () => {
    const lockedPlan = plan();
    expect(assembleProductionDbConsistencyEvidence({
      plan: lockedPlan,
      report: report(),
      impactManifest,
    })).toMatchObject({
      status: 'CONSISTENCY_VERIFIED',
      mainSha: MAIN,
      planDigest: PLAN,
      unexplainedDifferences: 0,
      databaseMutationAuthorized: false,
    });

    expect(assembleProductionDbRecoveryEvidence({
      plan: lockedPlan,
      backupEvidence: backup(),
      restoreEvidence: restore(),
    })).toMatchObject({
      status: 'RECOVERY_VERIFIED',
      mainSha: MAIN,
      planDigest: PLAN,
      restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
      productionBackupRestored: false,
      storageObjectsCovered: false,
      databaseMutationAuthorized: false,
    });
  });

  it('fails closed when G2 belongs to another main', () => {
    expect(() => assembleProductionDbConsistencyEvidence({
      plan: plan(),
      report: report({ observedMainSha: 'c'.repeat(40) }),
      impactManifest,
    })).toThrow(/CONSISTENCY_MAIN_MISMATCH/);
  });

  it('fails closed when G4 backup observer claims mutation', () => {
    expect(() => assembleProductionDbRecoveryEvidence({
      plan: plan(),
      backupEvidence: backup({ databaseMutationPerformed: true }),
      restoreEvidence: restore(),
    })).toThrow(/BACKUP_OBSERVER_MUTATION/);
  });
});
