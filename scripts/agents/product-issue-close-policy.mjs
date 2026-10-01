#!/usr/bin/env node

import { issueWorkstream } from './issue-provenance-policy.mjs';
import { readLifecycleIssue } from './agent-wip-policy.mjs';

const SHA40 = /^[0-9a-f]{40}$/;
const RUN_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$/;
const SIX_HOURS_MS = 6 * 60 * 60 * 1000;
const CLOSE_READY_EVENT = 'ISSUE_CLOSE_READY';
const CLOSED_EVENT = 'ISSUE_CLOSED_OBSERVED';
const CAPTURE_MARKER = '<!-- product-issue-close-guard-capture -->';

function readField(body = '', name = '') {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return String(body).match(new RegExp(`^[ \\t]*${escaped}[ \\t]*:[ \\t]*(.+)$`, 'mi'))?.[1]?.trim() ?? '';
}

export function parseRunCaptureHandoff(body = '') {
  const text = String(body ?? '');
  if (!text.includes('RUN_CAPTURE_HANDOFF')) return null;
  return {
    runId: readField(text, 'RUN_ID'),
    event: readField(text, 'EVENT').toUpperCase(),
    evidenceRef: readField(text, 'EVIDENCE_REF'),
    observedAt: readField(text, 'OBSERVED_AT'),
    writerBlocker: readField(text, 'WRITER_BLOCKER'),
    nextSafeWritePath: readField(text, 'NEXT_SAFE_WRITE_PATH'),
  };
}

function validIso(value) {
  const stamp = Date.parse(String(value ?? ''));
  return Number.isFinite(stamp) ? stamp : null;
}

export function findCloseReadyHandoff(comments = [], closedAt = '') {
  const closedMs = validIso(closedAt);
  if (closedMs === null) return { handoff: null, errors: ['ISSUE_CLOSE_READY requires a valid issue closed_at timestamp'] };

  const parsed = comments
    .map((comment) => ({ comment, handoff: parseRunCaptureHandoff(comment?.body ?? '') }))
    .filter((entry) => entry.handoff?.event === CLOSE_READY_EVENT && entry.comment?.trusted === true)
    .sort((a, b) => (validIso(b.comment?.created_at) ?? -Infinity) - (validIso(a.comment?.created_at) ?? -Infinity));

  if (!parsed.length) {
    return { handoff: null, errors: ['missing trusted RUN_CAPTURE_HANDOFF with EVENT: ISSUE_CLOSE_READY before Product Issue close'] };
  }

  const selected = parsed[0];
  const latest = selected.handoff;
  const errors = [];
  const commentMs = validIso(selected.comment?.created_at);
  if (commentMs === null) {
    errors.push('ISSUE_CLOSE_READY requires the trusted GitHub comment created_at timestamp');
  } else {
    if (commentMs > closedMs) errors.push('ISSUE_CLOSE_READY trusted comment must be created before the Issue close event');
    if (closedMs - commentMs > SIX_HOURS_MS) errors.push('ISSUE_CLOSE_READY trusted comment is stale (>6h before Issue close)');
  }
  if (!RUN_ID.test(latest.runId) || /^(?:none|unknown|null|undefined)$/i.test(latest.runId)) {
    errors.push('ISSUE_CLOSE_READY handoff requires a concrete RUN_ID');
  }
  const observedMs = validIso(latest.observedAt);
  if (observedMs === null) {
    errors.push('ISSUE_CLOSE_READY handoff requires a valid OBSERVED_AT timestamp');
  } else {
    if (observedMs > closedMs) errors.push('ISSUE_CLOSE_READY OBSERVED_AT must precede the Issue close event');
    if (commentMs !== null && observedMs > commentMs + 60_000) {
      errors.push('ISSUE_CLOSE_READY OBSERVED_AT cannot be later than its trusted GitHub comment');
    }
  }
  if (!/^github:workflow#\d+$/.test(latest.evidenceRef)) {
    errors.push('ISSUE_CLOSE_READY EVIDENCE_REF must be github:workflow#<main-ci-run-id>');
  }
  if (!latest.writerBlocker) errors.push('ISSUE_CLOSE_READY handoff requires WRITER_BLOCKER');
  if (!latest.nextSafeWritePath) errors.push('ISSUE_CLOSE_READY handoff requires NEXT_SAFE_WRITE_PATH');
  return { handoff: latest, commentCreatedAt: selected.comment?.created_at ?? null, errors };
}

export function linkedOpenProductPulls(issueNumber, pulls = []) {
  const issue = Number(issueNumber);
  return pulls.filter((pull) => pull?.state === 'open' && readLifecycleIssue(pull?.body ?? '') === issue);
}

function labelNames(issue) {
  return (issue?.labels ?? [])
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter(Boolean);
}

function productApplicability(issue) {
  const declared = issueWorkstream(issue?.body ?? '');
  const labels = new Set(labelNames(issue));
  if (declared === 'AMBIGUOUS_WORKSTREAM') {
    return { applicable: true, workstream: declared, errors: ['Issue WORKSTREAM is ambiguous at close time'] };
  }
  if (declared === 'PRODUCT_MAINLINE' || labels.has('workstream:product-mainline')) {
    return { applicable: true, workstream: 'PRODUCT_MAINLINE', errors: [] };
  }
  return { applicable: false, workstream: declared || 'UNCLASSIFIED', errors: [] };
}

