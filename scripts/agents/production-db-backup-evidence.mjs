#!/usr/bin/env node

import process from 'node:process';

const API = 'https://api.supabase.com';
const EXPECTED_PROJECT_REF = 'egehnijjpgijmccagxac';
const EXPECTED_REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const RESTORE_KINDS = new Set(['LOCAL_LOGICAL_RESTORE_CANARY', 'PRODUCTION_BACKUP_CLONE']);
const NON_BACKFILL_RISK_TIERS = new Set(['ADDITIVE', 'SCHEMA_REPAIR', 'AUTHZ']);
const OAUTH_DATABASE_READ = 'OAUTH2_DATABASE_READ';

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

function exactMainSha(value, label = 'mainSha') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact 40-character SHA`);
  return text;
}

function normalizedRiskTier(value) {
  return String(value ?? '').trim().toUpperCase();
}

function assertBackupEnvelopeCommon(backupEvidence, mainSha) {
  if (!backupEvidence || typeof backupEvidence !== 'object' || Array.isArray(backupEvidence)) {
    fail('BACKUP_EVIDENCE_REQUIRED', 'backup observer evidence is required');
  }
  if (backupEvidence.projectRef !== EXPECTED_PROJECT_REF) fail('BACKUP_PROJECT_MISMATCH', 'backup evidence belongs to another project');
  if (exactMainSha(backupEvidence.mainSha, 'backup.mainSha') !== mainSha) fail('BACKUP_MAIN_MISMATCH', 'backup evidence belongs to another main SHA');
  if (!validIso(backupEvidence.capturedAt)) fail('INVALID_BACKUP_CAPTURE_TIME', 'backup capturedAt is invalid');
  if (backupEvidence.databaseMutationPerformed !== false) fail('BACKUP_OBSERVER_MUTATION', 'backup observer must remain read-only');
  if (backupEvidence.storageObjectsCovered !== false) fail('BACKUP_SCOPE_OVERCLAIM', 'database backup observer cannot claim Storage object coverage');
}

/**
 * Honest marker used when no Production backup metadata credential is configured.
 * This is not a PASS by itself. The recovery adapter may accept it only for
 * non-BACKFILL risk tiers where the canonical recovery control is the trusted
 * local restore rehearsal. BACKFILL always rejects this marker.
 *
 * @param {{projectRef?: string, capturedAt?: string, mainSha?: string, reason?: string}} [input]
 */
export function buildBackupMetadataNotCaptured({
  projectRef = EXPECTED_PROJECT_REF,
  capturedAt = new Date().toISOString(),
  mainSha,
  reason = 'OBSERVER_CREDENTIAL_NOT_CONFIGURED',
} = {}) {
  if (projectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'backup evidence is only valid for the canonical Production project');
  const captured = validIso(capturedAt);
  if (!captured) fail('INVALID_CAPTURE_TIME', 'capturedAt must be a valid timestamp');
  const boundMainSha = exactMainSha(mainSha);
  return {
    schemaVersion: 1,
    status: 'BACKUP_METADATA_NOT_CAPTURED',
    projectRef,
    mainSha: boundMainSha,
    capturedAt: captured,
    reason,
    pitrEnabled: null,
    walgEnabled: null,
    completedBackupCount: null,
    latestCompletedBackupAt: null,
    physicalBackupWindow: { earliest: null, latest: null },
    storageObjectsCovered: false,
    databaseMutationPerformed: false,
  };
}

/**
 * @param {any} payload
 * @param {{projectRef?: string, capturedAt?: string, mainSha?: string | null}} [options]
 */
export function normalizeBackupResponse(payload, {
  projectRef = EXPECTED_PROJECT_REF,
  capturedAt = new Date().toISOString(),
  mainSha = null,
} = {}) {
  if (projectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'backup evidence is only valid for the canonical Production project');
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) fail('INVALID_BACKUP_RESPONSE', 'backup API response must be an object');
  const captured = validIso(capturedAt);
  if (!captured) fail('INVALID_CAPTURE_TIME', 'capturedAt must be a valid timestamp');
  const boundMainSha = mainSha == null ? null : exactMainSha(mainSha);

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
    mainSha: boundMainSha,
    capturedAt: captured,
    pitrEnabled,
    walgEnabled,
    completedBackupCount: completed.length,
    latestCompletedBackupAt: completed[0]?.insertedAt ?? null,
    physicalBackupWindow: {
      earliest: earliestPhysicalBackupAt,
      latest: latestPhysicalBackupAt,
    },
    storageObjectsCovered: false,
    databaseMutationPerformed: false,
  };
}

/**
 * @param {{token?: string, credentialKind?: string, projectRef?: string, expectedMainSha?: string | null, fetchImpl?: typeof fetch, now?: () => string}} [input]
 */
export async function captureBackupEvidence({
  token,
  credentialKind,
  projectRef = EXPECTED_PROJECT_REF,
  expectedMainSha = null,
  fetchImpl = fetch,
  now = () => new Date().toISOString(),
} = {}) {
  if (projectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'refusing backup lookup for a non-canonical Production project');
  const bearer = String(token ?? '').trim();
  if (!bearer) fail('MISSING_BACKUP_OBSERVER_TOKEN', 'a dedicated read-only observer credential is required');
  if (String(credentialKind ?? '').trim() !== OAUTH_DATABASE_READ) {
    fail('BACKUP_OBSERVER_CREDENTIAL_KIND_FORBIDDEN', 'backup observer only accepts OAuth2 database:read credentials');
  }
  if (/^sbp_/i.test(bearer)) {
    fail('BACKUP_OBSERVER_PAT_FORBIDDEN', 'PAT credentials are not accepted by the backup observer');
  }
  const mainSha = expectedMainSha == null ? null : exactMainSha(expectedMainSha, 'expectedMainSha');

  const response = await fetchImpl(`${API}/v1/projects/${projectRef}/database/backups`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${bearer}`,
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
  return normalizeBackupResponse(payload, { projectRef, capturedAt: now(), mainSha });
}

