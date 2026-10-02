import { createHash } from 'node:crypto';
import { ALLOWED, isPlaceholder, metadataLines, parseLaneMetadata, readField, rewriteField } from './agent-wip-policy.mjs';

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
      'candidate:active',
      ...(merged ? ['governance:lane-metadata-incomplete', 'governance:wip-violation'] : []),
      merged ? 'state:historical' : 'state:complete'],
  };
}


/** Reconcile the single current pr-lifecycle marker without touching prose/examples. */
function lifecycleStarts(source) {
  const starts = []; let offset = 0, fence = null, inComment = false; const chunks = source.split(/(\r\n|\n|\r)/);
  for (let i = 0; i < chunks.length; i += 2) {
    const raw = chunks[i], line = raw + (chunks[i + 1] ?? ''), indented = /^(?: {4}| {0,3}\t)/.test(raw);
    if (fence) { const close = raw.match(/^ {0,3}(`{3,}|~{3,})[ \t]*$/); if (close && close[1][0] === fence[0] && close[1].length >= fence.length) fence = null;
    } else { const open = !inComment && !indented && raw.match(/^ {0,3}(?:(?:[-+*]|\d+[.)])[ \t]+)?(`{3,}|~{3,})/);
      if (open) fence = open[1]; else for (let cursor = 0; cursor < raw.length;) {
        if (indented && !inComment) break; if (inComment) { const end = raw.indexOf('-->', cursor); if (end < 0) break; inComment = false; cursor = end + 3; continue; }
        const comment = raw.indexOf('<!--', cursor); if (comment < 0) break; if (/^[ \t]*(?:(?:[-+*]|\d+[.)])[ \t]+)?$/.test(raw.slice(cursor, comment)) && /^<!--[ \t]*pr-lifecycle\b/i.test(raw.slice(comment))) starts.push(offset + comment);
        inComment = true; cursor = comment + 4;
      }
    }
    offset += line.length;
  }
  return starts;
}
function rewriteLifecycleState(body, value) {
  const source = String(body ?? '');
  const starts = lifecycleStarts(source);
  if (!starts.length) return { body: source, changed: false, error: null, present: false };
  if (starts.length !== 1) return { body: source, changed: false, error: 'Ambiguous pr-lifecycle blocks; terminal body not rewritten', present: true };
  const endMarker = source.indexOf('-->', starts[0]);
  if (endMarker < 0) return { body: source, changed: false, error: 'Unclosed pr-lifecycle block; terminal body not rewritten', present: true };
  const block = source.slice(starts[0], endMarker + 3);
  const states = [...block.matchAll(/(^|\n)(\s*state\s*:\s*)([A-Z_]+)(?=\s*(?:\n|$))/gim)];
  if (states.length !== 1) return { body: source, changed: false, error: 'Missing or ambiguous pr-lifecycle state; terminal body not rewritten', present: true };

  const stateMatch = states[0];
  if (upper(stateMatch[3]) === value) return { body: source, changed: false, error: null, present: true };
  const start = starts[0] + (stateMatch.index ?? 0) + stateMatch[1].length + stateMatch[2].length;
  const end = start + stateMatch[3].length;
  return { body: source.slice(0, start) + value + source.slice(end), changed: true, error: null, present: true };
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
  const unsyncedFields = new Set();
  const lifecycle = rewriteLifecycleState(body, lifecycleState);
  const visible = metadataLines(body, { allowPartial: true });
  const hasContract = lifecycle.present || visible.some(line => /^[ \t]*[-*]?[ \t]*(?:WORK_ORIGIN|WORKSTREAM|AGENT_LANE|LANE_STATE|ACTIVE_CANDIDATE|CLOSEABILITY_SCORE|SELECTION_REASON|REMAINING_AUTONOMOUS_STEPS|OWNER_OR_EXTERNAL_BLOCKER|CLOSURE_SWEEP_TARGET|TEST_LANE_REQUIRED|WHY_NOT_CLOSER_CANDIDATE|REQUESTED_MODEL \/ ACTUAL_MODEL|BPLUS_MODE|RUN_ID|RESERVE_BOUNDARY|SCORECARD_PATH|DELIVERY_UNIT_TYPE|COUNT_IN_DELIVERY_OUTCOME|RETROACTIVE_TRACKING_MIGRATION|USER_VISIBLE_OUTCOME|MERGE_STATUS|COMPLETION_CLAIM|MERGE_COMMIT_SHA|MAIN_HEAD_VERIFIED|MAIN_HEAD_SHA|MAIN_FILE_RE_READ|EXACT_HEAD_CI_STATUS|EXACT_HEAD_CI_RUN|LOCAL_JOB_RESULT|REMOTE_JOB_RESULT|VERIFIED_AT|ASTRA_RISK|FINAL_RISK_POLICY|TERRA_SLOT|PRIMARY_ISSUE|FILE_OWNERSHIP|TEST_PROFILE|TEST_ENV_ID|SCHEMA_DEPENDENCY)[ \t]*:/i.test(line));
  const hasReceipt = merged && hasContract;
  if (lifecycle.error) { errors.push(lifecycle.error); unsyncedFields.add('pr-lifecycle.state'); }
  else if (lifecycle.changed) { changedFields.push('pr-lifecycle.state'); unsyncedFields.add('pr-lifecycle.state'); }
  else if (hasContract && !lifecycle.present) {
    errors.push('Missing pr-lifecycle block'); unsyncedFields.add('pr-lifecycle.state');
  }
  body = lifecycle.body;

  for (const [field, value] of [['LANE_STATE', terminalState], ['ACTIVE_CANDIDATE', 'false']]) {
    if (!hasContract) continue;
    const current = readField(body, field);
    if (!current) { if (hasContract) { errors.push(`Missing ${field} declaration`); unsyncedFields.add(field); } continue; }
    const rewritten = rewriteField(body, field, value);
    if (rewritten.error) {
      errors.push(rewritten.error);
      unsyncedFields.add(field);
      continue;
    }
    if (rewritten.changed) { changedFields.push(field); unsyncedFields.add(field); }
    body = rewritten.body;
  }
  // Human closeout only: do not infer merge receipts, Product acceptance, or cleared external blockers.
  for (const [field, stale] of [
    ['MERGE_STATUS', value => value !== (merged ? 'VERIFIED_MERGED' : 'VERIFIED_NOT_MERGED')],
    ['COMPLETION_CLAIM', value => value !== (merged ? 'VERIFIED_MERGED' : 'VERIFIED_CLOSED')],
    ['OWNER_OR_EXTERNAL_BLOCKER', value => value !== 'NONE'],
    ['REMAINING_AUTONOMOUS_STEPS', value => value !== 'NONE'],
    ['MERGE_COMMIT_SHA', value => merged ? !/^[a-f0-9]{40}$/i.test(value) || Boolean(pr.merge_commit_sha && upper(value) !== upper(pr.merge_commit_sha)) : value !== 'NONE'],
    ['MAIN_HEAD_VERIFIED', value => merged && value !== 'TRUE'],
    ['MAIN_HEAD_SHA', value => merged && !/^[a-f0-9]{40}$/i.test(value)],
    ['MAIN_FILE_RE_READ', value => merged && (value === 'NONE' || isPlaceholder(value))],
    ['VERIFIED_AT', value => !Number.isFinite(Date.parse(value)) || Date.parse(value) > Date.now() + 300_000 || Boolean(pr.closed_at && Date.parse(value) < Date.parse(pr.closed_at))],
    ['EXACT_HEAD_CI_STATUS', value => merged && value !== 'VERIFIED_GREEN'],
    ['EXACT_HEAD_CI_RUN', value => merged && (value === 'NONE' || isPlaceholder(value))],
    ['LOCAL_JOB_RESULT', value => merged && !['VERIFIED_GREEN', 'SKIPPED'].includes(value)],
    ['REMOTE_JOB_RESULT', value => merged && !['VERIFIED_GREEN', 'SKIPPED'].includes(value)],
  ]) {
    if (!hasContract) continue;
    if (!visible.some(line => new RegExp(`^[ \\t]*[-*]?[ \\t]*${field}[ \\t]*:`, 'i').test(line))) { if (hasReceipt || (hasContract && ['MERGE_STATUS', 'COMPLETION_CLAIM'].includes(field))) unsyncedFields.add(field); continue; }
    const value = readField(visible.join('\n'), field);
    if (!value || value.includes('|') || stale(upper(value))) unsyncedFields.add(field);
  }
  return {
    body,
    changed: body !== String(pr.body ?? ''),
    changedFields,
    unsyncedFields: [...unsyncedFields],
    terminalState, hasContract,
    errors: [...new Set(errors)],
  };
}
/** The independent terminal writer uses bounded label reconciliation; REST is not atomic.
 * GitHub has no conditional PR-body PATCH, so lifecycle body fields require a separate
 * human-controlled closeout write. This writer never risks replacing concurrent prose.
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
  let touched = false;
  const removedByUs = new Set(), addedByUs = new Set();
  const write = async operation => {
    const fresh = await read();
    if (!sameClose(fresh)) return false;
    touched = true; // An API error may occur after the remote side effect; finally still checks truth.
    await operation(fresh);
    return true;
  };
  const recordPending = async (observed, reason) => {
    let handoffError;
    try {
    if (observed.state !== 'closed') return;
    const plan = terminalBodyPlan(observed);
    let liveFailure = '';
    if ((observed.merged || observed.merged_at) && plan.hasContract && !plan.changed && !plan.errors.length && !plan.unsyncedFields.length && !reason) try {
      const branch = observed.base?.ref, merge = observed.merge_commit_sha;
      const declared = readField(observed.body, 'MAIN_HEAD_SHA');
      const path = readField(observed.body, 'MAIN_FILE_RE_READ'), runId = readField(observed.body, 'EXACT_HEAD_CI_RUN').match(/(?:^|\/runs\/)(\d+)$/)?.[1];
      if (branch !== 'main' || !merge || !/^[a-f0-9]{40}$/i.test(declared) || !path || isPlaceholder(path) || !runId ||
          ['MERGE_COMMIT_SHA', 'MAIN_HEAD_VERIFIED', 'VERIFIED_AT', 'EXACT_HEAD_CI_STATUS', 'LOCAL_JOB_RESULT', 'REMOTE_JOB_RESULT'].some(field => !readField(observed.body, field))) throw Error('incomplete merged receipt');
      const main = (await github.rest.repos.getBranch({ owner, repo, branch })).data.commit.sha;
      const reaches = async (base, head) => base === head || ['ahead', 'identical'].includes((await github.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${base}...${head}` })).data.status);
      if (upper(declared) !== upper(main) || !await reaches(merge, main)) throw Error('declared main SHA does not match live main or merge is unreachable');
      const changed = await github.paginate(github.rest.pulls.listFiles, { owner, repo, pull_number: observed.number, per_page: 100 }); if (!Array.isArray(changed) || !Number.isSafeInteger(observed.changed_files) || changed.length !== observed.changed_files || !changed.some(file => file.filename === path && file.status !== 'removed')) throw Error('main re-read path is not a changed PR file');
      if ((await github.rest.repos.getContent({ owner, repo, path, ref: main })).data?.type !== 'file') throw Error('main file re-read failed');
      const inventory = (await github.rest.actions.listWorkflowRuns({ owner, repo, workflow_id: 'ci.yml', head_sha: observed.head.sha, event: 'pull_request', per_page: 100 })).data;
      if (!Array.isArray(inventory.workflow_runs) || inventory.total_count > inventory.workflow_runs.length) throw Error('exact-head CI inventory incomplete');
      const latest = inventory.workflow_runs.filter(item => item.head_sha === observed.head.sha && item.path === '.github/workflows/ci.yml' && item.event === 'pull_request' && !(item.pull_requests?.length === 1 && Number.isSafeInteger(item.pull_requests[0]?.number) && item.pull_requests[0].number !== observed.number)).sort((a, b) => b.id - a.id)[0];
      if (!latest || latest.id !== Number(runId)) throw Error('receipt does not name latest exact-head CI run');
      const run = (await github.rest.actions.getWorkflowRun({ owner, repo, run_id: Number(runId) })).data;
      if (run.head_sha !== observed.head?.sha || run.status !== 'completed' || run.conclusion !== 'success' || run.event !== 'pull_request' || run.path !== '.github/workflows/ci.yml' || run.pull_requests?.length !== 1 || run.pull_requests[0]?.number !== observed.number) throw Error('exact-head CI run is not verified for this PR');
      if (upper(readField(observed.body, 'LOCAL_JOB_RESULT')) === 'VERIFIED_GREEN') throw Error('local isolated integration/E2E evidence not verified');
      if (upper(readField(observed.body, 'REMOTE_JOB_RESULT')) === 'VERIFIED_GREEN') {
        const jobs = (await github.rest.actions.listJobsForWorkflowRun({ owner, repo, run_id: Number(runId), filter: 'latest', per_page: 100 })).data;
        const remote = jobs.jobs?.filter(job => job.name === 'integration');
        if (!Array.isArray(jobs.jobs) || jobs.total_count !== jobs.jobs.length || remote?.length !== 1 || remote[0].status !== 'completed' || remote[0].conclusion !== 'success' || !['Run integration tests', 'Run E2E tests'].every(name => remote[0].steps?.filter(step => step.name === name && step.conclusion === 'success').length === 1)) throw Error('remote integration/E2E steps not verified');
      }
    } catch (error) { liveFailure = `LIVE_MAIN_RECEIPT_UNVERIFIED:${error.status ?? error.message ?? 'unknown'}`; }
    const pending = Boolean(plan.changed || plan.errors.length || plan.unsyncedFields.length || reason || liveFailure);
    const fields = plan.unsyncedFields.join(', ') || (liveFailure ? 'none (live receipt verification pending)' : 'none (label reconciliation only)');
    const failure = reason || plan.errors.join('; ') || liveFailure || (pending ? 'UNSAFE_NON_CONDITIONAL_BODY_PATCH' : 'none');
    const status = pending ? 'STATE_SYNC_PENDING' : 'STATE_SYNC_RESOLVED';
    const prefix = `<!-- agent-terminal-state-sync:v1 pr=${current.number} head=${observed.head?.sha} closed_at=${observed.closed_at}`;
    const marker = `${prefix} digest=${createHash('sha256').update(JSON.stringify([status, fields, failure])).digest('hex').slice(0, 16)} -->`;
    if (pending) warning(`${status} PR #${current.number}; closed_at=${observed.closed_at}; unsynced fields: ${fields}; reason=${failure}`);
    const comments = await github.paginate(github.rest.issues.listComments,
      { owner, repo, issue_number: current.number, per_page: 100 });
    if (!Array.isArray(comments)) throw new Error('STATE_SYNC_PENDING comment inventory unavailable');
    const trusted = comments.filter(comment => comment.user?.login === 'github-actions[bot]' && comment.user?.id === 41898282 && String(comment.body ?? '').startsWith(`<!-- agent-terminal-state-sync:v1 pr=${current.number} `)), prior = trusted.filter(comment => String(comment.body ?? '').startsWith(prefix));
    const unresolvedPrior = String(trusted.at(-1)?.body ?? '').split('\n')[1] === 'STATE_SYNC_PENDING';
    const sameObserved = pr => pr.state === 'closed' && pr.head?.sha === observed.head?.sha && pr.closed_at === observed.closed_at && Boolean(pr.merged || pr.merged_at) === Boolean(observed.merged || observed.merged_at) && pr.body === observed.body;
    const before = await read(); if (!sameObserved(before)) return;
    if (!pending && !prior.length && !unresolvedPrior || (String(prior.at(-1)?.body ?? '').startsWith(marker) && String(prior.at(-1)?.body ?? '').split('\n')[1] === status)) return;
    const priorIds = new Set(comments.map(comment => comment.id));
    let created;
    try { created = await github.rest.issues.createComment({ owner, repo, issue_number: current.number, body: `${marker}\n${status}\n` +
      `PR: #${current.number}\nVERIFIED_TERMINAL_STATE: ${observed.merged || observed.merged_at ? 'MERGED' : 'CLOSED_UNMERGED'}\n` +
      `HEAD: ${observed.head?.sha}\nCLOSED_AT: ${observed.closed_at}\n` +
      `UNSYNCED_FIELDS: ${fields}\nFAILED_ACTION_OR_ERROR: ${failure}\n` +
      `OWNING_SESSION: PR #${current.number} closeout owner\n` +
      (pending ? 'NEXT_SAFE_WRITE_PATH: Owning session must coordinate an exclusive body edit, re-read live PR, sync terminal fields, and verify the live result before POST_MERGE_CLOSEOUT=COMPLETE.' : 'NEXT_SAFE_WRITE_PATH: Body fields are synchronized for this observed close generation; verify Issue closeout and remaining gates separately.') +
      ' This comment does not grant Product or Production acceptance.\n' }); }
    catch (error) {
      if (!sameObserved(await read())) try {
        const afterComments = await github.paginate(github.rest.issues.listComments, { owner, repo, issue_number: current.number, per_page: 100 });
        for (const comment of afterComments.filter(item => item.id && !priorIds.has(item.id) && item.user?.login === 'github-actions[bot]' && item.user?.id === 41898282 && String(item.body ?? '').startsWith(marker)))
          await github.rest.issues.updateComment({ owner, repo, comment_id: comment.id, body: `${marker}\nSTATE_SYNC_SUPERSEDED\nREASON: comment write was uncertain and PR reopened; recheck live PR.\n` });
      } catch (inventoryError) { throw new AggregateError([error, inventoryError], 'Comment write uncertain; stale handoff could not be checked'); }
      throw error;
    }
    const after = await read();
    if (!sameObserved(after)) await github.rest.issues.updateComment({ owner, repo, comment_id: created.data.id,
      body: `${marker}\nSTATE_SYNC_SUPERSEDED\nREASON: close generation or body changed after comment creation; recheck live PR before closeout.\n` });
    } catch (error) { handoffError = error; throw error; }
    finally { try { const fresh = await read(); if (touched && fresh.state === 'open') await restoreOpen(fresh); }
      catch (error) { if (handoffError) throw new AggregateError([handoffError, error], 'Terminal handoff and reopen compensation failed'); throw error; } }
  };
  const restoreOpen = async observed => {
    const sameOpen = pr => pr.state === 'open' && pr.head?.sha === observed.head?.sha && pr.body === observed.body;
    const openWrite = async operation => {
      const fresh = await read();
      if (!sameOpen(fresh)) throw new Error('Lifecycle or metadata changed during reopen compensation; reconciliation pending');
      await operation(fresh);
    };
    const metadata = parseLaneMetadata(observed);
    const states = { ACTIVE: 'state:active', READY_FOR_PROMOTION: 'state:reserve-ready',
      PARKED: 'state:parked', OWNER_BLOCKED: 'state:owner-blocked', COMPLETE: 'state:complete', HISTORICAL: 'state:historical' };
    if (!['AGENT', 'OWNER'].includes(metadata.origin) || !ALLOWED.state.has(metadata.state) ||
        !ALLOWED.lane.has(metadata.lane) || !ALLOWED.boolean.has(metadata.activeCandidate)) {
      // Invalid metadata: undo only our attempted writes, including uncertain API effects; preserve newer state labels.
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
  } catch (error) {
    operationError = error;
    throw error;
  } finally {
    try {
      const fresh = await read();
      if (touched && fresh.state === 'open') await restoreOpen(fresh);
      else {
        if (!sameClose(fresh)) warning('Close generation changed; old reconciliation stopped without overwriting its successor');
        await recordPending(fresh, !sameClose(fresh) ? 'CLOSE_GENERATION_CHANGED_BEFORE_COMPLETION' :
          operationError ? `TERMINAL_LABEL_RECONCILIATION_ERROR:${operationError.status ?? operationError.name}` : '');
      }
    } catch (reconcileError) {
      if (operationError) throw new AggregateError([operationError, reconcileError], 'Terminal mutation failed; reopen compensation remains pending');
      throw reconcileError;
    }
  }
  return { bodyReconciled: false };
}
