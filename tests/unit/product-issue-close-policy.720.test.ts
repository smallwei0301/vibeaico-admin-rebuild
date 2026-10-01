import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
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
  const values = {
    runId: '2026-10-01-product-r01',
    event: 'ISSUE_CLOSE_READY',
    evidenceRef: 'github:workflow#12345',
    observedAt: '2026-10-01T00:45:00Z',
    writerBlocker: 'ledger on protected main',
    nextSafeWritePath: 'capture ISSUE_CLOSED after trusted close',
    closeApprovedRef: 'github:issuecomment#9001',
    ...overrides,
  };
  return {
    created_at: '2026-10-01T00:46:00Z',
    updated_at: '2026-10-01T00:46:00Z',
    trusted: true,
    body: `RUN_CAPTURE_HANDOFF
RUN_ID: ${values.runId}
EVENT: ${values.event}
EVIDENCE_REF: ${values.evidenceRef}
OBSERVED_AT: ${values.observedAt}
WRITER_BLOCKER: ${values.writerBlocker}
NEXT_SAFE_WRITE_PATH: ${values.nextSafeWritePath}\nCLOSE_APPROVED_REF: ${values.closeApprovedRef}`,
  };
}

const verifiedCi = {
  workflowId: 12345,
  name: 'ci',
  event: 'push',
  conclusion: 'success',
  headSha: main,
  workflowPath: '.github/workflows/ci.yml',
};

const verifiedCloseApproval = {
  commentId: 9001,
  role: 'SOL',
  verdict: 'CLOSE_APPROVED',
  exactHead: 'b'.repeat(40),
  reachableFromCurrentMain: true,
  trusted: true,
  beforeClose: true,
};

const verifiedRun = {
  schemaVersion: 2,
  deliveryTruthVersion: 4,
  runId: '2026-10-01-product-r01',
  status: 'IN_PROGRESS',
  sources: [{ ref: 'origin/main' }, { ref: 'issue/704' }],
  closeout: { state: 'OPEN', ownerRole: 'PRODUCT_MAIN_SESSION' },
};