/**
 * Convert two independent trusted-main recovery artifacts into the shape consumed
 * by the Production DB release preflight. Backup metadata is risk-adaptive:
 * AUTHZ/ADDITIVE/SCHEMA_REPAIR may rely on the trusted local restore rehearsal
 * without a Supabase Management API credential; BACKFILL still requires actual
 * Production backup/PITR evidence plus clone/preimage proof.
 *
 * @param {{backupEvidence?: any, restoreEvidence?: any, plan?: any, preimageEvidence?: any | null}} [input]
 */
export function buildProductionDbRecoveryEvidence({
  backupEvidence,
  restoreEvidence,
  plan,
  preimageEvidence = null,
} = {}) {
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) fail('PLAN_REQUIRED', 'release plan is required');
  if (plan.repository !== EXPECTED_REPOSITORY) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  if (plan.productionProjectRef !== EXPECTED_PROJECT_REF) fail('WRONG_PROJECT', 'release plan project is not canonical Production');
  const mainSha = exactMainSha(plan.mainSha);
  const planDigest = String(plan.planDigest ?? '').trim().toLowerCase();
  if (!DIGEST.test(planDigest)) fail('INVALID_PLAN_DIGEST', 'release plan digest must be SHA-256');
  const riskTier = normalizedRiskTier(plan.riskTier);

  assertBackupEnvelopeCommon(backupEvidence, mainSha);
  const backupStatus = String(backupEvidence.status ?? '').trim().toUpperCase();
  let backupMetadataCaptured = false;
  if (backupStatus === 'BACKUP_EVIDENCE_CAPTURED') {
    if (backupEvidence.pitrEnabled !== true && !(Number.isInteger(backupEvidence.completedBackupCount) && backupEvidence.completedBackupCount > 0)) {
      fail('NO_RECOVERY_POINT', 'backup evidence has no PITR or completed backup');
    }
    backupMetadataCaptured = true;
  } else if (backupStatus === 'BACKUP_METADATA_NOT_CAPTURED') {
    if (!NON_BACKFILL_RISK_TIERS.has(riskTier)) {
      fail('BACKUP_EVIDENCE_REQUIRED', `${riskTier || 'unknown'} requires captured Production backup/PITR evidence`);
    }
  } else {
    fail('BACKUP_EVIDENCE_REQUIRED', 'trusted backup observer evidence is required');
  }

  if (!restoreEvidence || restoreEvidence.status !== 'RESTORE_REHEARSAL_VERIFIED') fail('RESTORE_EVIDENCE_REQUIRED', 'trusted restore rehearsal evidence is required');
  if (exactMainSha(restoreEvidence.mainSha, 'restore.mainSha') !== mainSha) fail('RESTORE_MAIN_MISMATCH', 'restore evidence belongs to another main SHA');
  if (restoreEvidence.expectedMainSha != null && exactMainSha(restoreEvidence.expectedMainSha, 'restore.expectedMainSha') !== mainSha) {
    fail('RESTORE_EXPECTED_MAIN_MISMATCH', 'restore expected main SHA is different from the release plan');
  }
  if (!validIso(restoreEvidence.verifiedAt)) fail('INVALID_RESTORE_TIME', 'restore verifiedAt is invalid');
  if (restoreEvidence.source !== 'TRUSTED_MAIN_GITHUB_ACTIONS') fail('UNTRUSTED_RESTORE_SOURCE', 'restore evidence must come from trusted-main GitHub Actions');
  if (restoreEvidence.databaseMutationAuthorized !== false) fail('RESTORE_SCOPE_ESCALATION', 'restore evidence must not authorize Production mutation');
  if (restoreEvidence.storageObjectsCovered !== false) fail('RESTORE_SCOPE_OVERCLAIM', 'database restore rehearsal cannot claim Storage object coverage');
  const restoreKind = String(restoreEvidence.rehearsalKind ?? '').trim().toUpperCase();
  if (!RESTORE_KINDS.has(restoreKind)) fail('INVALID_RESTORE_REHEARSAL_KIND', 'restore rehearsal kind is unsupported');

  let preimageBackupVerified = false;
  if (riskTier === 'BACKFILL') {
    if (!backupMetadataCaptured) fail('BACKUP_EVIDENCE_REQUIRED', 'BACKFILL requires captured Production backup/PITR evidence');
    if (restoreKind !== 'PRODUCTION_BACKUP_CLONE' || restoreEvidence.productionBackupRestored !== true) {
      fail('PRODUCTION_BACKUP_RESTORE_REQUIRED', 'BACKFILL requires a real Production backup clone restore');
    }
    if (!preimageEvidence || preimageEvidence.status !== 'PREIMAGE_BACKUP_VERIFIED') {
      fail('PREIMAGE_BACKUP_REQUIRED', 'BACKFILL requires separate preimage backup evidence');
    }
    if (exactMainSha(preimageEvidence.mainSha, 'preimage.mainSha') !== mainSha) fail('PREIMAGE_MAIN_MISMATCH', 'preimage evidence belongs to another main SHA');
    if (String(preimageEvidence.planDigest ?? '').trim().toLowerCase() !== planDigest) fail('PREIMAGE_PLAN_MISMATCH', 'preimage evidence belongs to another release plan');
    if (preimageEvidence.databaseMutationAuthorized !== false) fail('PREIMAGE_SCOPE_ESCALATION', 'preimage evidence must not authorize mutation');
    preimageBackupVerified = true;
  } else if (restoreKind === 'PRODUCTION_BACKUP_CLONE' && restoreEvidence.productionBackupRestored !== true) {
    fail('PRODUCTION_BACKUP_CLONE_UNVERIFIED', 'clone label does not prove a Production backup was restored');
  }

  return {
    status: 'RECOVERY_VERIFIED',
    productionProjectRef: EXPECTED_PROJECT_REF,
    mainSha,
    planDigest,
    // Legacy field name retained for preflight compatibility. For non-BACKFILL,
    // this is the exact-main backup-gate observation timestamp even when metadata
    // capture was intentionally not required by the risk tier.
    backupObservedAt: new Date(backupEvidence.capturedAt).toISOString(),
    backupMetadataCaptured,
    backupMetadataRequired: riskTier === 'BACKFILL',
    restoreRehearsedAt: new Date(restoreEvidence.verifiedAt).toISOString(),
    restoreRehearsalKind: restoreKind,
    productionBackupRestored: restoreEvidence.productionBackupRestored === true,
    storageObjectsCovered: false,
    preimageBackupVerified,
    backupEvidenceStatus: backupEvidence.status,
    restoreEvidenceStatus: restoreEvidence.status,
    databaseMutationAuthorized: false,
  };
}

async function main() {
  try {
    const token = String(process.env.SUPABASE_BACKUP_OBSERVER_TOKEN ?? '').trim();
    const common = {
      projectRef: process.env.PRODUCTION_PROJECT_REF || EXPECTED_PROJECT_REF,
      expectedMainSha: process.env.EXPECTED_MAIN_SHA || null,
    };
    const result = token
      ? await captureBackupEvidence({
          token,
          credentialKind: process.env.SUPABASE_BACKUP_OBSERVER_CREDENTIAL_KIND,
          ...common,
        })
      : buildBackupMetadataNotCaptured({
          projectRef: common.projectRef,
          mainSha: common.expectedMainSha,
        });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('production-db-backup-evidence.mjs')) main();
