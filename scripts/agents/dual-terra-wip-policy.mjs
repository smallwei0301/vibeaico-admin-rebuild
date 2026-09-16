import { execFileSync } from 'node:child_process';
import { classifyRiskPaths } from '../ci/local-isolated-test-policy.mjs';
import {
  MAX_ACTIVE_CANDIDATES,
  parseLaneMetadata as parseBaseLaneMetadata,
  readField,
  validateLaneMetadata as validateBaseLaneMetadata,
} from './agent-wip-policy.mjs';

/**
 * 轉出上限常數，讓 `agent-wip-guard.yml` 能從它匯入的這一支拿到同一個數字，
 * 不必自己再寫一次（那正是這次收斂要消滅的第三、第四份拷貝）。
 */
export { MAX_ACTIVE_CANDIDATES };
import { validateRunAdmission } from './run-admission-policy.mjs';

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isMissing(value) {
  const text = String(value ?? '').trim();
  return !text || text.includes('<!--') || text.includes('|') || /^(TBD|N\/A|UNKNOWN|-)$/i.test(text);
}

function normalizeOwnedPath(value = '') {
  const normalized = String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\*+$/, '')
    .replace(/\/+$/, '');

  return normalized
    .split('/')
    .filter((segment) => segment !== '.')
    .join('/');
}

function rawOwnedPaths(value = '') {
  return String(value)
    .split(',')
    .map((path) => path.trim())
    .filter(Boolean);
}

function parseOwnedPaths(value = '') {
  return rawOwnedPaths(value)
    .map(normalizeOwnedPath)
    .filter(Boolean);
}

function hasUnsafeOwnedPath(value = '') {
  const rawPaths = rawOwnedPaths(value);
  if (rawPaths.length === 0) return true;

  return rawPaths.some((rawPath) => {
    const path = normalizeOwnedPath(rawPath);
    return (
      !path ||
      path.startsWith('/') ||
      /^[A-Za-z]:\//.test(path) ||
      path.includes('*') ||
      path.split('/').includes('..')
    );
  });
}

function pathCovers(ownedPath, changedPath) {
  return ownedPath === changedPath || changedPath.startsWith(`${ownedPath}/`);
}

function ownershipOverlap(left, right) {
  for (const leftPath of parseOwnedPaths(left)) {
    for (const rightPath of parseOwnedPaths(right)) {
      if (
        leftPath === rightPath ||
        leftPath.startsWith(`${rightPath}/`) ||
        rightPath.startsWith(`${leftPath}/`)
      ) {
        return `${leftPath} <> ${rightPath}`;
      }
    }
  }
  return null;
}

// An acknowledgement is bound to live GitHub/local Git identity, never a body HEAD claim.
// It does not attest to a model identity or observe an Agent's uncommitted activity.
export const SOURCE_FREEZE_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const SHA40 = /^(?!0{40}$)[a-f0-9]{40}$/;
const UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

export function sourceFreezeError(metadata, now = Date.now()) {
  let receipt;
  try { receipt = JSON.parse(metadata.sourceFreeze || 'null'); } catch { return 'invalid SOURCE_FREEZE JSON'; }
  if (!receipt || receipt.writes !== 'STOPPED') return 'SOURCE_FREEZE requires stopped-writer acknowledgement';
  if (!SHA40.test(metadata.headSha || '') || receipt.head !== metadata.headSha) return 'SOURCE_FREEZE does not match live exact head';
  const captured = UTC.test(receipt.at || '') ? Date.parse(receipt.at) : NaN;
  if (!Number.isFinite(captured) || new Date(captured).toISOString().slice(0, 19) !== receipt.at.slice(0, 19)
    || !Number.isFinite(now) || captured > now || now - captured > SOURCE_FREEZE_MAX_AGE_MS) {
    return 'SOURCE_FREEZE is missing a current timestamp or has expired';
  }
  return null;
}

export function createSourceFreeze(headSha, at = new Date().toISOString()) {
  const receipt = { head: headSha, writes: 'STOPPED', at };
  const error = sourceFreezeError({ headSha, sourceFreeze: JSON.stringify(receipt) }, Date.parse(at));
  if (error) throw new Error(error);
  return JSON.stringify(receipt);
}

