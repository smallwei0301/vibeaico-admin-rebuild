const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const STATES = new Set([
  'PRE_APPLY', 'APPLYING', 'APPLY_UNKNOWN', 'NOT_APPLIED_CONFIRMED',
  'APPLIED_CONFIRMED', 'POSTCHECK_FAILED', 'PRODUCTION_SCHEMA_READY',
]);
const NEXT = Object.freeze({
  PRE_APPLY: ['APPLYING'],
  APPLYING: ['APPLY_UNKNOWN', 'APPLIED_CONFIRMED'],
  APPLY_UNKNOWN: ['NOT_APPLIED_CONFIRMED', 'APPLIED_CONFIRMED'],
  NOT_APPLIED_CONFIRMED: ['APPLYING'],
  APPLIED_CONFIRMED: ['POSTCHECK_FAILED', 'PRODUCTION_SCHEMA_READY'],
  POSTCHECK_FAILED: [],
  PRODUCTION_SCHEMA_READY: [],
});

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function iso(value, label) {
  const text = String(value ?? '').trim();
  if (!text || Number.isNaN(Date.parse(text)) || !text.endsWith('Z')) fail('INVALID_JOURNAL_TIME', `${label} must be ISO UTC`);
  return new Date(text).toISOString();
}

export function createReleaseJournal({ releaseId, mainSha, planDigest, createdAt } = {}) {
  const id = String(releaseId ?? '').trim();
  if (!id) fail('INVALID_RELEASE_ID', 'releaseId is required');
  if (!SHA.test(String(mainSha ?? ''))) fail('INVALID_MAIN_SHA', 'mainSha is invalid');
  if (!DIGEST.test(String(planDigest ?? ''))) fail('INVALID_PLAN_DIGEST', 'planDigest is invalid');
  const at = iso(createdAt, 'createdAt');
  return {
    schemaVersion: 1,
    releaseId: id,
    mainSha,
    planDigest,
    status: 'PRE_APPLY',
    events: [{ status: 'PRE_APPLY', at, evidenceRef: 'journal:create' }],
  };
}

export function advanceReleaseJournal(journal, { status, at, evidenceRef } = {}) {
  if (!journal || journal.schemaVersion !== 1 || !STATES.has(journal.status) || !Array.isArray(journal.events)) {
    fail('INVALID_RELEASE_JOURNAL', 'journal is invalid');
  }
  const next = String(status ?? '').trim().toUpperCase();
  if (!STATES.has(next) || !NEXT[journal.status].includes(next)) {
    fail('INVALID_JOURNAL_TRANSITION', `${journal.status} cannot transition to ${next || '<empty>'}`);
  }
  const ref = String(evidenceRef ?? '').trim();
  if (!ref || ref.length > 240 || ref.includes('://')) fail('INVALID_JOURNAL_EVIDENCE_REF', 'evidenceRef must be a compact non-secret reference');
  const timestamp = iso(at, 'at');
  const previous = journal.events.at(-1)?.at;
  if (previous && Date.parse(timestamp) < Date.parse(previous)) fail('JOURNAL_TIME_REGRESSION', 'journal time cannot move backwards');
  return {
    ...journal,
    status: next,
    events: [...journal.events, { status: next, at: timestamp, evidenceRef: ref }],
  };
}

export function assertWriterAttemptAllowed(journal) {
  if (!journal || !['PRE_APPLY', 'NOT_APPLIED_CONFIRMED'].includes(journal.status)) {
    fail('WRITER_RETRY_BLOCKED', `writer attempt is blocked while journal status is ${journal?.status ?? 'UNKNOWN'}`);
  }
  return { status: 'WRITER_ATTEMPT_ALLOWED', releaseId: journal.releaseId, databaseMutationAuthorized: false };
}
