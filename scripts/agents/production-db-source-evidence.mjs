import { verifyProductionDbReleasePlan } from './production-db-release-plan.mjs';

const REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const REQUIRED_CHECK = 'check';
const SHA = /^[0-9a-f]{40}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function exactSha(value, label) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact 40-character SHA`);
  return text;
}

function checkTimestamp(run) {
  const raw = run?.completed_at ?? run?.started_at ?? run?.created_at ?? '';
  const value = Date.parse(String(raw));
  return Number.isFinite(value) ? value : 0;
}

/**
 * Bind canonical main migration bytes to the latest exact-head required source
 * check. This evidence remains read-only admission truth and never authorizes a
 * Production mutation.
 */
export function buildProductionDbSourceEvidence({
  plan,
  currentMainSha,
  checkRuns,
  aliasMap,
  readCanonicalSql,
} = {}) {
  if (!plan || plan.repository !== REPOSITORY) fail('WRONG_REPOSITORY', 'release plan repository is not canonical');
  const mainSha = exactSha(currentMainSha, 'currentMainSha');
  if (exactSha(plan.mainSha, 'plan.mainSha') !== mainSha) fail('SOURCE_MAIN_MISMATCH', 'release plan is not current main');
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });

  const candidates = (Array.isArray(checkRuns) ? checkRuns : [])
    .filter((run) => String(run?.name ?? '') === REQUIRED_CHECK && exactSha(run?.head_sha, 'check.head_sha') === mainSha)
    .sort((a, b) => checkTimestamp(b) - checkTimestamp(a));
  if (!candidates.length) fail('SOURCE_CHECK_MISSING', `no exact-main ${REQUIRED_CHECK} check run exists`);
  const latest = candidates[0];
  if (String(latest?.status ?? '').toLowerCase() !== 'completed' || String(latest?.conclusion ?? '').toLowerCase() !== 'success') {
    fail('SOURCE_CHECK_NOT_GREEN', `latest exact-main ${REQUIRED_CHECK} is ${latest?.status ?? 'UNKNOWN'}/${latest?.conclusion ?? 'UNKNOWN'}`);
  }
  if (!Number.isSafeInteger(Number(latest?.id)) || Number(latest.id) < 1) fail('SOURCE_CHECK_ID_INVALID', 'exact-main check run id is unavailable');

  return {
    status: 'SOURCE_VERIFIED',
    repository: REPOSITORY,
    mainSha,
    planDigest: plan.planDigest,
    exactHeadCheck: {
      name: REQUIRED_CHECK,
      id: Number(latest.id),
      conclusion: 'success',
      completedAt: latest.completed_at ?? null,
      detailsUrl: latest.details_url ?? null,
    },
    migrationCount: plan.migrations.length,
    databaseMutationAuthorized: false,
  };
}

/**
 * Reconstruct G1 source truth from GitHub at release time. No caller-supplied CI
 * verdict or branch SHA is accepted.
 */
export async function buildProductionDbSourceEvidenceFromGithub({
  github,
  owner,
  repo,
  plan,
  aliasMap,
  readCanonicalSql,
} = {}) {
  if (!github?.rest?.repos?.getBranch || !github?.rest?.checks?.listForRef || !github?.paginate) {
    fail('GITHUB_CLIENT_REQUIRED', 'read-only GitHub branch/check client is required');
  }
  const repository = `${String(owner ?? '').trim()}/${String(repo ?? '').trim()}`;
  if (repository !== REPOSITORY) fail('WRONG_REPOSITORY', 'GitHub source adapter is pinned to the canonical repository');

  const branchResponse = await github.rest.repos.getBranch({ owner, repo, branch: 'main' });
  const currentMainSha = exactSha(branchResponse?.data?.commit?.sha, 'github.mainSha');
  const checkRuns = await github.paginate(github.rest.checks.listForRef, {
    owner,
    repo,
    ref: currentMainSha,
    check_name: REQUIRED_CHECK,
    per_page: 100,
  });

  return buildProductionDbSourceEvidence({
    plan,
    currentMainSha,
    checkRuns,
    aliasMap,
    readCanonicalSql,
  });
}

export const PRODUCTION_DB_SOURCE_REQUIRED_CHECK = REQUIRED_CHECK;