// Call only after the Product writer has acknowledged STOPPED; this verifies Git,
// not the existence/identity of an external Agent process. No refs are mutated.
export function readFrozenCheckoutHead(repositoryRoot = process.cwd()) {
  const git = (...args) => execFileSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' }).trim();
  const head = git('rev-parse', '--verify', 'HEAD');
  if (git('status', '--porcelain=v1', '--untracked-files=normal') || git('rev-parse', '--verify', 'HEAD') !== head) {
    throw new Error('SOURCE_FREEZE requires a clean stable Git checkout');
  }
  return head;
}

export function createSourceFreezeFromGit(repositoryRoot = process.cwd(), writerStopped = false) {
  if (writerStopped !== true) throw new Error('Explicit writer-stopped acknowledgement is required');
  return createSourceFreeze(readFrozenCheckoutHead(repositoryRoot));
}

function isVerificationTail(metadata) {
  return (
    metadata.lane === 'TERRA_BUILD' &&
    metadata.state === 'ACTIVE' &&
    metadata.activeCandidate === 'TRUE' &&
    metadata.completionClaim === 'AUDIT_READY' &&
    metadata.dualTerraPilot === 'TRUE' &&
    metadata.freezeError === null
  );
}

export function validateActualFileOwnership(metadata, changedFiles) {
  if (
    metadata.origin !== 'AGENT' ||
    metadata.state !== 'ACTIVE' ||
    metadata.lane !== 'TERRA_BUILD' ||
    metadata.dualTerraPilot !== 'TRUE'
  ) {
    return [];
  }

  if (!Array.isArray(changedFiles)) {
    return [`Dual Terra PR #${metadata.number} actual changed-file list was not loaded`];
  }

  const actualFiles = changedFiles
    .map(normalizeOwnedPath)
    .filter(Boolean);
  if (actualFiles.length === 0) {
    return [`Dual Terra PR #${metadata.number} has no actual changed files to verify`];
  }

  const ownedPaths = parseOwnedPaths(metadata.fileOwnership);
  const uncovered = actualFiles.filter(
    (changedPath) => !ownedPaths.some((ownedPath) => pathCovers(ownedPath, changedPath)),
  );
  if (uncovered.length === 0) return [];

  const sample = uncovered.slice(0, 10).join(', ');
  const suffix = uncovered.length > 10 ? ` (+${uncovered.length - 10} more)` : '';
  return [
    `Dual Terra PR #${metadata.number} changed files outside FILE_OWNERSHIP: ${sample}${suffix}`,
  ];
}

export function parseLaneMetadata(pr = {}) {
  const body = pr.body ?? '';
  const parsed = {
    ...parseBaseLaneMetadata(pr),
    headSha: pr.head?.sha ?? '',
    sourceFreeze: readField(body, 'SOURCE_FREEZE'),
    declaredRisks: upper(readField(body, 'ASTRA_RISK')).split(',').map(value => value.trim()),
    completionClaim: upper(readField(body, 'COMPLETION_CLAIM')),
    dualTerraPilot: upper(readField(body, 'DUAL_TERRA_PILOT')),
    terraSlot: readField(body, 'TERRA_SLOT'),
    testProfile: upper(readField(body, 'TEST_PROFILE')),
    testEnvId: readField(body, 'TEST_ENV_ID'),
    finalCanonicalRequired: upper(readField(body, 'FINAL_CANONICAL_REQUIRED')),
    fileOwnership: readField(body, 'FILE_OWNERSHIP'),
    deliveryUnitType: upper(readField(body, 'DELIVERY_UNIT_TYPE')),
    countInDeliveryOutcome: upper(readField(body, 'COUNT_IN_DELIVERY_OUTCOME')),
    retroactiveTrackingMigration: upper(readField(body, 'RETROACTIVE_TRACKING_MIGRATION')),
    actualChangedFiles: null,
    freezeError: /** @type {string | null} */ (null),
  };
  parsed.freezeError = sourceFreezeError(parsed);
  return parsed;
}

