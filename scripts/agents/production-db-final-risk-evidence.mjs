import { readField } from './agent-wip-policy.mjs';
import {
  changeDigestOf,
  evaluateAstra,
  isTrustedFinalRiskAgentUser,
  parseAstraReviews,
  routing,
} from './astra-review-policy.mjs';
import { releaseEvidenceDigestOf } from './production-db-release-preflight.mjs';

const DIGEST = /^[0-9a-f]{64}$/;
const RELEASE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,119}$/;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function required(value, label) {
  const text = String(value ?? '').trim();
  if (!text) fail('MISSING_FIELD', `${label} is required`);
  return text;
}

/**
 * @param {{
 *   body?: string,
 *   changedFiles?: any[],
 *   context?: Record<string, any>,
 *   reviews?: any[],
 *   releasePacket?: Record<string, any>,
 * }} [input]
 * @param {any} [policy]
 */
export function buildProductionDbFinalRiskEvidence({
  body = '',
  changedFiles = [],
  context = {},
  reviews = [],
  releasePacket,
} = {}, policy = routing) {
  if (!releasePacket || typeof releasePacket !== 'object' || Array.isArray(releasePacket)) {
    fail('RELEASE_PACKET_REQUIRED', 'releasePacket is required');
  }

  const releaseId = required(releasePacket.releaseId, 'releaseId');
  if (!RELEASE_ID.test(releaseId)) fail('INVALID_RELEASE_ID', 'releaseId has invalid shape');
  const planDigest = required(releasePacket.planDigest, 'planDigest').toLowerCase();
  if (!DIGEST.test(planDigest)) fail('INVALID_PLAN_DIGEST', 'planDigest must be SHA-256');
  const evidenceDigest = releaseEvidenceDigestOf(releasePacket);

  const evaluated = evaluateAstra({ body, changedFiles, context, reviews }, policy);
  if (evaluated.status !== 'ASTRA_APPROVED') {
    fail('FINAL_RISK_NOT_APPROVED', `trusted Final Risk status is ${evaluated.status}`);
  }

  const latest = parseAstraReviews(reviews)[0];
  if (!latest || latest.parseError) fail('FINAL_RISK_RECORD_MISSING', 'latest trusted review record is unavailable');
  if (latest.productionDbReviewScope !== 'PRODUCTION_DB_RELEASE') {
    fail('FINAL_RISK_SCOPE_MISMATCH', 'review is not scoped to a Production DB release');
  }
  if (latest.productionDbReleaseId !== releaseId) {
    fail('FINAL_RISK_RELEASE_MISMATCH', 'review belongs to another Production DB release');
  }
  if (String(latest.productionDbPlanDigest ?? '').toLowerCase() !== planDigest) {
    fail('FINAL_RISK_PLAN_MISMATCH', 'review belongs to another release plan');
  }
  if (String(latest.productionDbEvidenceDigest ?? '').toLowerCase() !== evidenceDigest) {
    fail('FINAL_RISK_EVIDENCE_MISMATCH', 'review did not inspect the current source/consistency/TEST/recovery evidence bundle');
  }

  return {
    status: 'ASTRA_APPROVED',
    requestedModel: latest.requestedModel,
    actualModel: latest.actualModel,
    planDigest,
    evidenceDigest,
    reviewedAt: latest.submittedAt,
    executionRef: latest.report,
    reviewId: String(latest.reviewId),
    releaseId,
    trustSource: latest.trustSource,
    databaseMutationAuthorized: false,
  };
}

