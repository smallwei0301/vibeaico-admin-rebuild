import {
  parseLaneMetadata as parseBaseLaneMetadata,
  readField,
  validateLaneMetadata as validateBaseLaneMetadata,
} from './agent-wip-policy.mjs';

function upper(value) {
  return String(value ?? '').trim().toUpperCase();
}

function isMissing(value) {
  const text = String(value ?? '').trim();
  return !text || text.includes('<!--') || text.includes('|') || /^(TBD|N\/A|UNKNOWN|-)$/i.test(text);
}

function normalizeOwnedPath(value = '') {
  return String(value)
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+/g, '/')
    .replace(/\*+$/, '')
    .replace(/\/+$/, '');
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
    return !path || path === '.' || path.includes('*') || path.split('/').includes('..');
  });
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

export function parseLaneMetadata(pr = {}) {
  const body = pr.body ?? '';
  return {
    ...parseBaseLaneMetadata(pr),
    dualTerraPilot: upper(readField(body, 'DUAL_TERRA_PILOT')),
    terraSlot: readField(body, 'TERRA_SLOT'),
    testProfile: upper(readField(body, 'TEST_PROFILE')),
    testEnvId: readField(body, 'TEST_ENV_ID'),
    finalCanonicalRequired: upper(readField(body, 'FINAL_CANONICAL_REQUIRED')),
    fileOwnership: readField(body, 'FILE_OWNERSHIP'),
  };
}

export function validateLaneMetadata(metadata, options = {}) {
  const errors = [...validateBaseLaneMetadata(metadata, options)];

  if (metadata.dualTerraPilot && !['TRUE', 'FALSE'].includes(metadata.dualTerraPilot)) {
    errors.push('DUAL_TERRA_PILOT must be true or false when provided');
  }

  if (
    metadata.origin === 'AGENT' &&
    metadata.state === 'ACTIVE' &&
    metadata.lane === 'TERRA_BUILD' &&
    metadata.dualTerraPilot === 'TRUE'
  ) {
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

  return {
    activeAgentPulls,
    activeTerra: activeAgentPulls.filter((pr) => pr.lane === 'TERRA_BUILD'),
    activeReserve: activeAgentPulls.filter((pr) => pr.lane === 'TERRA_RESERVE'),
    activeClosure: activeAgentPulls.filter((pr) => pr.lane === 'LUNA_CLOSURE'),
    activeTest: activeAgentPulls.filter((pr) => pr.lane === 'TEST_VALIDATION'),
    activeCandidates: activeAgentPulls.filter((pr) => pr.activeCandidate === 'TRUE' && pr.lane !== 'LUNA_CLOSURE'),
  };
}

export function validateGlobalWip(summary) {
  const errors = [];
  const { activeTerra, activeReserve, activeClosure, activeTest, activeCandidates } = summary;
  const pilotTerra = activeTerra.filter((pr) => pr.dualTerraPilot === 'TRUE');
  const dualPilotRequested = pilotTerra.length > 0;

  for (const terra of activeTerra) {
    for (const error of validateLaneMetadata(terra)) {
      errors.push(`Active Terra PR #${terra.number}: ${error}`);
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
  if (activeCandidates.length > 2) {
    errors.push(`ACTIVE_CANDIDATE count is ${activeCandidates.length}; max is 2`);
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
