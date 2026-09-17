import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

import {
  buildBackupMetadataNotCaptured,
  buildProductionDbRecoveryEvidence,
  captureBackupEvidence,
  normalizeBackupResponse,
} from '../../scripts/agents/production-db-backup-evidence.mjs';

const PROD = 'egehnijjpgijmccagxac';
const REPO = 'smallwei0301/vibeaico-admin-rebuild';
const MAIN = 'a'.repeat(40);
const PLAN = 'b'.repeat(64);
const CAPTURED = '2026-09-14T10:00:00.000Z';

function backup(mainSha = MAIN) {
  return normalizeBackupResponse({
    walg_enabled: true,
    pitr_enabled: true,
    backups: [],
    physical_backup_data: {
      earliest_physical_backup_date_unix: 1789300000,
      latest_physical_backup_date_unix: 1789380000,
    },
  }, { projectRef: PROD, capturedAt: CAPTURED, mainSha });
}

function marker(mainSha = MAIN) {
  return buildBackupMetadataNotCaptured({
    projectRef: PROD,
    capturedAt: CAPTURED,
    mainSha,
  });
}

function restore(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    status: 'RESTORE_REHEARSAL_VERIFIED',
    rehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
    verifiedAt: '2026-09-14T09:00:00.000Z',
    mainSha: MAIN,
    expectedMainSha: MAIN,
    runId: '123',
    runAttempt: '1',
    source: 'TRUSTED_MAIN_GITHUB_ACTIONS',
    productionBackupRestored: false,
    storageObjectsCovered: false,
    databaseMutationAuthorized: false,
    ...overrides,
  };
}

function plan(riskTier = 'ADDITIVE') {
  return {
    schemaVersion: 1,
    releaseId: 'release-20260914-447',
    repository: REPO,
    productionProjectRef: PROD,
    mainSha: MAIN,
    planDigest: PLAN,
    riskTier,
    migrations: [],
  };
}

