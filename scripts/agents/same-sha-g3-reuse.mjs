import { verifiedIntegrationAndE2e } from './schema-staged-release-policy.mjs';

/*
 * Owner 2026-10-19: a main push CI for SHA X that has queued for the shared TEST lane
 * may skip integration + E2E when a main_manual Production-DB G3 dispatch of ci.yml on
 * the SAME SHA X already executed both successfully. Pure decision, injected API data;
 * any uncertainty means "do not skip".
 *
 * A workflow run object does not expose dispatch inputs, so a G3 dispatch is recognised
 * by the steps that only run for main_manual + production_db_release_id/planned_at.
 */
export const G3_ONLY_STEPS = [
  'Validate exact Production DB release plan on canonical TEST',
  'Upload Production DB G3 trusted evidence bundle',
];
const CI_PATH = '.github/workflows/ci.yml';

function stepsOf(jobs) {
  const integration = (Array.isArray(jobs) ? jobs : []).find((job) => job?.name === 'integration');
  return new Map((integration?.steps ?? []).map((step) => [step.name, step.conclusion]));
}

/** @param {{eventName?: string, ref?: string, sha?: string, runs?: any[], jobsByRunId?: Record<string, any>, currentRunId?: number|string|null}} [input] */
export function decideSameShaG3Reuse({
  eventName, ref, sha, runs = [], jobsByRunId = {}, currentRunId = null,
} = {}) {
  const none = (reason) => ({ skip: false, reason, runId: null, runUrl: null });
  if (eventName !== 'push' || ref !== 'refs/heads/main') return none('not_main_push');
  if (!/^[0-9a-f]{40}$/i.test(String(sha ?? ''))) return none('invalid_sha');
  const candidates = (Array.isArray(runs) ? runs : [])
    .filter((run) => run
      && run.event === 'workflow_dispatch'
      && run.head_branch === 'main'
      && String(run.head_sha ?? '').toLowerCase() === String(sha).toLowerCase()
      && run.path === CI_PATH
      && run.status === 'completed'
      && run.conclusion === 'success'
      && String(run.id) !== String(currentRunId))
    .sort((a, b) => Number(b.id) - Number(a.id));
  if (candidates.length === 0) return none('no_same_sha_g3_dispatch');
  for (const run of candidates) {
    const jobs = jobsByRunId[run.id] ?? jobsByRunId[String(run.id)];
    if (!Array.isArray(jobs) || !verifiedIntegrationAndE2e(jobs)) continue;
    const steps = stepsOf(jobs);
    if (!G3_ONLY_STEPS.every((name) => steps.get(name) === 'success')) continue;
    return { skip: true, reason: 'same_sha_g3_success', runId: Number(run.id), runUrl: run.html_url ?? null };
  }
  return none('no_same_sha_g3_with_executed_integration_e2e');
}

/** Fetch live data and decide. Any API error => skip=false (fail closed to running TEST). */
export async function findSameShaG3Reuse({ github, owner, repo, eventName, ref, sha, currentRunId = null }) {
  try {
    if (eventName !== 'push' || ref !== 'refs/heads/main') return decideSameShaG3Reuse({ eventName, ref, sha });
    const runs = await github.paginate(github.rest.actions.listWorkflowRuns, {
      owner, repo, workflow_id: 'ci.yml', head_sha: sha, event: 'workflow_dispatch', per_page: 100,
    });
    const jobsByRunId = {};
    for (const run of Array.isArray(runs) ? runs : []) {
      if (run?.status !== 'completed' || run?.conclusion !== 'success' || String(run?.id) === String(currentRunId)) continue;
      jobsByRunId[run.id] = await github.paginate(github.rest.actions.listJobsForWorkflowRun, {
        owner, repo, run_id: run.id, filter: 'latest', per_page: 100,
      });
    }
    return decideSameShaG3Reuse({ eventName, ref, sha, runs, jobsByRunId, currentRunId });
  } catch (error) {
    return { skip: false, reason: 'api_error', runId: null, runUrl: null, error: String(error?.message ?? error) };
  }
}
