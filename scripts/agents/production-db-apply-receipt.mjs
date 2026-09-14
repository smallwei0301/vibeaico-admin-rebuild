import { createHash } from 'node:crypto';

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const PROJECT_REF = /^[a-z0-9]{20}$/;
const STATES = new Set(['ISSUED', 'CONSUMING', 'CONSUMED', 'UNKNOWN']);
const NEXT = Object.freeze({
  ISSUED: ['CONSUMING'],
  CONSUMING: ['CONSUMED', 'UNKNOWN'],
  CONSUMED: [],
  UNKNOWN: [],
});
export const APPLY_RECEIPT_MAX_AGE_SECONDS = 300;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function iso(value, label) {
  const text = String(value ?? '').trim();
  if (!text || !text.endsWith('Z') || Number.isNaN(Date.parse(text))) fail('INVALID_RECEIPT_TIME', `${label} must be ISO UTC`);
  return new Date(text).toISOString();
}

function core(receipt) {
  return {
    schemaVersion: receipt.schemaVersion,
    receiptId: receipt.receiptId,
    releaseId: receipt.releaseId,
    mainSha: receipt.mainSha,
    planDigest: receipt.planDigest,
    projectRef: receipt.projectRef,
    githubRunId: receipt.githubRunId,
    githubRunAttempt: receipt.githubRunAttempt,
    issuedAt: receipt.issuedAt,
    status: receipt.status,
    statusAt: receipt.statusAt,
  };
}

function digestOf(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function assertShape(receipt) {
  if (!receipt || receipt.schemaVersion !== 1 || !STATES.has(receipt.status)) fail('INVALID_APPLY_RECEIPT', 'receipt is invalid');
  if (!DIGEST.test(String(receipt.receiptId ?? '')) || !DIGEST.test(String(receipt.receiptDigest ?? ''))) fail('INVALID_APPLY_RECEIPT', 'receipt digests are invalid');
  if (!SHA.test(String(receipt.mainSha ?? '')) || !DIGEST.test(String(receipt.planDigest ?? ''))) fail('INVALID_APPLY_RECEIPT', 'receipt source identity is invalid');
  if (!PROJECT_REF.test(String(receipt.projectRef ?? ''))) fail('INVALID_APPLY_RECEIPT', 'receipt project ref is invalid');
  if (!String(receipt.releaseId ?? '').trim() || !String(receipt.githubRunId ?? '').trim()) fail('INVALID_APPLY_RECEIPT', 'receipt release/run identity is missing');
  if (!Number.isSafeInteger(receipt.githubRunAttempt) || receipt.githubRunAttempt < 1) fail('INVALID_APPLY_RECEIPT', 'receipt run attempt is invalid');
  iso(receipt.issuedAt, 'issuedAt');
  iso(receipt.statusAt, 'statusAt');
  if (digestOf(core(receipt)) !== receipt.receiptDigest) fail('APPLY_RECEIPT_DIGEST_MISMATCH', 'receipt was modified after issuance');
}

function assertIdentityAndFreshness(receipt, plan, projectRef, now) {
  if (!plan || receipt.releaseId !== plan.releaseId || receipt.mainSha !== plan.mainSha || receipt.planDigest !== plan.planDigest) {
    fail('APPLY_RECEIPT_PLAN_MISMATCH', 'receipt does not identify the exact release plan');
  }
  if (receipt.projectRef !== projectRef) fail('APPLY_RECEIPT_PROJECT_MISMATCH', 'receipt belongs to another project');
  const nowMs = Date.parse(iso(now, 'now'));
  const ageMs = nowMs - Date.parse(receipt.issuedAt);
  if (ageMs < -60_000 || ageMs > APPLY_RECEIPT_MAX_AGE_SECONDS * 1000) fail('APPLY_RECEIPT_STALE', 'receipt is outside its admission window');
}

export function createProductionDbApplyReceipt({ releaseId, mainSha, planDigest, projectRef, githubRunId, githubRunAttempt, issuedAt } = {}) {
  const normalizedIssuedAt = iso(issuedAt, 'issuedAt');
  if (!SHA.test(String(mainSha ?? '')) || !DIGEST.test(String(planDigest ?? '')) || !PROJECT_REF.test(String(projectRef ?? ''))) {
    fail('INVALID_APPLY_RECEIPT_IDENTITY', 'mainSha, planDigest and projectRef must be exact');
  }
  const runId = String(githubRunId ?? '').trim();
  const id = String(releaseId ?? '').trim();
  if (!runId || !id || !Number.isSafeInteger(githubRunAttempt) || githubRunAttempt < 1) fail('INVALID_APPLY_RECEIPT_IDENTITY', 'release and GitHub run identity are required');
  const receiptId = digestOf({ releaseId: id, mainSha, planDigest, projectRef, githubRunId: runId, githubRunAttempt, issuedAt: normalizedIssuedAt });
  const receipt = {
    schemaVersion: 1,
    receiptId,
    releaseId: id,
    mainSha,
    planDigest,
    projectRef,
    githubRunId: runId,
    githubRunAttempt,
    issuedAt: normalizedIssuedAt,
    status: 'ISSUED',
    statusAt: normalizedIssuedAt,
  };
  return { ...receipt, receiptDigest: digestOf(receipt), databaseMutationAuthorized: false };
}

export function assertApplyReceiptAdmitted(receipt, plan, projectRef, { now = new Date().toISOString() } = {}) {
  assertShape(receipt);
  if (receipt.status !== 'ISSUED') fail('APPLY_RECEIPT_REPLAY', `receipt status ${receipt.status} is not reusable`);
  assertIdentityAndFreshness(receipt, plan, projectRef, now);
  return { status: 'APPLY_RECEIPT_ADMITTED', receiptId: receipt.receiptId, databaseMutationAuthorized: false };
}

export function assertConsumingApplyReceipt(receipt, plan, projectRef, { now = new Date().toISOString() } = {}) {
  assertShape(receipt);
  if (receipt.status !== 'CONSUMING') fail('APPLY_RECEIPT_NOT_DURABLY_CONSUMING', `writer requires CONSUMING receipt, got ${receipt.status}`);
  assertIdentityAndFreshness(receipt, plan, projectRef, now);
  return { status: 'CONSUMING_APPLY_RECEIPT_VERIFIED', receiptId: receipt.receiptId, databaseMutationAuthorized: false };
}

export function advanceApplyReceipt(receipt, status, at) {
  assertShape(receipt);
  const next = String(status ?? '').trim().toUpperCase();
  if (!STATES.has(next) || !NEXT[receipt.status].includes(next)) fail('INVALID_APPLY_RECEIPT_TRANSITION', `${receipt.status} cannot transition to ${next || '<empty>'}`);
  const statusAt = iso(at, 'statusAt');
  if (Date.parse(statusAt) < Date.parse(receipt.statusAt)) fail('APPLY_RECEIPT_TIME_REGRESSION', 'receipt time cannot move backwards');
  const updated = { ...core(receipt), status: next, statusAt };
  return { ...updated, receiptDigest: digestOf(updated), databaseMutationAuthorized: false };
}