describe('Production backup evidence collector', () => {
  it('normalizes a completed physical backup without claiming Storage object coverage', () => {
    const result = normalizeBackupResponse({
      region: 'ap-southeast-1',
      walg_enabled: true,
      pitr_enabled: false,
      backups: [
        { id: 2, is_physical_backup: true, status: 'COMPLETED', inserted_at: '2026-09-14T08:00:00Z' },
        { id: 1, is_physical_backup: true, status: 'FAILED', inserted_at: '2026-09-13T08:00:00Z' },
      ],
      physical_backup_data: {
        earliest_physical_backup_date_unix: 1789300000,
        latest_physical_backup_date_unix: 1789380000,
      },
    }, { projectRef: PROD, capturedAt: CAPTURED, mainSha: MAIN });

    expect(result.status).toBe('BACKUP_EVIDENCE_CAPTURED');
    expect(result.mainSha).toBe(MAIN);
    expect(result.completedBackupCount).toBe(1);
    expect(result.latestCompletedBackupAt).toBe('2026-09-14T08:00:00.000Z');
    expect(result.storageObjectsCovered).toBe(false);
    expect(result.databaseMutationPerformed).toBe(false);
  });

  it('accepts PITR availability even when the scheduled backup list is empty', () => {
    const result = normalizeBackupResponse({
      walg_enabled: true,
      pitr_enabled: true,
      backups: [],
      physical_backup_data: {
        earliest_physical_backup_date_unix: 1789300000,
        latest_physical_backup_date_unix: 1789380000,
      },
    }, { projectRef: PROD, capturedAt: CAPTURED, mainSha: MAIN });

    expect(result.pitrEnabled).toBe(true);
    expect(result.completedBackupCount).toBe(0);
  });

  it('emits an honest exact-main marker when backup metadata is intentionally not captured', () => {
    expect(marker()).toMatchObject({
      status: 'BACKUP_METADATA_NOT_CAPTURED',
      projectRef: PROD,
      mainSha: MAIN,
      reason: 'OBSERVER_CREDENTIAL_NOT_CONFIGURED',
      pitrEnabled: null,
      completedBackupCount: null,
      storageObjectsCovered: false,
      databaseMutationPerformed: false,
    });
  });

  it('fails closed when neither PITR nor a completed backup exists', () => {
    expect(() => normalizeBackupResponse({
      walg_enabled: false,
      pitr_enabled: false,
      backups: [{ id: 1, status: 'FAILED', inserted_at: '2026-09-14T08:00:00Z' }],
    }, { projectRef: PROD, capturedAt: CAPTURED, mainSha: MAIN })).toThrow(/NO_RECOVERY_POINT/);
  });

  it('never permits a different project ref', () => {
    expect(() => normalizeBackupResponse({ pitr_enabled: true, backups: [] }, {
      projectRef: 'wrong-project',
      capturedAt: CAPTURED,
      mainSha: MAIN,
    })).toThrow(/WRONG_PROJECT/);
  });

  it('uses GET only with an OAuth2 database:read credential and emits sanitized exact-main evidence', async () => {
    const fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      expect(init?.method).toBe('GET');
      return new Response(JSON.stringify({
        walg_enabled: true,
        pitr_enabled: false,
        backups: [{ id: 7, is_physical_backup: true, status: 'COMPLETED', inserted_at: '2026-09-14T08:00:00Z' }],
        physical_backup_data: {},
      }), { status: 200 });
    });

    const result = await captureBackupEvidence({
      token: 'oauth-access-token',
      credentialKind: 'OAUTH2_DATABASE_READ',
      projectRef: PROD,
      expectedMainSha: MAIN,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      now: () => CAPTURED,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('oauth-access-token');
    expect(result.mainSha).toBe(MAIN);
    expect(result.databaseMutationPerformed).toBe(false);
  });

  it('rejects PAT fallback and wrong credential kinds before any provider request', async () => {
    const fetchSpy = vi.fn();
    await expect(captureBackupEvidence({
      token: 'sbp_classic-or-scoped-token',
      credentialKind: 'OAUTH2_DATABASE_READ',
      projectRef: PROD,
      expectedMainSha: MAIN,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/BACKUP_OBSERVER_PAT_FORBIDDEN/);
    await expect(captureBackupEvidence({
      token: 'oauth-access-token',
      credentialKind: 'PERSONAL_ACCESS_TOKEN',
      projectRef: PROD,
      expectedMainSha: MAIN,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/BACKUP_OBSERVER_CREDENTIAL_KIND_FORBIDDEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects missing tokens and provider errors without retrying writes', async () => {
    await expect(captureBackupEvidence({
      token: '', credentialKind: 'OAUTH2_DATABASE_READ', projectRef: PROD,
    })).rejects.toThrow(/MISSING_BACKUP_OBSERVER_TOKEN/);

    const fetchSpy = vi.fn(async () => new Response('{"message":"forbidden"}', { status: 403 }));
    await expect(captureBackupEvidence({
      token: 'oauth-access-token',
      credentialKind: 'OAUTH2_DATABASE_READ',
      projectRef: PROD,
      expectedMainSha: MAIN,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/BACKUP_API_FAILED/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the workflow credential optional and does not wire a broad Supabase access token', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/agent-production-db-backup-observer.yml'), 'utf8');
    expect(workflow).toContain('SUPABASE_BACKUP_OBSERVER_TOKEN:');
    expect(workflow).toContain('required: false');
    expect(workflow).toContain('SUPABASE_BACKUP_OBSERVER_CREDENTIAL_KIND: OAUTH2_DATABASE_READ');
    expect(workflow).toContain('test -z "${SUPABASE_ACCESS_TOKEN:-}"');
  });
});

describe('Production DB G4 recovery adapter #447', () => {
  it.each(['ADDITIVE', 'SCHEMA_REPAIR', 'AUTHZ'])('%s accepts the exact-main no-metadata marker plus trusted local rehearsal', (riskTier) => {
    expect(buildProductionDbRecoveryEvidence({
      backupEvidence: marker(),
      restoreEvidence: restore(),
      plan: plan(riskTier),
    })).toMatchObject({
      status: 'RECOVERY_VERIFIED',
      productionProjectRef: PROD,
      mainSha: MAIN,
      planDigest: PLAN,
      backupMetadataCaptured: false,
      backupMetadataRequired: false,
      backupEvidenceStatus: 'BACKUP_METADATA_NOT_CAPTURED',
      restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
      databaseMutationAuthorized: false,
    });
  });

  it('combines captured backup + trusted local rehearsal for non-BACKFILL releases without authorizing mutation', () => {
    expect(buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: restore(),
      plan: plan('AUTHZ'),
    })).toMatchObject({
      status: 'RECOVERY_VERIFIED',
      productionProjectRef: PROD,
      mainSha: MAIN,
      planDigest: PLAN,
      backupMetadataCaptured: true,
      backupMetadataRequired: false,
      restoreRehearsalKind: 'LOCAL_LOGICAL_RESTORE_CANARY',
      productionBackupRestored: false,
      storageObjectsCovered: false,
      preimageBackupVerified: false,
      databaseMutationAuthorized: false,
    });
  });

  it('rejects backup evidence from another main SHA', () => {
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: backup('c'.repeat(40)),
      restoreEvidence: restore(),
      plan: plan(),
    })).toThrow(/BACKUP_MAIN_MISMATCH/);
  });

  it('rejects restore evidence from another main SHA or an untrusted source', () => {
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: restore({ mainSha: 'c'.repeat(40) }),
      plan: plan(),
    })).toThrow(/RESTORE_MAIN_MISMATCH/);
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: restore({ source: 'LOCAL_OPERATOR' }),
      plan: plan(),
    })).toThrow(/UNTRUSTED_RESTORE_SOURCE/);
  });

  it('does not let a no-metadata marker or local rehearsal satisfy BACKFILL recovery', () => {
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: marker(),
      restoreEvidence: restore(),
      plan: plan('BACKFILL'),
    })).toThrow(/BACKUP_EVIDENCE_REQUIRED/);
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: restore(),
      plan: plan('BACKFILL'),
    })).toThrow(/PRODUCTION_BACKUP_RESTORE_REQUIRED/);
  });

  it('requires exact-plan preimage evidence for a real BACKFILL Production backup clone', () => {
    const clone = restore({ rehearsalKind: 'PRODUCTION_BACKUP_CLONE', productionBackupRestored: true });
    expect(() => buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: clone,
      plan: plan('BACKFILL'),
      preimageEvidence: {
        status: 'PREIMAGE_BACKUP_VERIFIED', mainSha: MAIN, planDigest: 'd'.repeat(64), databaseMutationAuthorized: false,
      },
    })).toThrow(/PREIMAGE_PLAN_MISMATCH/);

    expect(buildProductionDbRecoveryEvidence({
      backupEvidence: backup(),
      restoreEvidence: clone,
      plan: plan('BACKFILL'),
      preimageEvidence: {
        status: 'PREIMAGE_BACKUP_VERIFIED', mainSha: MAIN, planDigest: PLAN, databaseMutationAuthorized: false,
      },
    })).toMatchObject({
      status: 'RECOVERY_VERIFIED',
      restoreRehearsalKind: 'PRODUCTION_BACKUP_CLONE',
      productionBackupRestored: true,
      preimageBackupVerified: true,
      backupMetadataCaptured: true,
      backupMetadataRequired: true,
      databaseMutationAuthorized: false,
    });
  });
});