async function loadTrustedGithubReviews({ github, owner, repo, prNumber }, policy) {
  const records = await github.paginate(github.rest.pulls.listReviews, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  const permissions = new Map();
  const reviews = [];

  for (const review of records.filter((record) =>
    record.body?.includes('astra-review') || ['CHANGES_REQUESTED', 'DISMISSED'].includes(record.state)
  )) {
    const login = review.user?.login;
    if (!login) continue;

    if (isTrustedFinalRiskAgentUser(review.user, policy)) {
      reviews.push({ ...review, trusted: true, trustSource: 'TRUSTED_AGENT_BOT' });
      continue;
    }

    if (!permissions.has(login)) {
      try {
        const response = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
        permissions.set(login, ['admin', 'maintain', 'write'].includes(response.data.permission));
      } catch (error) {
        if (error?.status !== 404) throw error;
        permissions.set(login, false);
      }
    }
    reviews.push({
      ...review,
      trusted: permissions.get(login),
      trustSource: permissions.get(login) ? 'WRITE_ACTOR' : 'UNTRUSTED',
    });
  }

  return reviews;
}

/**
 * Re-read the Final Risk source of truth from GitHub at release time. The caller
 * may point at a PR number, but it cannot supply that PR's body/files/reviews or
 * claim an approval result. All mutable-release admission data is reconstructed
 * from GitHub read APIs and the trusted-main review policy.
 *
 * @param {{
 *   github?: any,
 *   owner?: string,
 *   repo?: string,
 *   prNumber?: number,
 *   releasePacket?: Record<string, any>,
 * }} [input]
 * @param {any} [policy]
 */
export async function buildProductionDbFinalRiskEvidenceFromGithub({
  github,
  owner,
  repo,
  prNumber,
  releasePacket,
} = {}, policy = routing) {
  if (!github?.rest?.pulls?.get || !github?.rest?.pulls?.listFiles || !github?.rest?.pulls?.listReviews || !github?.paginate) {
    fail('GITHUB_CLIENT_REQUIRED', 'read-only GitHub client with pull request access is required');
  }
  const repository = `${required(owner, 'owner')}/${required(repo, 'repo')}`;
  if (!Number.isSafeInteger(prNumber) || prNumber < 1) fail('INVALID_FINAL_RISK_PR', 'prNumber must be a positive integer');
  if (!releasePacket || typeof releasePacket !== 'object' || Array.isArray(releasePacket)) {
    fail('RELEASE_PACKET_REQUIRED', 'releasePacket is required');
  }
  if (required(releasePacket.repository, 'repository') !== repository) {
    fail('FINAL_RISK_REPOSITORY_MISMATCH', 'release packet belongs to another repository');
  }

  const currentResponse = await github.rest.pulls.get({ owner, repo, pull_number: prNumber });
  const current = currentResponse?.data;
  if (!current || current.number !== prNumber || !current.base?.sha || !current.head?.sha) {
    fail('FINAL_RISK_PR_UNAVAILABLE', 'GitHub did not return a complete pull request snapshot');
  }

  const files = await github.paginate(github.rest.pulls.listFiles, {
    owner,
    repo,
    pull_number: prNumber,
    per_page: 100,
  });
  if (!Number.isSafeInteger(current.changed_files) || files.length !== current.changed_files) {
    fail('FINAL_RISK_CHANGED_FILES_INCOMPLETE', 'GitHub changed-file inventory is incomplete');
  }

  const changeDigest = changeDigestOf(files);
  if (!DIGEST.test(changeDigest)) fail('FINAL_RISK_CHANGE_DIGEST_UNAVAILABLE', 'changed-file digest could not be reconstructed');
  const changedFiles = [...new Set(files.flatMap((file) => [file.filename, file.previous_filename].filter(Boolean)))];
  const body = current.body ?? '';
  const reviews = await loadTrustedGithubReviews({ github, owner, repo, prNumber }, policy);
  const context = {
    repository,
    baseSha: current.base.sha,
    headSha: current.head.sha,
    policyVersion: policy.version,
    testBaseline: readField(body, 'ASTRA_TEST_BASELINE'),
    schemaBaseline: readField(body, 'ASTRA_SCHEMA_BASELINE'),
    changeDigest,
    createdAt: current.created_at,
  };

  return {
    ...buildProductionDbFinalRiskEvidence({ body, changedFiles, context, reviews, releasePacket }, policy),
    sourcePrNumber: prNumber,
    sourcePrHeadSha: current.head.sha,
    changeDigest,
  };
}
