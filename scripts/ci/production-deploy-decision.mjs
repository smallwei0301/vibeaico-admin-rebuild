import { RUNTIME_PATHS } from './vercel-ignore-build.mjs';

const FULL_SHA = /^(?!0{40}$)[0-9a-f]{40}$/i;
const CHECK_STATES = new Set(['SUCCESS', 'PENDING', 'FAILURE', 'CANCELLED']);

function normalizeSha(value = '') {
  return String(value ?? '').trim().toLowerCase();
}

function isValidSha(value) {
  return FULL_SHA.test(value);
}

function normalizeChangedPath(value) {
  if (typeof value !== 'string' || /[\0\r\n]/.test(value)) return null;
  const normalized = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[A-Za-z]:\//.test(normalized) ||
    normalized.split('/').includes('..')
  ) {
    return null;
  }
  return normalized;
}

function uniquePaths(paths) {
  if (!Array.isArray(paths)) return null;
  const normalized = [];
  for (const value of paths) {
    const path = normalizeChangedPath(value);
    if (!path) return null;
    normalized.push(path);
  }
  return [...new Set(normalized)];
}

/**
 * Keep Production deployment classification aligned with the existing Vercel
 * ignored-build allowlist. Directory entries such as `src` and `public` cover
 * their descendants; build/config files match exactly.
 */
export function isProductionRuntimePath(path) {
  const normalized = normalizeChangedPath(path);
  if (!normalized) return false;
  return RUNTIME_PATHS.some((entry) => normalized === entry || normalized.startsWith(`${entry}/`));
}

export function classifyProductionPaths(changedPaths) {
  const paths = uniquePaths(changedPaths);
  if (paths === null) {
    return { comparable: false, changedPaths: [], runtimePaths: [] };
  }
  return {
    comparable: paths.length > 0,
    changedPaths: paths,
    runtimePaths: paths.filter(isProductionRuntimePath),
  };
}

/**
 * Pure dry-run policy for Issue #228.
 *
 * IMPORTANT: `changedPaths` must describe the complete range from the last
 * successfully deployed Production SHA to `currentSha`, not merely HEAD^..HEAD.
 * The adapter must independently prove that comparison base is an ancestor of
 * current main and that the changed-file list was not truncated.
 *
 * This function never deploys. `WOULD_DEPLOY` is only a decision artifact for a
 * future adapter that has an authorized Vercel secret and canary-proven cutover.
 */
export function decideProductionDeployCandidate(input = {}) {
  const currentSha = normalizeSha(input.currentSha);
  const latestMainSha = normalizeSha(input.latestMainSha);
  const lastProductionSha = normalizeSha(input.lastProductionSha);
  const comparisonBaseSha = normalizeSha(input.comparisonBaseSha);
  const checksState = String(input.checksState ?? '').trim().toUpperCase();
  const comparisonBaseIsAncestor = input.comparisonBaseIsAncestor;
  const changedPathsComplete = input.changedPathsComplete;
  const pathResult = classifyProductionPaths(input.changedPaths);

  const result = (action, reason, extra = {}) => ({
    action,
    reason,
    currentSha,
    latestMainSha,
    lastProductionSha,
    comparisonBaseSha,
    checksState,
    comparisonBaseIsAncestor,
    changedPathsComplete,
    changedPaths: pathResult.changedPaths,
    runtimePaths: pathResult.runtimePaths,
    ...extra,
  });

  if (!isValidSha(currentSha) || !isValidSha(latestMainSha)) {
    return result('BLOCK', 'UNTRUSTED_SHA');
  }
  if (lastProductionSha && !isValidSha(lastProductionSha)) {
    return result('BLOCK', 'UNTRUSTED_LAST_PRODUCTION_SHA');
  }

  // Never let an older CI completion race a newer main commit into Production.
  if (currentSha !== latestMainSha) {
    return result('SKIP', 'STALE_SHA');
  }

  if (!CHECK_STATES.has(checksState)) {
    return result('BLOCK', 'UNTRUSTED_CHECK_STATE');
  }
  if (checksState === 'PENDING') {
    return result('WAIT', 'CHECKS_PENDING');
  }
  if (checksState !== 'SUCCESS') {
    return result('BLOCK', 'CHECKS_NOT_GREEN');
  }

  if (lastProductionSha && currentSha === lastProductionSha) {
    return result('SKIP', 'ALREADY_DEPLOYED');
  }

  // First controlled deployment is intentionally fail-safe: without a known
  // deployed baseline there is no trustworthy range to prove non-runtime.
  if (!lastProductionSha) {
    return result('WOULD_DEPLOY', 'NO_DEPLOYED_BASELINE');
  }

  // The diff must start at the last known successful Production SHA. Using only
  // the immediate parent can lose a runtime change when several main commits are
  // coalesced and the newest commit itself is docs-only.
  if (comparisonBaseSha !== lastProductionSha) {
    return result('BLOCK', 'UNTRUSTED_COMPARISON_BASE');
  }

  // A syntactically matching SHA is not enough. A rollback/manual deployment can
  // leave Production pointing at a commit that is not an ancestor of current
  // main; such a range cannot safely justify a non-runtime skip.
  if (comparisonBaseIsAncestor !== true) {
    return result('BLOCK', 'UNTRUSTED_COMPARISON_ANCESTRY');
  }

  // GitHub compare/file APIs can be paginated or capped. A partial non-empty list
  // is more dangerous than an empty list because it can look confidently
  // docs-only while the omitted page contains runtime files. Fail toward deploy.
  if (changedPathsComplete !== true) {
    return result('WOULD_DEPLOY', 'INCOMPLETE_DIFF_FAIL_SAFE');
  }

  // Unknown/empty/malformed classification fails toward deployment, never toward
  // a silent skip. The future real adapter may still be blocked by other gates.
  if (!pathResult.comparable) {
    return result('WOULD_DEPLOY', 'CLASSIFIER_FAILED_FAIL_SAFE');
  }

  if (pathResult.runtimePaths.length === 0) {
    return result('SKIP', 'NON_RUNTIME_DELTA');
  }

  return result('WOULD_DEPLOY', 'RUNTIME_DELTA');
}
