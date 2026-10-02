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
    closeApprovedRef: readField(text, 'CLOSE_APPROVED_REF'),
    reviewedHead: readField(text, 'REVIEWED_HEAD'),
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
  const updatedMs = validIso(selected.comment?.updated_at ?? selected.comment?.created_at);
  if (commentMs === null || updatedMs === null) {
    errors.push('ISSUE_CLOSE_READY requires trusted GitHub comment created_at/updated_at timestamps');
  } else {
    if (commentMs > closedMs) errors.push('ISSUE_CLOSE_READY trusted comment must be created before the Issue close event');
    if (updatedMs > closedMs) errors.push('ISSUE_CLOSE_READY trusted comment must not be edited after the Issue close event');
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
  if (!/^github:issuecomment#\d+$/.test(latest.closeApprovedRef)) {
    errors.push('ISSUE_CLOSE_READY handoff requires CLOSE_APPROVED_REF: github:issuecomment#<id>');
  }
  if (!SHA40.test(latest.reviewedHead)) errors.push('ISSUE_CLOSE_READY handoff requires REVIEWED_HEAD: <40-char sha>');
  return { handoff: latest, commentCreatedAt: selected.comment?.created_at ?? null, errors };
}

export function linkedOpenProductPulls(issueNumber, pulls = []) {
  const issue = Number(issueNumber);
  return pulls.filter((pull) => pull?.state === 'open' && readLifecycleIssue(pull?.body ?? '') === issue);
}

export function latestMergedProductPull(issueNumber, pulls = []) {
  const issue = Number(issueNumber);
  return pulls
    .filter((pull) =>
      pull?.merged_at &&
      readLifecycleIssue(pull?.body ?? '') === issue &&
      readField(pull?.body ?? '', 'WORKSTREAM').toUpperCase() === 'PRODUCT_MAINLINE' &&
      /^[0-9a-f]{40}$/.test(String(pull?.head?.sha ?? pull?.head_sha ?? '')))
    .sort((a, b) => String(b.merged_at).localeCompare(String(a.merged_at)))[0] ?? null;
}

function labelNames(issue) {
  return (issue?.labels ?? [])
    .map((label) => typeof label === 'string' ? label : label?.name)
    .filter(Boolean);
}

function productApplicability(issue) {
  const declared = issueWorkstream(issue?.body ?? '');
  const labels = new Set(labelNames(issue));
  const productLabel = labels.has('workstream:product-mainline');
  const governanceLabel = labels.has('workstream:model-governance');

  if (declared === 'MODEL_GOVERNANCE' && governanceLabel && !productLabel) {
    return { applicable: false, workstream: 'MODEL_GOVERNANCE', errors: [] };
  }
  if (declared === 'PRODUCT_MAINLINE' || productLabel) {
    const errors = [];
    if (declared !== 'PRODUCT_MAINLINE') errors.push('Product Issue close requires a valid WORKSTREAM: PRODUCT_MAINLINE declaration');
    if (!productLabel) errors.push('Product Issue close requires workstream:product-mainline label');
    if (governanceLabel) errors.push('Product Issue close has conflicting workstream:model-governance label');
    return { applicable: true, workstream: 'PRODUCT_MAINLINE', errors };
  }
  if (declared === 'MODEL_GOVERNANCE') {
    return { applicable: true, workstream: declared, errors: ['MODEL_GOVERNANCE close bypass requires matching workstream:model-governance label and no Product label'] };
  }
  return {
    applicable: true,
    workstream: declared || 'UNCLASSIFIED',
    errors: ['Issue WORKSTREAM classification is missing, ambiguous, or invalid at close time'],
  };
}

/**
 * @param {{
 *   issue?: any,
 *   currentMainSha?: string,
 *   openPullRequests?: any[],
 *   mergedPullRequests?: any[],
 *   comments?: any[],
 *   verifiedCi?: any | null,
 *   verifiedRun?: any | null,
 *   verifiedCloseApproval?: any | null,
 *   lastClosedCaptureAt?: string | null,
 * }} [input]
 */
