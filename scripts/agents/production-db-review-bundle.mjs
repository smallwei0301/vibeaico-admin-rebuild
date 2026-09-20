import { createHash } from 'node:crypto';
import { stableStringify } from './schema-truth-evidence.mjs';
import { releaseEvidenceDigestOf } from './production-db-release-preflight.mjs';

function requireValue(condition, message) {
  if (!condition) throw new Error(`REVIEW_BUNDLE_INVALID: ${message}`);
}

function id(value, label) {
  requireValue(typeof value === 'string' || (Number.isSafeInteger(value) && value > 0), `${label} must be a positive decimal ID (use a string for large IDs)`);
  const result = String(value);
  requireValue(/^[1-9][0-9]*$/.test(result), `${label} must be a positive decimal ID without whitespace or leading zeros`);
  return result;
}

function object(value, label) {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be a JSON object`);
}

// Reject values that JSON would silently drop or rewrite, and authority claims
// anywhere in artifact data. These APIs only bind evidence; they grant no writes.
function artifact(value, label, ancestors = new Set()) {
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    requireValue(Number.isFinite(value), `${label} must contain finite JSON numbers`);
    return;
  }
  requireValue(typeof value === 'object' && !ancestors.has(value), `${label} must contain acyclic JSON data`);
  requireValue(Array.isArray(value) || [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${label} must contain plain JSON objects`);
  ancestors.add(value);
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) artifact(value[i], `${label}[${i}]`, ancestors);
  } else {
    for (const [key, child] of Object.entries(value)) {
      requireValue(!(['databaseMutationAuthorized', 'authorizesDatabaseWrite'].includes(key) && child !== false), `${label}.${key} must be false; review artifacts cannot authorize mutation`);
      artifact(child, `${label}.${key}`, ancestors);
    }
  }
  ancestors.delete(value);
}

const digest = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
// Exact display names from the orchestrator and its called workflows (no
// job-level name overrides). Unknown successful jobs fail closed.
const COLLECT_SUCCESS_JOBS = new Set([
  'admission', 'collect', 'g2 / read-only-three-way',
  'g4-backup / capture', 'g4-restore / local-logical-restore-canary',
]);

/** Bind the complete collect artifacts. No IO or mutation authorization. */
export function buildReviewBundleManifest({ plan, packet, releaseId, mainSha, readinessRunId, g3RunId, runId, runAttempt, repository } = {}) {
  object(plan, 'plan');
  object(packet, 'packet');
  artifact(plan, 'plan');
  artifact(packet, 'packet');
  requireValue(typeof releaseId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/.test(releaseId), 'releaseId must be 8–120 safe letters, digits, dots, underscores or hyphens, starting with a letter or digit');
  requireValue(typeof mainSha === 'string' && /^[0-9a-f]{40}$/.test(mainSha), 'mainSha must be an exact lowercase 40-character commit SHA');
  requireValue(typeof repository === 'string' && /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(repository), 'repository must be an exact owner/repo full_name');
  requireValue(typeof plan.planDigest === 'string' && /^[0-9a-f]{64}$/.test(plan.planDigest), 'plan.planDigest must be a lowercase SHA256 digest');
  for (const [label, data] of [['plan', plan], ['packet', packet]]) {
    requireValue(data.schemaVersion === 1, `${label}.schemaVersion must be 1`);
    for (const [key, expected] of Object.entries({ releaseId, mainSha, repository, planDigest: plan.planDigest })) {
      requireValue(data[key] === expected, `${label}.${key} does not match the requested release identity; recollect matching artifacts`);
    }
  }
  requireValue(typeof plan.productionProjectRef === 'string' && /^[a-z]{20}$/.test(plan.productionProjectRef) && packet.productionProjectRef === plan.productionProjectRef, 'packet.productionProjectRef must match the plan project');
  requireValue(typeof plan.riskTier === 'string' && packet.riskTier === plan.riskTier, 'packet.riskTier must match plan.riskTier');
  return {
    schemaVersion: 1, mode: 'collect', repository, releaseId, mainSha,
    planDigest: plan.planDigest,
    readinessRunId: id(readinessRunId, 'readinessRunId'),
    g3RunId: id(g3RunId, 'g3RunId'),
    runId: id(runId, 'runId'), runAttempt: id(runAttempt, 'runAttempt'),
    packetSha256: digest(packet), planSha256: digest(plan),
    evidenceDigest: releaseEvidenceDigestOf(packet),
    databaseMutationAuthorized: false,
  };
}

/** run and jobs must be freshly fetched, fully paginated GitHub API data by the
 * caller, never artifact-provided claims. Jobs must be for the current attempt. */
export function assertReviewBundle({ manifest, plan, packet, run, jobs, releaseId, mainSha, readinessRunId, g3RunId, runId, repository } = {}) {
  object(manifest, 'manifest');
  object(run, 'live run');
  artifact(manifest, 'manifest');
  const expected = buildReviewBundleManifest({ plan, packet, releaseId, mainSha, readinessRunId, g3RunId, runId, runAttempt: run.run_attempt, repository });
  for (const [key, value] of Object.entries(expected)) {
    requireValue(manifest[key] === value, `manifest.${key} mismatch; use the unchanged artifacts from the current collect run/attempt`);
  }
  requireValue(Object.keys(manifest).length === Object.keys(expected).length, 'manifest has unsupported fields; use schemaVersion 1 collect manifest');
  requireValue(id(run.id, 'live run.id') === expected.runId, 'live run.id must match requested runId');
  requireValue(run.repository?.full_name === repository, 'live run.repository.full_name must match repository');
  for (const [key, value] of Object.entries({ name: 'production-db-release-orchestrator', path: '.github/workflows/production-db-release-orchestrator.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: mainSha, status: 'completed', conclusion: 'success' })) {
    requireValue(run[key] === value, `live run.${key} must be ${value}; fetch the successful trusted-main collect run`);
  }
  requireValue(Array.isArray(jobs) && jobs.length > 0, 'jobs must be the complete live jobs array for the current run attempt');
  for (const job of jobs) {
    object(job, 'live job');
    requireValue(id(job.run_id, 'job.run_id') === expected.runId, 'job.run_id must match the collect run');
    requireValue(id(job.run_attempt, 'job.run_attempt') === expected.runAttempt, 'job.run_attempt must match the current live run attempt; refetch attempt jobs');
    requireValue(typeof job.name === 'string' && job.name.length > 0, 'live job.name is required');
    requireValue(job.status === 'completed', `job ${job.name} must be completed`);
    requireValue(job.conclusion !== 'success' || COLLECT_SUCCESS_JOBS.has(job.name), `job ${job.name} succeeded outside the exact collection job allowlist; writer execution is forbidden in a review bundle`);
  }
  const requiredJobs = [...COLLECT_SUCCESS_JOBS].map((name) => [name, 'success']);
  for (const [name, conclusion] of [...requiredJobs, ['prepare', 'skipped'], ['execute', 'skipped']]) {
    const matches = jobs.filter((job) => job.name === name);
    requireValue(matches.length === 1 && matches[0].conclusion === conclusion, `live jobs must contain exactly one ${name} job with conclusion ${conclusion} for the current attempt`);
  }
  return true;
}