export function validateLaneMetadata(metadata, options = {}) {
  const errors = [
    ...validateBaseLaneMetadata(metadata, options),
    ...validateRunAdmission({ metadata }),
  ];

  if (metadata.dualTerraPilot && !['TRUE', 'FALSE'].includes(metadata.dualTerraPilot)) {
    errors.push('DUAL_TERRA_PILOT must be true or false when provided');
  }

  if (
    metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    metadata.lane === 'TERRA_BUILD' &&
    metadata.dualTerraPilot === 'TRUE'
  ) {
    if (metadata.completionClaim === 'AUDIT_READY' && metadata.freezeError !== null) {
      errors.push(metadata.freezeError || 'SOURCE_FREEZE evidence unavailable');
    }
    if (!/^[12]$/.test(metadata.terraSlot)) {
      errors.push('Dual Terra TERRA_BUILD must set TERRA_SLOT to 1 or 2');
    }
    if (metadata.testProfile !== 'LOCAL_ISOLATED') {
      errors.push('Dual Terra TERRA_BUILD must set TEST_PROFILE=LOCAL_ISOLATED');
    }
    if (metadata.finalCanonicalRequired !== 'TRUE') {
      errors.push('Dual Terra TERRA_BUILD must set FINAL_CANONICAL_REQUIRED=true');
    }
    if (metadata.testLaneRequired !== 'FALSE') {
      errors.push('Dual Terra TERRA_BUILD must not own the remote TEST lane while building');
    }
    if (isMissing(metadata.testEnvId)) {
      errors.push('Dual Terra TERRA_BUILD must declare a unique TEST_ENV_ID');
    }
    if (isMissing(metadata.fileOwnership)) {
      errors.push('Dual Terra TERRA_BUILD must declare FILE_OWNERSHIP');
    } else if (hasUnsafeOwnedPath(metadata.fileOwnership)) {
      errors.push('Dual Terra FILE_OWNERSHIP must use normalized repository-relative paths');
    }
  }

  return [...new Set(errors)];
}

export function summarizeActiveLanes(pullRequests = []) {
  const activeAgentPulls = pullRequests
    .filter((pr) => pr.state === undefined || pr.state === 'open')
    .map(parseLaneMetadata)
    .filter((metadata) => metadata.origin === 'AGENT' && metadata.state === 'ACTIVE');

  // A TEST carrier retains its delivery candidate. Same Run + primary Issue
  // identifies one delivery across stacked BUILD/VERIFY/TEST carriers, not one worker.
  // Unknown identity is never collapsed; BUILD occupancy remains conservatively per carrier.
  const candidateRows = activeAgentPulls.filter((pr) => pr.lane !== 'LUNA_CLOSURE'
    && (pr.activeCandidate === 'TRUE' || pr.lane === 'TEST_VALIDATION'));
  const candidateKey = (pr, index) => Number.isSafeInteger(pr.issueNumber) && pr.issueNumber > 0
    && /^\d{4}-\d{2}-\d{2}-[a-zA-Z0-9._-]+$/.test(pr.runId)
    ? `${pr.runId}:issue:${pr.issueNumber}` : `unknown:${index}:pr:${pr.number}`;
  const candidates = new Map();
  candidateRows.forEach((pr, index) => {
    const key = candidateKey(pr, index);
    if (!candidates.has(key)) candidates.set(key, pr);
  });
  return {
    activeAgentPulls,
    activeTerra: activeAgentPulls.filter(
      (pr) => pr.lane === 'TERRA_BUILD' && !isVerificationTail(pr),
    ),
    verifyingTerra: activeAgentPulls.filter(isVerificationTail),
    activeReserve: activeAgentPulls.filter((pr) => pr.lane === 'TERRA_RESERVE'),
    activeClosure: activeAgentPulls.filter((pr) => pr.lane === 'LUNA_CLOSURE'),
    activeTest: activeAgentPulls.filter((pr) => pr.lane === 'TEST_VALIDATION'),
    activeCandidateCarriers: candidateRows,
    activeCandidates: [...candidates.values()],
    requireActualFileCoverage: false,
  };
}

