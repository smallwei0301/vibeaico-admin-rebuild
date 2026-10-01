// Owner #552: consultation cost is bounded; review quality and source binding are not waived.
const text = (value) => String(value ?? '').trim();
const meaningful = (value) => text(value).length >= 8 && !/^(unknown|pending|none|n\/a)$/i.test(text(value));
const validModels = (models) => Array.isArray(models) && models.length > 0 &&
  models.every(model => typeof model === 'string' && model.trim() === model && model.length > 0) &&
  new Set(models).size === models.length;
const list = (value) => Array.isArray(value) ? value : [];
const millis = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value)
  ? Date.parse(value) : NaN;
const durable = (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull|actions)\//.test(text(value));
const REASONS = new Set(['PREMIUM_REVIEW_COMPLETED', 'PREMIUM_ATTEMPTED', 'MODEL_UNAVAILABLE',
  'MODEL_SELECTION_UNAVAILABLE', 'START_TIMEOUT', 'DISPATCH_NO_RESPONSE', 'HISTORY_UNAVAILABLE']);
export const FINAL_RISK_COST_POLICY_VERSION = '2026-09-17.1';
export const PREMIUM_START_TIMEOUT_MS = 300_000;

/** Actual dispatch callers must supply a separately trusted durable readback adapter.
 * Candidate input/prepare reservations are not proof of occupied lineage budget.
 */
export function premiumDispatchPreflight(input = {}, policy = {}, deps = {}) {
  const errors = [];
  const reject = reason => errors.push(reason);
  const scope = value => Array.isArray(value) && value.length > 0 && value.every(path =>
    typeof path === 'string' && path.length > 0 && !/^[/.]|[\\*?\x00-\x1f]/.test(path)
    && !path.split('/').some(part => ['..', '.', ''].includes(part))) && new Set(value).size === value.length;
  const equal = (a, b) => scope(a) && scope(b) && a.length === b.length && a.every(path => b.includes(path));
  const ref = value => /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+#issuecomment-\d+$/.test(text(value));
  if (input.riskClassification?.isModelGovernance !== false || input.riskClassification?.required !== true
    || list(input.riskClassification?.errors).length || !validModels(input.riskClassification?.risks)) reject('Premium is restricted to classified Product high risk');
  if (!scope(input.scope) || !/^[a-f0-9]{40}$/.test(input.headSha ?? '') || !/^[a-f0-9]{64}$/.test(input.changeDigest ?? '')
    || !meaningful(input.reviewLineage) || !meaningful(input.executionRef) || !meaningful(input.requestedBy)) reject('Exact scope/head/digest/lineage/execution/actor reference required');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input.repository ?? '') || !ref(input.reservationRef)
    || !text(input.reservationRef).startsWith(`https://github.com/${input.repository}/`) || !meaningful(input.costReason)) reject('Same-repository durable reservation reference and cost justification required');
  if (input.modelSelectionAvailable !== true || !list(policy.models?.finalRiskAllowedModels).includes(input.requestedModel)
    || !validModels(input.availableModels) || !input.availableModels.includes(input.requestedModel)) reject('Explicit available premium model selector required');
  if (input.historyVerified !== true || !durable(input.historyEvidenceRef) || input.priorPremiumAttemptCount !== 0
    || input.failureClass || input.previousPremiumReview || input.previousReview
    || list(input.premiumAttempts).length || list(input.attemptedModels).some(model => list(policy.models?.finalRiskAllowedModels).includes(model))) reject('Verified zero prior premium attempts required; session/reset cannot clear lineage history');
  let readback;
  try { if (typeof deps.readReservation === 'function') readback = deps.readReservation(input.reservationRef); } catch { /* fail closed */ }
  const receipt = readback?.receipt;
  if (readback?.trusted !== true || readback?.ref !== input.reservationRef || !ref(readback?.ref)
    || !Number.isFinite(millis(readback?.observedAt)) || !receipt) reject('Separately trusted durable reservation readback required');
  else {
    const runtime = readback.runtime;
    const providerModel = runtime?.provider === 'OPENAI' ? 'gpt-6-astra' : runtime?.provider === 'ANTHROPIC' ? 'claude-fable-5-1' : null;
    if (!providerModel || input.provider !== runtime.provider || input.requestedModel !== providerModel
      || runtime.modelSelectionAvailable !== true || !equal(runtime.models, input.availableModels)
      || !meaningful(runtime.evidenceRef) || !Number.isFinite(millis(runtime.observedAt))
      || millis(runtime.observedAt) > millis(readback.observedAt)) reject('Separately observed provider-local runtime catalog must select the matching premium model');
    const lineage = readback.lineageHistory;
    const entries = lineage?.premiumReservations;
    if (lineage?.complete !== true || lineage?.repository !== input.repository || lineage?.reviewLineage !== input.reviewLineage || !durable(lineage?.evidenceRef)
      || !Array.isArray(entries) || entries.length !== 1 || entries[0]?.executionRef !== input.executionRef
      || entries[0]?.state !== 'RESERVED' || entries[0]?.dispatched !== false) reject('Trusted complete lineage history must contain only this unique undispached reservation');
    const observed = millis(readback.observedAt), reserved = millis(receipt.reservedAt), now = millis(input.now);
    if (!Number.isFinite(reserved) || !Number.isFinite(now) || reserved > observed || observed > now) reject('Invalid reservation/readback observation times');
    if (receipt.state !== 'RESERVED' || receipt.lineageAttemptCount !== 1 || receipt.dispatched !== false) reject('Exactly one occupied, not-yet-dispatched lineage reservation required');
    for (const key of ['repository', 'provider', 'headSha', 'changeDigest', 'reviewLineage', 'executionRef', 'requestedBy', 'requestedModel', 'costReason']) {
      if (!(key === 'provider' ? ['OPENAI', 'ANTHROPIC'].includes(receipt[key]) : meaningful(receipt[key])) || receipt[key] !== input[key]) reject(`Reservation ${key} differs from current request`);
    }
    if (!equal(receipt.scope, input.scope) || !equal(receipt.risks, input.riskClassification?.risks)) reject('Reservation exact scope/risk classification mismatch');
  }
  return { status: errors.length ? 'NOT_READY' : 'DISPATCH_READY', errors, dispatchAllowed: errors.length === 0,
    assurance: 'Trusted readback adapter authenticates durable source; this validator does not send a model request',
    reservationRef: input.reservationRef, requestedModel: input.requestedModel, actualModel: 'unknown',
    premiumRetryAllowed: false, costPolicyVersion: FINAL_RISK_COST_POLICY_VERSION };
}

