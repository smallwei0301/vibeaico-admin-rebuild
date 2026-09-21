import { readField, readLifecycleIssue } from './agent-wip-policy.mjs';
import { normalizeEvidence } from './run-ledger-reconcile.mjs';

const RUN_ID = /^[0-9]{4}-[0-9]{2}-[0-9]{2}-[a-zA-Z0-9._-]+$/;
const SHA = /^[0-9a-f]{40}$/;
const COUNTED_CI_CONCLUSIONS = new Set(['success', 'failure']);

function isoTime(value) {
  const parsed = Date.parse(String(value ?? ''));
  return Number.isFinite(parsed) ? parsed : null;
}

function withinWindow(value, startedAt, endedAt) {
  const at = isoTime(value);
  if (at === null || at < startedAt) return false;
  return endedAt === null || at <= endedAt;
}

function productRunBound(pr, runId) {
  return readField(pr?.body ?? '', 'WORKSTREAM').toUpperCase() === 'PRODUCT_MAINLINE'
    && readField(pr?.body ?? '', 'RUN_ID') === runId;
}

function workflowPath(run) {
  return String(run?.path ?? '').split('@')[0];
}

/**
 * Collect only GitHub-rebuildable facts. The caller supplies the authenticated
 * GitHub client and the exact current-main SHA; no user-provided counter is
 * accepted here.
 */
export async function collectGithubRunEvidence({
  github,
  owner,
  repo,
  runId,
  ledger,
  observedMainSha,
} = {}) {
  if (!github?.rest || typeof github.paginate !== 'function') throw new Error('GITHUB_CLIENT_REQUIRED');
  if (!RUN_ID.test(String(runId ?? '')) || ledger?.runId !== runId) throw new Error('RUN_ID_MISMATCH');
  if (!SHA.test(String(observedMainSha ?? '').toLowerCase())) throw new Error('INVALID_MAIN_SHA');
  if (ledger?.schemaVersion !== 2 || ledger?.deliveryTruthVersion !== 4
    || !['IN_PROGRESS', 'CLOSURE_RECOVERY'].includes(ledger?.status)
    || ledger?.closeout?.state !== 'OPEN') {
    throw new Error('LIVE_CAPTURE_REQUIRES_ACTIVE_V4');
  }

  const startedAt = isoTime(ledger?.startedAt);
  const endedAt = ledger?.endedAt === null ? null : isoTime(ledger?.endedAt);
  if (startedAt === null || (ledger?.endedAt !== null && endedAt === null)) throw new Error('INVALID_RUN_WINDOW');

  const pulls = await github.paginate(github.rest.pulls.list, {
    owner, repo, state: 'all', sort: 'updated', direction: 'desc', per_page: 100,
  });
  const boundPulls = pulls.filter((pr) => productRunBound(pr, runId));
  const ciRuns = new Map();

  for (const pr of boundPulls) {

    // A PR may have several exact heads during one Product Run. Counting only
    // the current head loses every earlier full CI round after a fix is pushed.
    const commits = await github.paginate(github.rest.pulls.listCommits, {
      owner, repo, pull_number: pr.number, per_page: 100,
    });
    const heads = new Set(
      commits.map((commit) => String(commit?.sha ?? '').toLowerCase()).filter((sha) => SHA.test(sha)),
    );
    const currentHead = String(pr?.head?.sha ?? '').toLowerCase();
    if (SHA.test(currentHead)) heads.add(currentHead);

    for (const head of [...heads].sort()) {
      const runs = await github.paginate(github.rest.actions.listWorkflowRunsForRepo, {
        owner, repo, head_sha: head, per_page: 100,
      });
      for (const run of runs) {
        if (String(run?.head_sha ?? '').toLowerCase() !== head) continue;
        if (String(run?.event ?? '') !== 'pull_request') continue;
        if (workflowPath(run) !== '.github/workflows/ci.yml') continue;
        if (run?.status !== 'completed' || !COUNTED_CI_CONCLUSIONS.has(String(run?.conclusion ?? ''))) continue;
        if (!withinWindow(run?.run_started_at ?? run?.created_at, startedAt, endedAt)) continue;
        const id = Number(run?.id);
        if (Number.isSafeInteger(id) && id > 0) ciRuns.set(id, run);
      }
    }
  }

  const operations = [];
  const counterOperations = [];
  const ciEvidenceRefs = [...ciRuns.keys()].sort((a, b) => a - b)
    .map((id) => `github:actions/run#${id}`);
  if (ciEvidenceRefs.length) {
    counterOperations.push({
      path: 'ci.fullCiRuns',
      observed: ciEvidenceRefs.length,
      evidenceRefs: ciEvidenceRefs,
    });
  }

  const issueNumbers = [...new Set(boundPulls
    .map((pr) => readLifecycleIssue(pr?.body ?? ''))
    .filter((value) => Number.isSafeInteger(value) && value > 0))]
    .sort((a, b) => a - b);
  const issueEvidenceRefs = [];
  for (const issueNumber of issueNumbers) {
    const snapshot = (await github.rest.issues.get({
      owner, repo, issue_number: issueNumber,
    })).data;
    if (snapshot?.state !== 'closed') continue;
    if (!withinWindow(snapshot?.closed_at, startedAt, endedAt)) continue;
    const evidenceRef = `github:issue#${issueNumber}`;
    issueEvidenceRefs.push(evidenceRef);
    operations.push({
      action: 'ADD',
      claim: {
        type: 'ISSUE_CLOSED',
        subject: `issue#${issueNumber}`,
        claimedState: 'closed',
        observedState: 'closed',
        verification: 'VERIFIED',
        evidenceRef,
      },
    });
  }
  if (issueEvidenceRefs.length) {
    counterOperations.push({
      path: 'delivery.issuesClosed',
      observed: issueEvidenceRefs.length,
      evidenceRefs: issueEvidenceRefs,
    });
  }

  if (!operations.length && !counterOperations.length) {
    throw new Error('NO_RECONCILABLE_GITHUB_FACTS');
  }
  return normalizeEvidence({
    schemaVersion: 1,
    runId,
    observedMainSha: String(observedMainSha).toLowerCase(),
    operations,
    counterOperations,
  });
}
