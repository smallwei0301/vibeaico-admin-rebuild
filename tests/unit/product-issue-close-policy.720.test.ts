import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { classifyWorkstream } from '../../scripts/agents/astra-review-policy.mjs';
import {
  evaluateProductIssueClose,
  findCloseReadyHandoff,
  parseRunCaptureHandoff,
  renderIssueClosedCaptureHandoff,
} from '../../scripts/agents/product-issue-close-policy.mjs';

const main = 'a'.repeat(40);
const closeAt = '2026-10-01T01:00:00Z';

function issue(overrides: Record<string, unknown> = {}) {
  return {
    number: 704,
    state: 'closed',
    closed_at: closeAt,
    body: 'WORKSTREAM: PRODUCT_MAINLINE',
    labels: [{ name: 'workstream:product-mainline' }],
    ...overrides,
  } as any;
}

function readyComment(overrides: Record<string, string> = {}) {
  const v = {
    runId: '2026-10-01-product-r01',
    evidenceRef: 'github:workflow#12345',
    observedAt: '2026-10-01T00:45:00Z',
    closeApprovedRef: 'github:issuecomment#9001',
    reviewedHead: 'b'.repeat(40),
    ...overrides,
  };
  return {
    created_at: '2026-10-01T00:46:00Z',
    updated_at: '2026-10-01T00:46:00Z',
    trusted: true,
    body: [
      'RUN_CAPTURE_HANDOFF',
      `RUN_ID: ${v.runId}`,
      'EVENT: ISSUE_CLOSE_READY',
      `EVIDENCE_REF: ${v.evidenceRef}`,
      `CLOSE_APPROVED_REF: ${v.closeApprovedRef}`,
      `REVIEWED_HEAD: ${v.reviewedHead}`,
      `OBSERVED_AT: ${v.observedAt}`,
      'WRITER_BLOCKER: ledger on protected main',
      'NEXT_SAFE_WRITE_PATH: capture ISSUE_CLOSED after trusted close',
    ].join('\n'),
  };
}

const verifiedCi = {
  workflowId: 12345,
  name: 'ci',
  workflowPath: '.github/workflows/ci.yml',
  event: 'push',
  conclusion: 'success',
  headSha: main,
};

const verifiedRun = {
  schemaVersion: 2,
  deliveryTruthVersion: 4,
  runId: '2026-10-01-product-r01',
  status: 'IN_PROGRESS',
  sources: [{ ref: 'origin/main' }, { ref: 'issue/704' }],
  closeout: { state: 'OPEN', ownerRole: 'PRODUCT_MAIN_SESSION' },
};

const verifiedCloseApproval = {
  commentId: 9001,
  role: 'SOL',
  verdict: 'CLOSE_APPROVED',
  runId: '2026-10-01-product-r01',
  exactHead: 'b'.repeat(40),
  reachableFromCurrentMain: true,
  trusted: true,
  beforeClose: true,
  afterLastClose: true,
};

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateProductIssueClose({
    issue: issue(),
    currentMainSha: main,
    openPullRequests: [],
    mergedPullRequests: [{
      number: 705,
      state: 'closed',
      merged_at: '2026-10-01T00:40:00Z',
      head: { sha: 'b'.repeat(40) },
      body: '<!-- pr-lifecycle\nissue: 704\nstate: MERGED\n-->\nWORKSTREAM: PRODUCT_MAINLINE',
    }],
    comments: [readyComment()],
    verifiedCi,
    verifiedRun,
    verifiedCloseApproval,
    ...overrides,
  });
}

