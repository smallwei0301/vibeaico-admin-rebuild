import { createHash } from 'node:crypto';

export function normalizeWipErrors(errors = []) {
  return [...new Set(
    (Array.isArray(errors) ? errors : [])
      .map((error) => String(error ?? '').trim().replace(/\s+/g, ' '))
      .filter(Boolean),
  )].sort((left, right) => left.localeCompare(right));
}

export function buildWipErrorFingerprint({ prNumber, headSha, errors } = {}) {
  const payload = {
    prNumber: Number(prNumber) || null,
    headSha: String(headSha ?? '').trim().toLowerCase(),
    errors: normalizeWipErrors(errors),
  };
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function readWipEvidence(body = '') {
  const text = String(body ?? '');
  const fingerprint = text.match(/^\s*-?\s*ERROR_FINGERPRINT:\s*([a-f0-9]{64})\s*$/mi)?.[1] ?? null;
  const headSha = text.match(/^\s*-?\s*EXACT_HEAD:\s*([a-f0-9]{40})\s*$/mi)?.[1] ?? null;
  return { fingerprint, headSha };
}

export function isDuplicateWipFailure({ previousBody, fingerprint, headSha } = {}) {
  const previous = readWipEvidence(previousBody);
  return Boolean(
    previous.fingerprint &&
    previous.fingerprint === String(fingerprint ?? '').trim().toLowerCase() &&
    previous.headSha &&
    previous.headSha === String(headSha ?? '').trim().toLowerCase()
  );
}