export function evaluateProductIssueClose({
  issue,
  currentMainSha,
  openPullRequests = [],
  comments = [],
  verifiedCi = null,
  verifiedRun = null,
  lastClosedCaptureAt = null,
} = {}) {
  const applicability = productApplicability(issue);
  if (!applicability.applicable) {
    return { applicable: false, allowed: true, workstream: applicability.workstream, errors: [], runId: null };
  }

  const errors = [...applicability.errors];
  const issueNumber = Number(issue?.number ?? issue?.issue_number);
  if (!Number.isInteger(issueNumber) || issueNumber < 1) errors.push('Product Issue close requires a concrete Issue number');
  if (issue?.state !== 'closed') errors.push('Product Issue close gate only evaluates a live closed Issue snapshot');
  if (!SHA40.test(String(currentMainSha ?? ''))) errors.push('Product Issue close requires exact current main SHA');

  const ready = findCloseReadyHandoff(comments, issue?.closed_at ?? '');
  errors.push(...ready.errors);

  const linkedOpen = linkedOpenProductPulls(issueNumber, openPullRequests);
  if (linkedOpen.length) {
    errors.push(`Product Issue #${issueNumber} still has open linked PR(s): ${linkedOpen.map((pull) => `#${pull.number}`).join(', ')}`);
  }

  if (ready.handoff) {
    const lastCaptureMs = validIso(lastClosedCaptureAt);
    const readyCommentMs = validIso(ready.commentCreatedAt);
    if (lastCaptureMs !== null && readyCommentMs !== null && readyCommentMs <= lastCaptureMs) {
      errors.push('ISSUE_CLOSE_READY handoff was already consumed by an earlier successful close; publish a fresh close-ready handoff');
    }

    if (!verifiedRun || typeof verifiedRun !== 'object') {
      errors.push('ISSUE_CLOSE_READY RUN_ID was not verified against current-main Product Run ledger');
    } else {
      if (verifiedRun.runId !== ready.handoff.runId) errors.push('ISSUE_CLOSE_READY RUN_ID differs from verified Product Run ledger');
      if (verifiedRun.schemaVersion !== 2 || verifiedRun.deliveryTruthVersion !== 4) {
        errors.push('ISSUE_CLOSE_READY requires a schema v2 / DeliveryTruth v4 Product Run');
      }
      if (!['IN_PROGRESS', 'CLOSURE_RECOVERY'].includes(verifiedRun.status)) {
        errors.push('ISSUE_CLOSE_READY requires an active Product Run before Issue close');
      }
      if (verifiedRun.closeout?.state !== 'OPEN' || !['PRODUCT_MAIN_SESSION', 'OWNER'].includes(verifiedRun.closeout?.ownerRole)) {
        errors.push('ISSUE_CLOSE_READY requires an OPEN Product-owned closeout envelope');
      }
      if (!Array.isArray(verifiedRun.sources) || !verifiedRun.sources.some((source) => source?.ref === `issue/${issueNumber}`)) {
        errors.push(`ISSUE_CLOSE_READY Product Run sources must include issue/${issueNumber}`);
      }
    }

    const workflowId = Number(ready.handoff.evidenceRef.match(/^github:workflow#(\d+)$/)?.[1] ?? 0);
    if (!verifiedCi || verifiedCi.workflowId !== workflowId) {
      errors.push('ISSUE_CLOSE_READY workflow evidence was not independently verified');
    } else {
      if (verifiedCi.name !== 'ci') errors.push('ISSUE_CLOSE_READY evidence must reference canonical ci workflow');
      if (verifiedCi.event !== 'push') errors.push('ISSUE_CLOSE_READY ci evidence must be a push run');
      if (verifiedCi.conclusion !== 'success') errors.push('ISSUE_CLOSE_READY ci evidence must conclude success');
      if (!SHA40.test(String(verifiedCi.headSha ?? ''))) errors.push('ISSUE_CLOSE_READY ci evidence requires exact head SHA');
      if (verifiedCi.reachableFromCurrentMain !== true) errors.push('ISSUE_CLOSE_READY ci head is not reachable from current main');
    }
  }

  return {
    applicable: true,
    allowed: errors.length === 0,
    workstream: applicability.workstream,
    errors: [...new Set(errors)],
    runId: ready.handoff?.runId ?? null,
    readyHandoff: ready.handoff,
  };
}

export function renderIssueClosedCaptureHandoff({ issueNumber, runId, observedAt } = {}) {
  if (!Number.isInteger(Number(issueNumber)) || !RUN_ID.test(String(runId ?? '')) || validIso(observedAt) === null) {
    throw new Error('issueNumber, concrete runId and observedAt are required');
  }
  return `${CAPTURE_MARKER}
RUN_CAPTURE_HANDOFF
RUN_ID: ${runId}
EVENT: ${CLOSED_EVENT}
EVIDENCE_REF: github:issue#${Number(issueNumber)}
OBSERVED_AT: ${observedAt}
WRITER_BLOCKER: trusted Issue-close workflow cannot rewrite the protected Product Run ledger in-place
NEXT_SAFE_WRITE_PATH: reconcile the owning Run with ISSUE_CLOSED + delivery.issuesClosed, rerun readiness, then complete POST_MERGE_CLOSEOUT
`;
}

export const PRODUCT_ISSUE_CLOSE_CAPTURE_MARKER = CAPTURE_MARKER;
export const PRODUCT_ISSUE_CLOSE_READY_EVENT = CLOSE_READY_EVENT;