describe('#720 executable Product Issue close gate', () => {
  it('does not apply Product close policy to MODEL_GOVERNANCE issues', () => {
    const result = evaluateProductIssueClose({
      issue: issue({ body: 'WORKSTREAM: MODEL_GOVERNANCE', labels: [{ name: 'workstream:model-governance' }] }),
      currentMainSha: main,
      openPullRequests: [],
      comments: [],
      verifiedCi: null,
    });
    expect(result.applicable).toBe(false);
    expect(result.allowed).toBe(true);
  });

  it('rejects #704-shaped premature close without ISSUE_CLOSE_READY capture', () => {
    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [],
      verifiedCi,
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join('\n')).toContain('ISSUE_CLOSE_READY');
  });

  it('rejects close when a pr-lifecycle PR for the Issue is still open', () => {
    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [{
        number: 706,
        state: 'open',
        body: `<!-- pr-lifecycle\nissue: 704\nstate: ACTIVE\n-->`,
      }],
      comments: [readyComment()],
      verifiedCi,
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join('\n')).toContain('#706');
  });

  it('rejects stale handoff and non-success/non-reachable CI evidence', () => {
    const staleComment = readyComment({ observedAt: '2026-09-30T12:00:00Z' }) as any;
    staleComment.created_at = '2026-09-30T12:01:00Z';
    const stale = findCloseReadyHandoff([staleComment], closeAt);
    expect(stale.errors.join('\n')).toContain('stale');

    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [readyComment()],
      verifiedCi: { ...verifiedCi, conclusion: 'failure', headSha: 'c'.repeat(40) },
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(result.errors.join('\n')).toContain('conclude success');
    expect(result.errors.join('\n')).toContain('current main exact head');
  });

  it('rejects untrusted or post-close handoff comments even when their body looks valid', () => {
    const untrusted = readyComment() as any;
    untrusted.trusted = false;
    const missingTrusted = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [untrusted],
      verifiedCi,
    });
    expect(missingTrusted.allowed).toBe(false);
    expect(missingTrusted.errors.join('\n')).toContain('missing trusted');

    const afterClose = readyComment() as any;
    afterClose.created_at = '2026-10-01T01:01:00Z';
    const late = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [afterClose],
      verifiedCi,
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(late.allowed).toBe(false);
    expect(late.errors.join('\n')).toContain('created before');
  });

  it('requires the close-ready RUN_ID to resolve to an open Product-owned v4 ledger containing the Issue', () => {
    const missing = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [readyComment()],
      verifiedCi,
      verifiedRun: null,
      verifiedCloseApproval,
    });
    expect(missing.errors.join('\n')).toContain('not verified against current-main Product Run');

    const wrong = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [readyComment()],
      verifiedCi,
      verifiedRun: {
        ...verifiedRun,
        runId: 'different-run',
        status: 'COMPLETE',
        sources: [{ ref: 'issue/999' }],
        closeout: { state: 'CLOSED', ownerRole: 'PRODUCT_MAIN_SESSION' },
      },
      verifiedCloseApproval,
    });
    expect(wrong.errors.join('\n')).toContain('differs from verified Product Run');
    expect(wrong.errors.join('\n')).toContain('active Product Run');
    expect(wrong.errors.join('\n')).toContain('OPEN Product-owned');
    expect(wrong.errors.join('\n')).toContain('issue/704');
  });

  it('does not allow an earlier successful close-ready handoff to be consumed twice after reopen', () => {
    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [readyComment()],
      verifiedCi,
      verifiedRun,
      lastClosedCaptureAt: '2026-10-01T00:50:00Z',
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join('\n')).toContain('already consumed');
  });

  it('accepts a fresh handoff with successful reachable canonical main CI and no linked open PR', () => {
    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      openPullRequests: [],
      comments: [readyComment()],
      verifiedCi,
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(result.allowed).toBe(true);
    expect(result.runId).toBe('2026-10-01-product-r01');
  });

  it('fails closed for invalid/unclassified Issue workstream and only bypasses explicit governance', () => {
    const invalid = evaluateProductIssueClose({
      issue: issue({ body: 'no workstream here', labels: [] }),
      currentMainSha: main,
      openPullRequests: [],
      comments: [],
    });
    expect(invalid.applicable).toBe(true);
    expect(invalid.allowed).toBe(false);
    expect(invalid.errors.join('\n')).toContain('classification');

    const governance = evaluateProductIssueClose({
      issue: issue({ body: 'WORKSTREAM: MODEL_GOVERNANCE', labels: [{ name: 'workstream:model-governance' }] }),
      currentMainSha: main,
    });
    expect(governance.applicable).toBe(false);
    expect(governance.allowed).toBe(true);
  });

  it('rejects close-ready comments edited after close', () => {
    const edited = readyComment() as any;
    edited.updated_at = '2026-10-01T01:01:00Z';
    const result = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      comments: [edited],
      verifiedCi,
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(result.allowed).toBe(false);
    expect(result.errors.join('\n')).toContain('edited after');
  });

  it('requires trusted final Sol CLOSE_APPROVED and current-main exact canonical ci', () => {
    const noSol = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      comments: [readyComment()],
      verifiedCi,
      verifiedRun,
      verifiedCloseApproval: null,
    });
    expect(noSol.allowed).toBe(false);
    expect(noSol.errors.join('\n')).toContain('CLOSE_APPROVED_REF');

    const staleCi = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      comments: [readyComment()],
      verifiedCi: { ...verifiedCi, headSha: 'c'.repeat(40) },
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(staleCi.allowed).toBe(false);
    expect(staleCi.errors.join('\n')).toContain('current main exact head');

    const wrongPath = evaluateProductIssueClose({
      issue: issue(),
      currentMainSha: main,
      comments: [readyComment()],
      verifiedCi: { ...verifiedCi, workflowPath: '.github/workflows/not-ci.yml' },
      verifiedRun,
      verifiedCloseApproval,
    });
    expect(wrongPath.errors.join('\n')).toContain('.github/workflows/ci.yml');
  });

  it('emits a durable ISSUE_CLOSED_OBSERVED handoff for owning-run reconciliation', () => {
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

  it('keeps the workflow trusted and capable of reopening a rejected Product close', () => {
    const workflow = fs.readFileSync('.github/workflows/agent-product-issue-close-guard.yml', 'utf8');
    expect(workflow).toContain('types: [closed]');
    expect(workflow).toContain('scripts/agents/product-issue-close-policy.mjs');
    expect(workflow).toContain("state: 'open'");
    expect(workflow).toContain('ISSUE_CLOSED_OBSERVED');
    expect(workflow).toContain('getCollaboratorPermissionLevel');
    expect(workflow).toContain('docs/metrics/agent-runs/');
    expect(workflow).toContain('github-actions[bot]');
  });
  it('allows only the exact close-guard workflow in MODEL_GOVERNANCE scope', () => {
    const governanceBody = [
      'WORKSTREAM: MODEL_GOVERNANCE',
      'AGENT_LANE: GOVERNANCE',
      'ASTRA_RISK: NONE',
      'FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY',
    ].join('\n');

    const allowed = classifyWorkstream({
      body: governanceBody,
      changedFiles: ['.github/workflows/agent-product-issue-close-guard.yml'],
      createdAt: '2026-10-01T00:00:00Z',
    });
    expect(allowed.errors).toEqual([]);

    const sibling = classifyWorkstream({
      body: governanceBody,
      changedFiles: ['.github/workflows/product-runtime-close-bypass.yml'],
      createdAt: '2026-10-01T00:00:00Z',
    });
    expect(sibling.errors.join('\n')).toContain('Product/non-governance path');
  });

});
