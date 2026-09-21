import { isPlaceholder, readField, rewriteField } from './agent-wip-policy.mjs';

const DELIVERY_TYPES = new Set(['SLICE', 'STANDALONE', 'EPIC', 'GOVERNANCE']);
const upper = (value) => String(value ?? '').trim().toUpperCase();

/** Normalize both sides of a rename; a moved Product file is still Product scope. @param {any[]} files */
export function boundaryPaths(files = []) {
  return [...new Set(files.flatMap(file => typeof file === 'string'
    ? [file] : [file?.filename, file?.previous_filename]).filter(Boolean))];
}

/** Only these evidence-only directories are deterministically pure bookkeeping. @param {any} input */
export function validateBookkeepingWorkstream({ body = '', changedFiles = [] } = {}) {
  const paths = boundaryPaths(changedFiles);
  const evidenceOnly = paths.length > 0 && paths.every(path =>
    /^(?:docs\/metrics\/|docs\/schema-truth\/)/.test(path) &&
    !path.split('/').some(part => !part || part === '.' || part === '..') &&
    !path.includes('\\'));
  if (evidenceOnly && upper(readField(body, 'WORKSTREAM')) === 'PRODUCT_MAINLINE') {
    return ['Pure metrics/schema-truth bookkeeping must use WORKSTREAM: MODEL_GOVERNANCE; the recorded Product Run does not determine this PR workstream'];
  }
  return [];
}

/** Shared applicability with Completion Truth; work origin is not an exemption.
 * @param {string} body @param {{policyApplies?: boolean}} classification */
export function shouldValidateDeliveryUnitBoundary(body = '', classification = {}) {
  return Boolean(readField(body, 'WORKSTREAM') || classification.policyApplies);
}

// Shared by preflight and the required remote guard; do not duplicate this contract.
/** @param {string} body @param {any} metadata */
export function validateDeliveryUnitBoundary(body = '', metadata = {}) {
  const errors = [];
  const type = upper(readField(body, 'DELIVERY_UNIT_TYPE'));
  const count = upper(readField(body, 'COUNT_IN_DELIVERY_OUTCOME'));
  const retroactive = upper(readField(body, 'RETROACTIVE_TRACKING_MIGRATION'));
  const outcome = readField(body, 'USER_VISIBLE_OUTCOME');

  if (!DELIVERY_TYPES.has(type)) errors.push('DELIVERY_UNIT_TYPE must be SLICE, STANDALONE, EPIC, or GOVERNANCE');
  if (!['TRUE', 'FALSE'].includes(count)) errors.push('COUNT_IN_DELIVERY_OUTCOME must be true or false');
  if (!['TRUE', 'FALSE'].includes(retroactive)) errors.push('RETROACTIVE_TRACKING_MIGRATION must be true or false');
  if (['EPIC', 'GOVERNANCE'].includes(type) && count !== 'FALSE') {
    errors.push(`${type} must set COUNT_IN_DELIVERY_OUTCOME=false`);
  }
  if (retroactive === 'TRUE' && count !== 'FALSE') {
    errors.push('A retroactive tracking migration must set COUNT_IN_DELIVERY_OUTCOME=false');
  }
  if (['SLICE', 'STANDALONE'].includes(type)) {
    if (count !== 'TRUE') errors.push(`${type} must set COUNT_IN_DELIVERY_OUTCOME=true`);
    if (retroactive !== 'FALSE') errors.push(`${type} counted as new delivery must set RETROACTIVE_TRACKING_MIGRATION=false`);
    if (!metadata.issueNumber) errors.push(`${type} must declare pr-lifecycle issue: <number>`);
    if (isPlaceholder(outcome) || /^none$/i.test(outcome)) {
      errors.push(`${type} must declare one USER_VISIBLE_OUTCOME`);
    }
  }
  const activeProductLane = metadata.origin === 'AGENT' && metadata.state === 'ACTIVE' &&
    ['TERRA_BUILD', 'TEST_VALIDATION'].includes(metadata.lane);
  if (activeProductLane && !['SLICE', 'STANDALONE'].includes(type)) {
    errors.push('An active Product delivery lane must point to a closable SLICE or STANDALONE Issue');
  }
  if (metadata.lane === 'GOVERNANCE' && type && type !== 'GOVERNANCE') {
    errors.push('AGENT_LANE=GOVERNANCE must use DELIVERY_UNIT_TYPE=GOVERNANCE');
  }
  return [...new Set(errors)];
}

