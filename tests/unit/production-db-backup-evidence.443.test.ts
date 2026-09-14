import { describe, expect, it, vi } from 'vitest';

import {
  captureBackupEvidence,
  normalizeBackupResponse,
} from '../../scripts/agents/production-db-backup-evidence.mjs';

const PROD = 'egehnijjpgijmccagxac';
const CAPTURED = '2026-09-14T10:00:00.000Z';

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
    }, { projectRef: PROD, capturedAt: CAPTURED });

    expect(result.status).toBe('BACKUP_EVIDENCE_CAPTURED');
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
    }, { projectRef: PROD, capturedAt: CAPTURED });

    expect(result.pitrEnabled).toBe(true);
    expect(result.completedBackupCount).toBe(0);
  });

  it('fails closed when neither PITR nor a completed backup exists', () => {
    expect(() => normalizeBackupResponse({
      walg_enabled: false,
      pitr_enabled: false,
      backups: [{ id: 1, status: 'FAILED', inserted_at: '2026-09-14T08:00:00Z' }],
    }, { projectRef: PROD, capturedAt: CAPTURED })).toThrow(/NO_RECOVERY_POINT/);
  });

  it('never permits a different project ref', () => {
    expect(() => normalizeBackupResponse({ pitr_enabled: true, backups: [] }, {
      projectRef: 'wrong-project',
      capturedAt: CAPTURED,
    })).toThrow(/WRONG_PROJECT/);
  });

  it('uses GET only and emits sanitized evidence', async () => {
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
      token: 'fine-grained-read-token',
      projectRef: PROD,
      fetchImpl: fetchSpy as unknown as typeof fetch,
      now: () => CAPTURED,
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(JSON.stringify(result)).not.toContain('fine-grained-read-token');
    expect(result.databaseMutationPerformed).toBe(false);
  });

  it('rejects missing tokens and provider errors without retrying writes', async () => {
    await expect(captureBackupEvidence({ token: '', projectRef: PROD })).rejects.toThrow(/MISSING_BACKUP_OBSERVER_TOKEN/);

    const fetchSpy = vi.fn(async () => new Response('{"message":"forbidden"}', { status: 403 }));
    await expect(captureBackupEvidence({
      token: 'read-token',
      projectRef: PROD,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/BACKUP_API_FAILED/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});