export function attachActualChangedFiles(summary, filesByPullRequest = {}) {
  summary.requireActualFileCoverage = true;
  for (const terra of [...summary.activeTerra, ...(summary.verifyingTerra ?? [])]) {
    const files = filesByPullRequest[String(terra.number)];
    terra.actualChangedFiles = Array.isArray(files) ? [...files] : null;
  }
  return summary;
}

// Reuse existing risk paths and declared Product risks. A shared coarse boundary
// is not evidence of safe independence, even when filenames do not overlap.
function sharedMutableBoundaries(metadata) {
  const paths = [...parseOwnedPaths(metadata.fileOwnership), ...(metadata.actualChangedFiles ?? [])];
  const boundaries = new Set(classifyRiskPaths(paths).reasons);
  const risks = metadata.declaredRisks ?? [];
  if (risks.includes('TENANT_AUTH_BOUNDARY')) boundaries.add('AUTH');
  if (risks.includes('PAYMENT_CONSISTENCY') || paths.some(path => /(?:payment|refund|ecpay)/i.test(path))) boundaries.add('PAYMENT');
  for (const provider of ['line', 'resend', 'vercel']) {
    if (paths.some(path => new RegExp(`(^|/)${provider}([/.-]|$)`, 'i').test(path))) boundaries.add(`PROVIDER_${provider}`);
  }
  if (risks.some(risk => ['IRREVERSIBLE_DATA', 'CROSS_REPO_CONTRACT', 'UNRESOLVED_HIGH_RISK'].includes(risk))) boundaries.add('EXCLUSIVE');
  return boundaries;
}