describe('#720 executable Product Issue close gate', () => {
  it('bypasses only explicit consistent MODEL_GOVERNANCE and fails closed otherwise', () => {
    const governance = evaluateProductIssueClose({
      issue: issue({ body: 'WORKSTREAM: MODEL_GOVERNANCE', labels: [{ name: 'workstream:model-governance' }] }),
      currentMainSha: main,
    });
    expect(governance.applicable).toBe(false);

    for (const bad of [
      issue({ body: 'no workstream', labels: [] }),
      issue({ body: 'WORKSTREAM: MODEL_GOVERNANCE', labels: [] }),
      issue({ body: 'WORKSTREAM: PRODUCT_MAINLINE', labels: [{ name: 'workstream:model-governance' }] }),
    ]) {
      const result = evaluateProductIssueClose({ issue: bad, currentMainSha: main });
      expect(result.applicable).toBe(true);
      expect(result.allowed).toBe(false);
    }
  });

  it('rejects #704-shaped premature close and open linked PR', () => {
    const missing = evaluateProductIssueClose({
      issue: issue(), currentMainSha: main, openPullRequests: [], comments: [], verifiedCi,
    });
    expect(missing.errors.join('\n')).toContain('ISSUE_CLOSE_READY');

    const linked = evaluate({
      openPullRequests: [{
        number: 706,
        state: 'open',
        body: '<!-- pr-lifecycle\nissue: 704\nstate: ACTIVE\n-->',
      }],
    });
    expect(linked.errors.join('\n')).toContain('#706');
  });

  it('rejects stale, untrusted, late, edited or reused close-ready handoffs', () => {
    const stale = readyComment({ observedAt: '2026-09-30T12:00:00Z' }) as any;
    stale.created_at = stale.updated_at = '2026-09-30T12:01:00Z';
    expect(findCloseReadyHandoff([stale], closeAt).errors.join('\n')).toContain('stale');

    for (const mutate of [
      (c: any) => { c.trusted = false; },
      (c: any) => { c.created_at = c.updated_at = '2026-10-01T01:01:00Z'; },
      (c: any) => { c.updated_at = '2026-10-01T01:01:00Z'; },
    ]) {
      const comment = readyComment() as any;
      mutate(comment);
      expect(evaluate({ comments: [comment] }).allowed).toBe(false);
    }

    expect(evaluate({ lastClosedCaptureAt: '2026-10-01T00:50:00Z' }).errors.join('\n'))
      .toContain('already consumed');
  });

  it('requires a verified open Product-owned v4 Run containing the Issue', () => {
    expect(evaluate({ verifiedRun: null }).errors.join('\n')).toContain('not verified against current-main Product Run');

    const wrong = evaluate({
      verifiedRun: {
        ...verifiedRun,
        runId: 'different-run',
        status: 'COMPLETE',
        sources: [{ ref: 'issue/999' }],
        closeout: { state: 'CLOSED', ownerRole: 'PRODUCT_MAIN_SESSION' },
      },
    });
    const errors = wrong.errors.join('\n');
    for (const needle of ['differs from verified Product Run', 'active Product Run', 'OPEN Product-owned', 'issue/704']) {
      expect(errors).toContain(needle);
    }
  });

  it('requires trusted final Sol CLOSE_APPROVED bound to a reachable exact head', () => {
    expect(evaluate({ verifiedCloseApproval: null }).errors.join('\n')).toContain('CLOSE_APPROVED_REF');
    for (const patch of [
      { role: 'LUNA' }, { verdict: 'FIX_REQUIRED' }, { trusted: false },
      { beforeClose: false }, { afterLastClose: false }, { runId: 'previous-run' },
      { exactHead: 'c'.repeat(40) }, { reachableFromCurrentMain: false },
    ]) expect(evaluate({ verifiedCloseApproval: { ...verifiedCloseApproval, ...patch } }).allowed).toBe(false);

    const newer = { number: 706, state: 'closed', merged_at: '2026-10-01T00:50:00Z',
      head: { sha: 'd'.repeat(40) },
      body: '<!-- pr-lifecycle\nissue: 704\nstate: MERGED\n-->\nWORKSTREAM: PRODUCT_MAINLINE' };
    expect(evaluate({ mergedPullRequests: [newer] }).errors.join('\n')).toContain('latest merged Product PR #706 head');
    expect(evaluate({ mergedPullRequests: [{ ...newer, number: 707,
      body: '<!-- pr-lifecycle\nissue: 704\nstate: MERGED\n-->\nWORKSTREAM: MODEL_GOVERNANCE' }] }).allowed).toBe(true);
  });

  it('requires current-main exact canonical ci push success', () => {
    for (const patch of [
      { conclusion: 'failure' },
      { event: 'pull_request' },
      { workflowPath: '.github/workflows/not-ci.yml' },
      { headSha: 'c'.repeat(40) },
    ]) {
      expect(evaluate({ verifiedCi: { ...verifiedCi, ...patch } }).allowed).toBe(false);
    }
  });

  it('allows a fresh fully verified close-ready packet', () => {
    const result = evaluate();
    expect(result.allowed).toBe(true);
    expect(result.runId).toBe('2026-10-01-product-r01');
  });

  it('renders durable ISSUE_CLOSED_OBSERVED handoff', () => {
    const body = renderIssueClosedCaptureHandoff({
      issueNumber: 704,
      runId: '2026-10-01-product-r01',
      observedAt: closeAt,
    });
    const parsed = parseRunCaptureHandoff(body);
    expect(parsed?.event).toBe('ISSUE_CLOSED_OBSERVED');
    expect(parsed?.evidenceRef).toBe('github:issue#704');
    expect(body).toContain('NEXT_SAFE_WRITE_PATH');
  });

  it('keeps trusted reopen wiring and governance workflow scope bounded', () => {
    const workflow = fs.readFileSync('.github/workflows/agent-product-issue-close-guard.yml', 'utf8');
    for (const needle of ['types: [closed]', "state: 'open'", 'ISSUE_CLOSED_OBSERVED', 'getCollaboratorPermissionLevel', 'const approvalRunId =']) {
      expect(workflow).toContain(needle);
    }

    const governanceBody = [
      'WORKSTREAM: MODEL_GOVERNANCE',
      'AGENT_LANE: GOVERNANCE',
      'ASTRA_RISK: NONE',
      'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
    ].join('\n');
    expect(classifyWorkstream({
      body: governanceBody,
      changedFiles: ['.github/workflows/agent-product-issue-close-guard.yml'],
      createdAt: '2026-10-01T00:00:00Z',
    }).errors).toEqual([]);
    expect(classifyWorkstream({
      body: governanceBody,
      changedFiles: ['.github/workflows/product-runtime-close-bypass.yml'],
      createdAt: '2026-10-01T00:00:00Z',
    }).errors.join('\n')).toContain('Product/non-governance path');
  });
});