export function evaluateProductIssueClose({
  issue,
  currentMainSha,
  openPullRequests = [],
  mergedPullRequests = [],
  comments = [],
  verifiedCi = null,
  verifiedRun = null,
  verifiedCloseApproval = null,
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

    const approvalCommentId = Number(ready.handoff.closeApprovedRef.match(/^github:issuecomment#(\d+)$/)?.[1] ?? 0);
    if (!verifiedCloseApproval || verifiedCloseApproval.commentId !== approvalCommentId) {
      errors.push('ISSUE_CLOSE_READY CLOSE_APPROVED_REF was not independently verified');
    } else {
      if (verifiedCloseApproval.verdict !== 'CLOSE_APPROVED') errors.push('Product Issue close requires final Sol CLOSE_APPROVED');
      if (verifiedCloseApproval.role !== 'SOL') errors.push('Product Issue close approval must declare REVIEW_ROLE: SOL');
      if (verifiedCloseApproval.runId !== ready.handoff.runId) errors.push('final Sol CLOSE_APPROVED RUN_ID must match ISSUE_CLOSE_READY RUN_ID');
      if (!SHA40.test(String(verifiedCloseApproval.exactHead ?? ''))) errors.push('final Sol CLOSE_APPROVED requires EXACT_HEAD');
      if (verifiedCloseApproval.exactHead !== ready.handoff.reviewedHead) errors.push('final Sol CLOSE_APPROVED EXACT_HEAD must match ISSUE_CLOSE_READY REVIEWED_HEAD');
      const latestMerged = latestMergedProductPull(issueNumber, mergedPullRequests);
      if (latestMerged && verifiedCloseApproval.exactHead !== (latestMerged.head?.sha ?? latestMerged.head_sha)) {
        errors.push(`final Sol CLOSE_APPROVED EXACT_HEAD must match latest merged Product PR #${latestMerged.number} head`);
      }
      if (verifiedCloseApproval.reachableFromCurrentMain !== true) errors.push('final Sol CLOSE_APPROVED exact head is not reachable from current main');
      if (verifiedCloseApproval.trusted !== true) errors.push('final Sol CLOSE_APPROVED submitter is not trusted');
      if (verifiedCloseApproval.sameIssue !== true) errors.push('final Sol CLOSE_APPROVED comment must belong to the closing Issue');
      if (verifiedCloseApproval.beforeClose !== true) errors.push('final Sol CLOSE_APPROVED must exist before Issue close');
      if (verifiedCloseApproval.afterLastClose !== true) errors.push('final Sol CLOSE_APPROVED must belong to the current close generation');
    }

    const workflowId = Number(ready.handoff.evidenceRef.match(/^github:workflow#(\d+)$/)?.[1] ?? 0);
    if (!verifiedCi || verifiedCi.workflowId !== workflowId) {
      errors.push('ISSUE_CLOSE_READY workflow evidence was not independently verified');
    } else {
      if (verifiedCi.name !== 'ci') errors.push('ISSUE_CLOSE_READY evidence must reference canonical ci workflow');
      if (verifiedCi.workflowPath !== '.github/workflows/ci.yml') errors.push('ISSUE_CLOSE_READY evidence must use .github/workflows/ci.yml');
      if (verifiedCi.event !== 'push') errors.push('ISSUE_CLOSE_READY ci evidence must be a push run');
      if (verifiedCi.conclusion !== 'success') errors.push('ISSUE_CLOSE_READY ci evidence must conclude success');
      if (!SHA40.test(String(verifiedCi.headSha ?? ''))) errors.push('ISSUE_CLOSE_READY ci evidence requires exact head SHA');
      if (verifiedCi.headSha !== currentMainSha) errors.push('ISSUE_CLOSE_READY ci evidence must match current main exact head');
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