export function validateGlobalWip(summary) {
  const errors = [];
  const {
    activeTerra,
    verifyingTerra = [],
    activeReserve,
    activeClosure,
    activeTest,
    activeCandidates,
  } = summary;
  const pilotTerra = activeTerra.filter((pr) => pr.dualTerraPilot === 'TRUE');
  const dualPilotRequested = pilotTerra.length > 0;
  const sourceCandidates = [...activeTerra, ...verifyingTerra];
  for (let i = 0; i < sourceCandidates.length; i += 1) {
    for (const right of sourceCandidates.slice(i + 1)) {
      const left = sourceCandidates[i];
      const a = sharedMutableBoundaries(left);
      const b = sharedMutableBoundaries(right);
      const shared = [...a].filter(value => b.has(value));
      if (a.has('EXCLUSIVE') || b.has('EXCLUSIVE')) shared.push('EXCLUSIVE');
      if (shared.length) errors.push(`Shared mutable boundary requires serial work: PR #${left.number} <> PR #${right.number}: ${[...new Set(shared)].join(', ')}`);
    }
  }


  for (const terra of [...activeTerra, ...verifyingTerra]) {
    for (const error of validateLaneMetadata(terra)) {
      errors.push(`${isVerificationTail(terra) ? 'Verifying' : 'Active'} Terra PR #${terra.number}: ${error}`);
    }
    if (summary.requireActualFileCoverage) {
      errors.push(...validateActualFileOwnership(terra, terra.actualChangedFiles));
    }
  }

  if (activeTerra.length > 2) {
    errors.push(`active TERRA_BUILD count is ${activeTerra.length}; max is 2 during the free local pilot`);
  }
  if (activeTerra.length > 1 && pilotTerra.length !== activeTerra.length) {
    errors.push(`active TERRA_BUILD count is ${activeTerra.length}; max is 1 unless every lane satisfies the free DUAL_TERRA_PILOT contract`);
  }

  if (activeTerra.length === 2) {
    const issueNumbers = new Set(activeTerra.map((pr) => pr.issueNumber));
    const slots = new Set(activeTerra.map((pr) => pr.terraSlot));
    const testEnvironments = new Set(activeTerra.map((pr) => pr.testEnvId));
    const runIds = new Set(activeTerra.map((pr) => pr.runId));

    if (issueNumbers.size !== 2 || issueNumbers.has(null)) {
      errors.push('Dual Terra lanes must own different primary Issues');
    }
    if (slots.size !== 2 || !slots.has('1') || !slots.has('2')) {
      errors.push('Dual Terra lanes must occupy distinct TERRA_SLOT values 1 and 2');
    }
    if (testEnvironments.size !== 2 || [...testEnvironments].some(isMissing)) {
      errors.push('Dual Terra lanes must declare different TEST_ENV_ID values');
    }
    if (runIds.size !== 1 || [...runIds].some(isMissing)) {
      errors.push('Dual Terra lanes must belong to the same RUN_ID for one auditable pilot loop');
    }

    const overlap = ownershipOverlap(activeTerra[0].fileOwnership, activeTerra[1].fileOwnership);
    if (overlap) errors.push(`Dual Terra FILE_OWNERSHIP overlaps: ${overlap}`);

    if (summary.requireActualFileCoverage) {
      const firstActual = new Set((activeTerra[0].actualChangedFiles ?? []).map(normalizeOwnedPath));
      const actualOverlap = (activeTerra[1].actualChangedFiles ?? [])
        .map(normalizeOwnedPath)
        .filter((path) => firstActual.has(path));
      if (actualOverlap.length) {
        errors.push(`Dual Terra actual changed files overlap: ${actualOverlap.slice(0, 10).join(', ')}`);
      }
    }
  }

  for (const build of activeTerra) {
    for (const tail of verifyingTerra) {
      const overlap = ownershipOverlap(build.fileOwnership, tail.fileOwnership);
      if (overlap) {
        errors.push(
          `BUILD / AUDIT_READY FILE_OWNERSHIP overlaps: PR #${build.number} <> PR #${tail.number}: ${overlap}`,
        );
      }
    }
  }
  for (let i = 0; i < verifyingTerra.length; i += 1) {
    for (let j = i + 1; j < verifyingTerra.length; j += 1) {
      const overlap = ownershipOverlap(verifyingTerra[i].fileOwnership, verifyingTerra[j].fileOwnership);
      if (overlap) {
        errors.push(
          `AUDIT_READY FILE_OWNERSHIP overlaps: PR #${verifyingTerra[i].number} <> PR #${verifyingTerra[j].number}: ${overlap}`,
        );
      }
    }
  }

  if (activeReserve.length > 1) {
    errors.push(`active TERRA_RESERVE count is ${activeReserve.length}; max is 1`);
  }
  if (dualPilotRequested && activeReserve.length > 0) {
    errors.push('TERRA_RESERVE is disabled while DUAL_TERRA_PILOT is active');
  }
  if (activeClosure.length > 1) {
    errors.push(`active LUNA_CLOSURE count is ${activeClosure.length}; max is 1`);
  }
  if (activeTest.length > 1) {
    errors.push(`active TEST_VALIDATION count is ${activeTest.length}; max is 1`);
  }
  if (activeCandidates.length > MAX_ACTIVE_CANDIDATES) {
    errors.push(`ACTIVE_CANDIDATE count is ${activeCandidates.length}; max is ${MAX_ACTIVE_CANDIDATES}`);
  }

  if (activeReserve.length === 1 && !dualPilotRequested) {
    if (activeTerra.length !== 1) {
      errors.push('TERRA_RESERVE requires exactly one active MAIN TERRA_BUILD');
    } else if (activeReserve[0].issueNumber === activeTerra[0].issueNumber) {
      errors.push(`TERRA_RESERVE and TERRA_BUILD cannot own the same Issue #${activeTerra[0].issueNumber}`);
    }
  }

  if (activeTerra.length > 0) {
    const needsClosure = activeTerra.some((terra) => {
      const target = terra.closureTarget.trim();
      return !/^EMPTY_WITH_SCAN$/i.test(target) && !/^REPORT:/i.test(target);
    });
    if (needsClosure && activeClosure.length !== 1) {
      errors.push(`active TERRA_BUILD lanes require one shared LUNA_CLOSURE or explicit EMPTY_WITH_SCAN/REPORT evidence; found ${activeClosure.length}`);
    }
  }

  return errors;
}

export function pilotCapacity(summary) {
  const pilotRequested = summary.activeTerra.some((terra) => terra.dualTerraPilot === 'TRUE');
  const qualified = pilotRequested && validateGlobalWip(summary).length === 0;
  return {
    terraMax: qualified ? 2 : 1,
    reserveMax: qualified ? 0 : 1,
    qualified,
  };
}
