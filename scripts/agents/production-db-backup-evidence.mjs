#!/usr/bin/env node

import process from 'node:process';

const API = 'https://api.supabase.com';
const EXPECTED_PROJECT_REF = 'egehnijjpgijmccagxac';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function validIso(value) {
  const text = String(value ?? '').trim();
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return new Date(text).toISOString();
}

export function normalizeBackupResponse(payload, { projectRef = EXPECTED_PROJECT_REF, capturedAt = new Date().toISOString() } = {}) {
  if (projectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'backup evidence is only valid for the canonical Production project');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('INVALID_BACKUP_RESPONSE', 'backup API response must be an object');
  const captured = validIso(capturedAt);
  if (!captured) fail('INVALID_CAPTURE_TIME', 'capturedAt must be a valid timestamp');

  const backups = Array.isArray(payload.backups) ? payload.backups : [];
  const completed = backups
    .filter((entry) => String(entry?.status ?? '').trim().toUpperCase() === 'COMPLETED')
    .map((entry) => ({
      id: entry?.id ?? null,
      isPhysicalBackup: entry?.is_physical_backup === true,
      insertedAt: validIso(entry?.inserted_at),
    }))
    .filter((entry) => entry.insertedAt)
    .sort((a, b) => Date.parse(b.insertedAt) - Date.parse(a.insertedAt));

  const physical = payload.physical_backup_data && typeof payload.physical_backup_data === 'object'
    ? payload.physical_backup_data
    : {};
  const earliestUnix = Number(physical.earliest_physical_backup_date_unix);
  const latestUnix = Number(physical.latest_physical_backup_date_unix);
  const latestPhysicalBackupAt = Number.isFinite(latestUnix) && latestUnix > 0
    ? new Date(latestUnix * 1000).toISOString()
    : null;
  const earliestPhysicalBackupAt = Number.isFinite(earliestUnix) && earliestUnix > 0
    ? new Date(earliestUnix * 1000).toISOString()
    : null;

  const pitrEnabled = payload.pitr_enabled === true;
  const walgEnabled = payload.walg_enabled === true;
  if (!pitrEnabled && !completed.length) {
    fail('NO_RECOVERY_POINT', 'no completed backup and PITR is not enabled');
  }

  return {
    schemaVersion: 1,
    status: 'BACKUP_EVIDENCE_CAPTURED',
    projectRef,
    capturedAt: captured,
    pitrEnabled,
    walgEnabled,
    completedBackupCount: completed.length,
    latestCompletedBackupAt: completed[0]?.insertedAt ?? null,
    physicalBackupWindow: {
      earliest: earliestPhysicalBackupAt,
      latest: latestPhysicalBackupAt,
    },
    // Supabase database backup covers DB state/metadata, not Storage object bytes.
    storageObjectsCovered: false,
    databaseMutationPerformed: false,
  };
}

export async function captureBackupEvidence({
  token,
  projectRef = EXPECTED_PROJECT_REF,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
}) {
  if (projectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'refusing backup lookup for a non-canonical Production project');
  if (!String(token ?? '').trim()) fail('MISSING_BACKUP_OBSERVER_TOKEN', 'a fine-grained backup read token is required');

  const response = await fetchImpl(`${API}/v1/projects/${projectRef}/database/backups`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });
  const text = await response.text();
  if (!response.ok) fail('BACKUP_API_FAILED', `backup API returned HTTP ${response.status}`);

  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    fail('INVALID_BACKUP_JSON', 'backup API did not return JSON');
  }
  return normalizeBackupResponse(payload, { projectRef, capturedAt: now() });
}

async function main() {
  try {
    const result = await captureBackupEvidence({
      token: process.env.SUPABASE_BACKUP_OBSERVER_TOKEN,
      projectRef: process.env.PRODUCTION_PROJECT_REF || EXPECTED_PROJECT_REF,
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-backup-evidence.mjs')) main();
