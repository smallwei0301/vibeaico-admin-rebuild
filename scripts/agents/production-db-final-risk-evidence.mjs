import { evaluateAstra, parseAstraReviews, routing } from './astra-review-policy.mjs';
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