/** A queue acknowledgement is not execution. This is a startup deadline, not a total-review limit. */
export function premiumExecutionState(dispatch = {}, now = new Date().toISOString()) {
  const start = millis(dispatch.requestedAt);
  const current = millis(now);
  if (!Number.isFinite(start) || !Number.isFinite(current) || current < start || !meaningful(dispatch.executionRef)) {
    return { state: 'INVALID_EXECUTION_EVIDENCE', elapsedMs: null };
  }
  const evidence = dispatch.runningEvidence ?? {};
  const observed = millis(evidence.observedAt);
  const running = ['RUNNING', 'TOKEN_GENERATED', 'TOOL_EXECUTED'].includes(evidence.event) &&
    evidence.executionRef === dispatch.executionRef && meaningful(evidence.evidenceRef) &&
    Number.isFinite(observed) && observed >= start && observed <= current &&
    observed - start < PREMIUM_START_TIMEOUT_MS;
  if (running) return { state: 'RUNNING', elapsedMs: current - start };
  return { state: current - start >= PREMIUM_START_TIMEOUT_MS ? 'START_TIMEOUT' : 'WAITING',
    elapsedMs: current - start, deadline: new Date(start + PREMIUM_START_TIMEOUT_MS).toISOString() };
}

/** Input is reconstructed from live, durable lineage/runtime records, never reset for a new digest/session. */
export function selectFinalRiskReviewer(input = {}, policy = {}) {
  const premium = list(policy.models?.finalRiskAllowedModels);
  const audit = list(policy.models?.finalRiskDowngradeAllowedModels);
  const attempted = new Set(list(input.attemptedModels));
  const unavailable = new Set(list(input.unavailableModels));
  const result = (tier, action, nextModel, reason) => ({ reviewerTier: tier, action, nextModel, reason,
    costPolicyVersion: FINAL_RISK_COST_POLICY_VERSION, premiumRetryAllowed: false,
    reviewLineage: text(input.reviewLineage), evidenceRef: text(input.historyEvidenceRef) });
  const park = () => result('NONE', input.independentSliceAvailable === true
    ? 'PARK_CURRENT_AND_REFILL_BUILD' : 'PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE', null, 'REVIEWER_UNAVAILABLE');
  // A genuine safety refusal is not a dispatch fault and must not be routed around.
  if (['SAFETY_CLASSIFIER', 'SAFETY_REFUSAL'].includes(input.failureClass)) return park();
  const downgrade = (reason) => {
    if (input.modelSelectionAvailable === false) {
      return result('CURRENT_AGENT', 'REVIEW_WITH_CURRENT_AGENT', null, 'MODEL_SELECTION_UNAVAILABLE');
    }
    const available = Array.isArray(input.availableModels) ? new Set(input.availableModels) : null;
    const next = audit.find(model => !unavailable.has(model) && !attempted.has(model) && (!available || available.has(model)));
    return next ? result('AUDIT', 'DOWNGRADE_REVIEWER_MODEL', next, reason) : park();
  };
  if (input.modelSelectionAvailable === false) return downgrade('MODEL_SELECTION_UNAVAILABLE');
  if (input.failureClass) return downgrade('DISPATCH_NO_RESPONSE');
  if (input.premiumUnavailable === true || premium.some(model => unavailable.has(model))) return downgrade('MODEL_UNAVAILABLE');
  if (input.previousPremiumReview === true || input.previousReview) return downgrade('PREMIUM_REVIEW_COMPLETED');
  // Continue an already reserved execution, but never start a second model alongside it.
  if (input.dispatch) {
    const state = premiumExecutionState(input.dispatch, input.now);
    if (state.state === 'RUNNING') return { ...result('PREMIUM', 'CONTINUE_EXISTING_REVIEW', null, 'EXECUTION_VERIFIED'), ...state };
    if (state.state === 'WAITING') return { ...result('PREMIUM', 'WAIT_FOR_EXECUTION_EVIDENCE', null, 'START_PENDING'), ...state };
    return downgrade(state.state === 'START_TIMEOUT' ? 'START_TIMEOUT' : 'HISTORY_UNAVAILABLE');
  }
  if (list(input.premiumAttempts).length || premium.some(model => attempted.has(model))) return downgrade('PREMIUM_ATTEMPTED');
  // Missing history is not permission to buy a new premium consultation.
  if (input.historyVerified !== true || !meaningful(input.reviewLineage) || !durable(input.historyEvidenceRef)) {
    return downgrade('HISTORY_UNAVAILABLE');
  }
  const available = Array.isArray(input.availableModels) ? input.availableModels : premium;
  const next = [policy.models?.finalRisk, ...premium].find(model => premium.includes(model) && available.includes(model));
  return next ? result('PREMIUM', 'RESERVE_ONE_PREMIUM_CONSULTATION', next, 'FIRST_CONSULTATION') : downgrade('MODEL_UNAVAILABLE');
}

