import { ALLOWED, isPlaceholder, parseLaneMetadata, readField, rewriteField } from './agent-wip-policy.mjs';

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


/** The independent terminal writer uses this bounded, compensating reconciliation; REST is not atomic.
 * Never writes review status, dispatches TEST, replaces all labels, or follows a new close generation.
 * @param {{github: any, owner: string, repo: string, current: any, warning?: Function}} input */
export async function reconcileTerminalPr({ github, owner, repo, current, warning = () => {} }) {
  const read = async () => (await github.rest.pulls.get({ owner, repo, pull_number: current.number })).data;
  const sameClose = pr => pr.state === 'closed' && pr.head?.sha === current.head?.sha &&
    pr.closed_at === current.closed_at && Boolean(pr.merged || pr.merged_at) === Boolean(current.merged || current.merged_at);
  const names = pr => (pr.labels ?? []).map(label => typeof label === 'string' ? label : label.name);
  const remove = async name => {
    try { await github.rest.issues.removeLabel({ owner, repo, issue_number: current.number, name }); return true; }
    catch (error) { if (error.status !== 404) throw error; return false; }
  };
  let touched = false, bodyReconciled = false, beforeBody, writtenBody;
  const removedByUs = new Set(), addedByUs = new Set();
  const write = async operation => {
    const fresh = await read();
    if (!sameClose(fresh)) return false;
    touched = true; // An API error may occur after the remote side effect; finally still checks truth.
    await operation(fresh);
    return true;
  };
  const restoreOpen = async observed => {
    // Conditional undo of only fields this invocation wrote, using the fresh body/prose.
    // A changed field belongs to its new writer and is preserved, not replaced by an old snapshot.
    let body = observed.body ?? '';
    const state = source => {
      const blocks = [...String(source).matchAll(/<!--\s*pr-lifecycle\b[\s\S]*?-->/gi)];
      const rows = blocks.length === 1 ? [...blocks[0][0].matchAll(/(?:^|\n)\s*state\s*:\s*([A-Z_]+)(?=\s*(?:\n|$))/gim)] : [];
      return rows.length === 1 ? rows[0][1] : null;
    };
    // State, candidate and lane form one ownership decision: PARKED/false is new intent,
    // while a new head or unrelated planning field does not take ownership of terminal fields.
    const lifecycleContract = source => {
      const { issueNumber, origin, lane, state: laneState, activeCandidate } = parseLaneMetadata({ body: source });
      return { issueNumber, origin, lane, laneState, activeCandidate,
        workstream: upper(readField(source, 'WORKSTREAM')), lifecycleState: state(source) };
    };
    const ownContract = writtenBody !== undefined &&
      JSON.stringify(lifecycleContract(body)) === JSON.stringify(lifecycleContract(writtenBody));
    if (ownContract) {
      for (const field of ['LANE_STATE', 'ACTIVE_CANDIDATE']) {
        const prior = readField(beforeBody, field), written = readField(writtenBody, field);
        if (prior && prior !== written && readField(body, field) === written) {
          const undo = rewriteField(body, field, prior);
          if (undo.error) throw new Error(undo.error);
          body = undo.body;
        }
      }
      const prior = state(beforeBody), written = state(writtenBody);
      if (prior && prior !== written && state(body) === written) {
        const undo = rewriteLifecycleState(body, prior);
        if (undo.error) throw new Error(undo.error);
        body = undo.body;
      }
    }
    const sameOpen = pr => pr.state === 'open' && pr.head?.sha === observed.head?.sha && pr.body === observed.body;
    const openWrite = async operation => {
      const fresh = await read();
      if (!sameOpen(fresh)) throw new Error('Lifecycle or metadata changed during reopen compensation; reconciliation pending');
      await operation(fresh);
    };
    if (body !== observed.body) {
      await openWrite(() => github.rest.pulls.update({ owner, repo, pull_number: current.number, body }));
      observed = { ...observed, body };
    }
    const metadata = parseLaneMetadata(observed);
    const states = { ACTIVE: 'state:active', READY_FOR_PROMOTION: 'state:reserve-ready',
      PARKED: 'state:parked', OWNER_BLOCKED: 'state:owner-blocked', COMPLETE: 'state:complete', HISTORICAL: 'state:historical' };
    if (!['AGENT', 'OWNER'].includes(metadata.origin) || !ALLOWED.state.has(metadata.state) ||
        !ALLOWED.lane.has(metadata.lane) || !ALLOWED.boolean.has(metadata.activeCandidate)) {
      // Invalid body cannot determine desired labels. Reconcile this invocation's
      // attempted writes, including an API that wrote before throwing; do not restore
      // a terminal label or overwrite a new state label.
      for (const name of addedByUs) await openWrite(async fresh => {
        if (names(fresh).includes(name)) await remove(name);
      });
      for (const name of removedByUs) await openWrite(async fresh => {
        const present = names(fresh);
        if (present.includes(name) || ['state:historical', 'state:complete'].includes(name)) return;
        if (name.startsWith('state:') && present.some(label => label.startsWith('state:'))) return;
        if (name === 'candidate:active' && present.some(label => label.startsWith('state:') && !removedByUs.has(label))) return;
        await github.rest.issues.addLabels({ owner, repo, issue_number: current.number, labels: [name] });
      });
      throw new Error('Reopened metadata is incomplete; own attempted label mutations reconciled where observable, reconciliation pending');
    }
    const desired = metadata.origin === 'AGENT' ? [states[metadata.state]] : [];
    if (metadata.origin === 'AGENT' && metadata.activeCandidate === 'TRUE' && metadata.lane !== 'LUNA_CLOSURE') desired.push('candidate:active');
    for (const name of [...Object.values(states), 'candidate:active']) {
      if (!desired.includes(name)) await openWrite(async fresh => { if (names(fresh).includes(name)) await remove(name); });
    }
    await openWrite(async fresh => {
      const additions = desired.filter(name => !names(fresh).includes(name));
      if (additions.length) await github.rest.issues.addLabels({ owner, repo, issue_number: current.number, labels: additions });
    });
    if (!sameOpen(await read())) throw new Error('Lifecycle changed after reopen compensation; reconciliation pending');
    warning('Observed reopen compensated from live metadata; independent policy/review validation still required');
  };
  const terminal = terminalLabelPlan(current);
  if (!terminal) return { bodyReconciled: false };
  let operationError;
  try {
    for (const name of terminal.remove) {
      if (!await write(async fresh => {
        if (names(fresh).includes(name)) {
          removedByUs.add(name); // The API may write remotely and then throw.
          if (!await remove(name)) removedByUs.delete(name);
        }
      })) return { bodyReconciled: false };
    }
    if (!await write(async () => {
      try { await github.rest.issues.getLabel({ owner, repo, name: terminal.add }); }
      catch (error) {
        if (error.status !== 404) throw error;
        try { await github.rest.issues.createLabel({ owner, repo, name: terminal.add, color: '006B75' }); }
        catch (createError) { if (createError.status !== 422) throw createError; await github.rest.issues.getLabel({ owner, repo, name: terminal.add }); }
      }
    })) return { bodyReconciled: false };
    if (!await write(async fresh => {
      if (!names(fresh).includes(terminal.add)) {
        addedByUs.add(terminal.add); // Record possible side effect before awaiting the API.
        await github.rest.issues.addLabels({ owner, repo, issue_number: current.number, labels: [terminal.add] });
      }
    })) return { bodyReconciled: false };
    await write(async fresh => {
      const plan = terminalBodyPlan(fresh);
      if (plan.errors.length) warning(`Closed PR #${current.number} body not rewritten: ${plan.errors.join('; ')}`);
      else if (plan.changed) {
        beforeBody = fresh.body; writtenBody = plan.body;
        await github.rest.pulls.update({ owner, repo, pull_number: current.number, body: plan.body });
        bodyReconciled = true;
      }
    });
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      const fresh = await read();
      if (touched && fresh.state === 'open') { await restoreOpen(fresh); bodyReconciled = false; }
      else if (!sameClose(fresh)) warning('Close generation changed; old reconciliation stopped without overwriting its successor');
    } catch (reconcileError) {
      if (operationError) throw new AggregateError([operationError, reconcileError], 'Terminal mutation failed; reopen compensation remains pending');
      throw reconcileError;
    }
  }
  return { bodyReconciled };
}
