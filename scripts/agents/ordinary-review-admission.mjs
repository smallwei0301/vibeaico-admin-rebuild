import { independentRoleErrors } from './final-risk-cost-policy.mjs';
const concrete = value => typeof value === 'string' && value.trim().length >= 8 && !/^(unknown|none|tbd)$/i.test(value);
/** Ordinary merge review. Inputs are trusted adapter read-back, not body stage/proof claims.
 * No premium model dispatch, cost policy or schema-baseline requirement is created.
 */
export function evaluateOrdinaryReview(reviews = [], context = {}, policy = {}) {
  const errors = [];
  const review = reviews[0]; // trusted parser keeps latest negative/malformed records, never skips to older PASS
  if (!review) errors.push('Missing trusted ordinary Sol review');
  else {
    for (const key of ['repository', 'headSha', 'changeDigest', 'policyVersion']) {
      if (review[key] !== context[key]) errors.push(`Ordinary review is stale: ${key}`);
    }
    if (review.commitId !== context.headSha || !['APPROVED', 'COMMENTED'].includes(review.reviewState)
      || review.verdict !== 'PASS') errors.push('Latest ordinary review is not current PASS');
    errors.push(...independentRoleErrors(review, context));
    const reviewer = context.roleEvidence?.reviewer;
    const model = reviewer?.provider === 'OPENAI' ? policy.models?.audit
      : reviewer?.provider === 'ANTHROPIC' ? policy.anthropicEquivalents?.audit : null;
    if (!model || !concrete(reviewer?.providerEvidenceRef) || reviewer?.requestedModel !== model
      || review.requestedModel !== model) errors.push('Ordinary reviewer needs attested provider-local Sol/Opus request');
    if (review.servedVerified !== undefined && typeof review.servedVerified !== 'boolean') errors.push('Malformed ordinary served verification claim');
    if (review.actualModel === 'unknown') {
      if (review.identityEvidence !== 'UNKNOWN' || review.servedVerified === true) errors.push('Ordinary unknown actual cannot claim served identity');
    } else if (review.actualModel !== model || review.identityEvidence !== 'OPERATOR_ATTESTED') errors.push('Ordinary model identity is unverified');
    if (!concrete(review.findings) || !concrete(review.report)
      || !review.report.startsWith(`https://github.com/${context.repository}/`)) errors.push('Missing durable ordinary findings/report');
  }
  return { status: errors.length ? 'SOL_REVIEW_PENDING' : 'SOL_REVIEW_APPROVED', errors };
}