/** Exemption needs validated current scope, never just a self-declared lane. @param {any} input */
export function shouldApplyProductGlobalWip({ metadata, classification, ownErrors = [], completeInventory = false }) {
  if (metadata.origin !== 'AGENT' || metadata.state !== 'ACTIVE') return false;
  return !(completeInventory && classification?.workstream === 'MODEL_GOVERNANCE' &&
    classification?.isModelGovernance === true && classification.errors.length === 0 &&
    metadata.lane === 'GOVERNANCE' && ownErrors.length === 0);
}

/** Closing a lane is not acceptance of its Product. Do not change open/active work. @param {any} pr */
export function terminalLabelPlan(pr) {
  if (pr.state !== 'closed') return null;
  const merged = pr.merged === true || Boolean(pr.merged_at);
  return {
    add: merged ? 'state:complete' : 'state:historical',
    remove: ['state:active', 'state:reserve-ready', 'state:parked', 'state:owner-blocked',
      'candidate:active', 'governance:lane-metadata-incomplete', 'governance:wip-violation',
      merged ? 'state:historical' : 'state:complete'],
  };
}


/** Reconcile the single current pr-lifecycle marker without touching prose/examples. */
function rewriteLifecycleState(body, value) {
  const source = String(body ?? '');
  const blocks = [...source.matchAll(/<!--\s*pr-lifecycle\b[\s\S]*?-->/gi)];
  if (!blocks.length) return { body: source, changed: false, error: null };
  if (blocks.length !== 1) {
    return { body: source, changed: false, error: 'Ambiguous pr-lifecycle blocks; terminal body not rewritten' };
  }

  const blockMatch = blocks[0];
  const block = blockMatch[0];
  const states = [...block.matchAll(/(^|\n)(\s*state\s*:\s*)([A-Z_]+)(?=\s*(?:\n|$))/gim)];
  if (states.length !== 1) {
    return { body: source, changed: false, error: 'Missing or ambiguous pr-lifecycle state; terminal body not rewritten' };
  }

  const stateMatch = states[0];
  if (upper(stateMatch[3]) === value) return { body: source, changed: false, error: null };
  const start = (blockMatch.index ?? 0) + (stateMatch.index ?? 0) + stateMatch[1].length + stateMatch[2].length;
  const end = start + stateMatch[3].length;
  return { body: source.slice(0, start) + value + source.slice(end), changed: true, error: null };
}

/**
 * Reconcile only current machine-readable lane declarations after GitHub has
 * already made the PR terminal. Historical prose/review evidence stays intact.
 * Ambiguous or example-only metadata is never rewritten.
 * @param {any} pr
 */
export function terminalBodyPlan(pr) {
  if (pr?.state !== 'closed') return null;
  const merged = pr.merged === true || Boolean(pr.merged_at);
  const terminalState = merged ? 'COMPLETE' : 'HISTORICAL';
  const lifecycleState = merged ? 'MERGED' : 'HISTORICAL';
  let body = String(pr.body ?? '');
  const errors = [];
  const changedFields = [];

  const lifecycle = rewriteLifecycleState(body, lifecycleState);
  if (lifecycle.error) errors.push(lifecycle.error);
  else if (lifecycle.changed) changedFields.push('pr-lifecycle.state');
  body = lifecycle.body;

  for (const [field, value] of [['LANE_STATE', terminalState], ['ACTIVE_CANDIDATE', 'false']]) {
    const current = readField(body, field);
    if (!current) continue;
    const rewritten = rewriteField(body, field, value);
    if (rewritten.error) {
      errors.push(rewritten.error);
      continue;
    }
    if (rewritten.changed) changedFields.push(field);
    body = rewritten.body;
  }

  return {
    body,
    changed: body !== String(pr.body ?? ''),
    changedFields,
    terminalState,
    errors: [...new Set(errors)],
  };
}