/** Shared identity contract for WIP/merge, semantic reuse and DB release evidence. */
export function finalRiskReviewerErrors(review = {}, policy = {}) {
  const tier = review.reviewerTier ?? 'PREMIUM';
  const requested = text(review.requestedModel);
  const actual = text(review.actualModel);
  const allowed = list(policy.models?.finalRiskAllowedModels);
  const catalog = list(policy.models?.finalRiskModelCatalog);
  const validPremium = validModels(allowed) && validModels(catalog) &&
    allowed.every(model => catalog.includes(model)) && allowed.includes(policy.models?.finalRisk);
  if (tier === 'PREMIUM') {
    return validPremium && requested === actual && allowed.includes(actual) ? [] : ['Unverified premium reviewer identity'];
  }
  const errors = [];
  if (!['AUDIT', 'CURRENT_AGENT'].includes(tier)) return ['Unknown Final Risk reviewer tier'];
  if (policy.finalRiskCostControl?.version !== FINAL_RISK_COST_POLICY_VERSION ||
      review.costPolicyVersion !== FINAL_RISK_COST_POLICY_VERSION) errors.push('Missing current downgrade policy version');
  if (!REASONS.has(review.downgradeReason)) errors.push('Missing supported downgrade reason');
  if (!durable(review.downgradeEvidenceRef)) errors.push('Missing durable downgrade evidence');
  if (!meaningful(review.reviewLineage) || !meaningful(review.executionRef)) errors.push('Missing review lineage/execution reference');
  if (!meaningful(review.adversarialEvidence)) errors.push('Missing real adversarial review evidence');
  if (review.priorFindingsReviewed !== true || review.unresolvedFindingCount !== 0) errors.push('Prior findings are not reconciled');
  if (tier === 'AUDIT') {
    const models = list(policy.models?.finalRiskDowngradeAllowedModels);
    if (!validModels(models) || !validModels(catalog) || models.some(model => !catalog.includes(model)) || requested !== actual || !models.includes(actual)) {
      errors.push('Unverified audit-tier reviewer identity');
    }
    if (review.identityEvidence !== 'OPERATOR_ATTESTED') errors.push('Missing audit model attestation');
  } else {
    if (review.modelSelectionAvailable !== false || review.downgradeReason !== 'MODEL_SELECTION_UNAVAILABLE') {
      errors.push('Current-agent review requires unavailable model selection');
    }
    if (requested !== 'not_requested' || !actual || review.executionEvidence !== 'OPERATOR_ATTESTED') {
      errors.push('Missing truthful current-agent execution attestation');
    }
    if ((actual === 'unknown' && review.identityEvidence !== 'UNKNOWN') ||
        (actual !== 'unknown' && review.identityEvidence !== 'OPERATOR_ATTESTED')) errors.push('Current-agent identity is overstated');
  }
  return errors;
}
