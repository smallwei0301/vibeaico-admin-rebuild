// Owner #552: consultation cost is bounded; review quality and source binding are not waived.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

const nativeBuildRouting = JSON.parse(readFileSync(new URL('./model-routing.json', import.meta.url), 'utf8'));

function hasCanonicalPlaybookAnchor(fragment, evidence, repository) {
  if (!/^[a-z0-9-]+$/.test(fragment)) return false;
  const source = evidence?.playbook;
  if (evidence?.repository !== repository || !/^[a-f0-9]{40}$/.test(evidence?.currentMainSha ?? '') ||
      source?.mainSha !== evidence.currentMainSha || typeof source?.content !== 'string') return false;
  const bytes = Buffer.from(source.content, 'utf8');
  const blobSha = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  return source.blobSha === blobSha && [...source.content.matchAll(/<a id="([a-z0-9-]+)"><\/a>/g)]
    .some(match => match[1] === fragment);
}
const text = (value) => String(value ?? '').trim();
const meaningful = (value) => text(value).length >= 8 && !/^(unknown|pending|none|n\/a)$/i.test(text(value));
const validModels = (models) => Array.isArray(models) && models.length > 0 &&
  models.every(model => typeof model === 'string' && model.trim() === model && model.length > 0) &&
  new Set(models).size === models.length;
const list = (value) => Array.isArray(value) ? value : [];
const millis = (value) => typeof value === 'string' && /^\d{4}-\d\d-\d\dT.*Z$/.test(value)
  ? Date.parse(value) : NaN;
const durable = (value) => /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull|actions)\//.test(text(value));
export function fallbackReference(value, repository) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '')) return null;
  const prefix = `https://github.com/${repository}/`;
  if (!text(value).startsWith(prefix)) return null;
  const match = text(value).slice(prefix.length).match(/^(issues|pull)\/([1-9]\d*)#(issuecomment|pullrequestreview)-([1-9]\d*)$/);
  if (!match || (match[3] === 'pullrequestreview' && match[1] !== 'pull')) return null;
  return { number: Number(match[2]), kind: match[3], id: Number(match[4]) };
}

function sourceRecord(ref, review, evidence) {
  const identity = fallbackReference(ref, review.repository);
  if (!identity || evidence?.repository !== review.repository) return null;
  return list(evidence?.records).find(record => record.ref === ref && record.id === identity.id &&
    record.number === identity.number && record.kind === identity.kind && record.trusted === true &&
    meaningful(record.body) && (identity.kind !== 'pullrequestreview' || ['COMMENTED', 'APPROVED'].includes(record.state)));
}
const REASONS = new Set(['PREMIUM_REVIEW_COMPLETED', 'PREMIUM_ATTEMPTED', 'MODEL_UNAVAILABLE',
  'MODEL_SELECTION_UNAVAILABLE', 'START_TIMEOUT', 'DISPATCH_NO_RESPONSE', 'HISTORY_UNAVAILABLE', 'REVIEWER_INFRASTRUCTURE_FAILURE']);
export const FINAL_RISK_COST_POLICY_VERSION = '2026-09-17.1';
export const REVIEWER_FALLBACK_POLICY_VERSION = '2026-09-30.1';
const INFRASTRUCTURE_FAILURES = new Set(['IDENTITY_UNAVAILABLE', 'MODEL_UNAVAILABLE', 'MODEL_SELECTION_UNAVAILABLE',
  'MODEL_DISPATCH', 'TIMEOUT', 'START_TIMEOUT', 'DISPATCH_NO_RESPONSE', 'RATE_LIMIT', 'TOOLING', 'ENVIRONMENT']);
export const PREMIUM_START_TIMEOUT_MS = 300_000;

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
  const catalog = input.runtimeCatalog;
  const captured = millis(catalog?.captureStartedAt), observed = millis(catalog?.observedAt);
  const now = millis(input.now ?? new Date().toISOString());
  const catalogValid = ['OPENAI', 'ANTHROPIC'].includes(input.provider) && catalog?.provider === input.provider
    && validModels(catalog?.models) && validModels(input.availableModels)
    && input.availableModels.every(model => catalog.models.includes(model))
    && durable(catalog?.evidenceRef) && meaningful(catalog?.providerEvidenceRef)
    && Number.isFinite(captured) && Number.isFinite(observed) && captured <= observed && observed <= now;
  const localAuditAvailable = catalogValid && audit.some(model =>
    (input.provider === 'OPENAI' ? model.startsWith('gpt-') : model.startsWith('claude-')) && input.availableModels.includes(model));
  const result = (tier, action, nextModel, reason) => ({ reviewerTier: tier, action, nextModel, reason,
    costPolicyVersion: FINAL_RISK_COST_POLICY_VERSION, premiumRetryAllowed: false,
    reviewLineage: text(input.reviewLineage), evidenceRef: text(input.historyEvidenceRef),
    ...(tier === 'EVIDENCE_FALLBACK' ? {
      fallbackPolicyVersion: REVIEWER_FALLBACK_POLICY_VERSION,
      downgradeReason: reason,
      downgradeEvidenceRef: text(input.failureEvidenceRef),
      failureClass: input.failureClass,
      failureEvidenceRef: text(input.failureEvidenceRef),
      failureDiagnosis: text(input.failureDiagnosis),
    } : {}) });
  const park = () => result('NONE', input.independentSliceAvailable === true
    ? 'PARK_CURRENT_AND_REFILL_BUILD' : 'PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE', null, 'REVIEWER_UNAVAILABLE');
  const diagnosedFailure = durable(input.failureEvidenceRef) && meaningful(input.failureDiagnosis);
  // A genuine safety refusal is not a dispatch fault and must not be routed around.
  if (['SAFETY_CLASSIFIER', 'SAFETY_REFUSAL'].includes(input.failureClass)) return park();
  if (input.failureClass === 'CONTENT_FINDING') return result('NONE', 'RETURN_TO_SOURCE_FIX', null, 'CONTENT_FINDING');
  if (input.failureClass === 'IDENTITY_UNAVAILABLE' && input.modelSelectionAvailable !== false) {
    return diagnosedFailure && localAuditAvailable ? result('EVIDENCE_FALLBACK', 'REVIEW_WITH_EVIDENCE_FALLBACK', null, 'REVIEWER_INFRASTRUCTURE_FAILURE') : park();
  }
  const downgrade = (reason) => {
    if (input.modelSelectionAvailable === false) {
      return result('CURRENT_AGENT', 'REVIEW_WITH_CURRENT_AGENT', null, 'MODEL_SELECTION_UNAVAILABLE');
    }
    if (!catalogValid) return park(); // no selector evidence is not permission to guess either provider's audit model
    const available = new Set(input.availableModels);
    const next = audit.find(model => (input.provider === 'OPENAI' ? model.startsWith('gpt-') : model.startsWith('claude-'))
      && !unavailable.has(model) && !attempted.has(model) && available.has(model));
    return next ? result('AUDIT', 'DOWNGRADE_REVIEWER_MODEL', next, reason)
      : diagnosedFailure && localAuditAvailable ? result('EVIDENCE_FALLBACK', 'REVIEW_WITH_EVIDENCE_FALLBACK', null, 'REVIEWER_INFRASTRUCTURE_FAILURE') : park();
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
  const providerModel = input.provider === 'OPENAI' ? 'gpt-6-astra'
    : input.provider === 'ANTHROPIC' ? 'claude-fable-5-1' : null;
  if (!providerModel || !catalogValid) {
    return downgrade('HISTORY_UNAVAILABLE');
  }
  const next = premium.includes(providerModel) && catalog.models.includes(providerModel)
    && input.availableModels.includes(providerModel) ? providerModel : null;
  return next ? result('PREMIUM', 'RESERVE_ONE_PREMIUM_CONSULTATION', next, 'FIRST_CONSULTATION') : downgrade('MODEL_UNAVAILABLE');
}

export const NATIVE_ROLE_POLICY_VERSION = '2026-10-09.1';
const NATIVE_SOURCE_SURFACE = 'PRODUCT_SOURCE_FINAL_RISK';
const native = record => record?.executionIdentityKind === 'NATIVE_TASK';
// Privacy is a distinct exact-source operator attestation, not public authentication of raw bytes.
function privateNativeMessageValid(spawn, evidence, record, role, context, pilot) {
  const p = spawn?.privateMessage;
  if (pilot.privateMessageMode !== 'PR843_RETAINED_ORIGINAL_V1'
    || context.repository !== 'smallwei0301/vibeaico-admin-rebuild' || context.prNumber !== 843
    || context.headSha !== '47f259db7b2f4ab50b08c0962cc8d6f676575fd0'
    || context.changeDigest !== '18ee75322cafca9148e043cee7ba518ea767ab4f8449fd6eb655c8cb5192b6ba'
    || !['BUILD', 'REVIEW'].includes(role) || spawn?.request?.message !== null
    || p?.schemaVersion !== 1 || typeof p.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(p.sha256)
    || /^0+$/.test(p.sha256) || p.sha256 === createHash('sha256').update('').digest('hex')
    || !Number.isSafeInteger(p.byteLength) || p.byteLength < 1
    || p.encoding !== 'UTF-8' || p.retention !== 'ORIGINAL_VERBATIM_RETAINED_PRIVATELY'
    || p.attestation !== 'OPERATOR_ATTESTS_ORIGINAL_CAPTURE_HASH_AND_SCOPE'
    || typeof p.publicWorkScope !== 'string' || !meaningful(p.publicWorkScope)
    || p.publicWorkScope !== evidence?.performedWorkScope) return false;
  const bindings = { repository: context.repository, prNumber: context.prNumber, headSha: context.headSha,
    changeDigest: context.changeDigest, role, taskName: evidence?.taskName, executionRef: record?.executionRef,
    operatorLogin: evidence?.operatorLogin, operatorId: evidence?.operatorId,
    spawnObservedAt: spawn.observedAt, workStartedAt: record?.startedAt, workCompletedAt: record?.completedAt,
    workArtifactSha256: evidence?.work?.artifactSha256, attestedAt: evidence?.compiledAt };
  return Object.entries(bindings).every(([key, value]) => value !== undefined && p[key] === value);
}
function nativeSpawnMessageValid(spawn, evidence, record, role, context, pilot) {
  if (spawn?.requestMessageAvailability === 'WITHHELD_PRIVATE')
    return privateNativeMessageValid(spawn, evidence, record, role, context, pilot);
  if (spawn?.privateMessage !== undefined) return false;
  if (meaningful(spawn?.request?.message))
    return spawn.requestMessageAvailability === undefined || spawn.requestMessageAvailability === 'CAPTURED';
// Compatibility matches only the claimed, already-observed #843 BUILD ref/instants; later tasks fail.
// Missing prompt bytes remain missing; this does not authenticate the operator's other observations.
  return role === 'BUILD' && spawn?.request?.message === null && spawn?.requestMessageAvailability === 'NOT_CAPTURED'
    && context.repository === 'smallwei0301/vibeaico-admin-rebuild' && context.prNumber === 843
    && context.headSha === '07d360c50c6eb60486fa4f3bc21d0f713d6e2bbb'
    && context.changeDigest === '8da954f36f1e6ea03bac4be9c24f203f75273494dab11b8f49829fca2d7664a3'
    && evidence?.taskName === '/root/implement_843_pg_harness'
    && record?.executionRef === 'native-task:/root/implement_843_pg_harness'
    && millis(spawn?.observedAt) === millis('2026-10-09T14:28:16Z')
    && millis(record?.startedAt) === millis('2026-10-09T14:32:26Z')
    && millis(record?.completedAt) === millis('2026-10-09T15:32:00Z');
}

/** Shape/consistency only. A trusted operator's excerpts cannot authenticate hidden spawn events. */
export function nativeRoleShapeErrors(review = {}, context = {}, pilot = {}) {
  const errors = [], proof = context.roleEvidence;
  const builder = proof?.builder, reviewer = proof?.reviewer;
  const now = millis(context.now ?? new Date().toISOString());
  if (pilot.enabled !== true || pilot.version !== NATIVE_ROLE_POLICY_VERSION
    || context.reviewSurface !== NATIVE_SOURCE_SURFACE || pilot.surface !== NATIVE_SOURCE_SURFACE
    || context.repository !== pilot.repository || context.prNumber !== pilot.prNumber
    || context.headSha !== pilot.headSha || context.currentHeadSha !== pilot.headSha
    || context.changeDigest !== pilot.changeDigest || review.nativeRolePolicyVersion !== pilot.version
    || review.repository !== context.repository || review.headSha !== context.headSha || review.changeDigest !== context.changeDigest
    || review.actualModel !== 'unknown' || review.identityEvidence !== 'UNKNOWN' || review.servedVerified !== false
    || !Number.isFinite(now)) errors.push('Native role pilot is not enabled for this exact source scope');
  for (const [record, role] of [[builder, 'BUILD'], [reviewer, 'REVIEW']]) {
    const e = record?.nativeTaskEvidence, spawn = e?.spawn, work = e?.work, done = e?.completion;
    const buildModel = record?.provider === 'OPENAI' ? nativeBuildRouting.models?.build
      : record?.provider === 'ANTHROPIC' ? nativeBuildRouting.anthropicEquivalents?.build : null;
    if (role === 'BUILD' && (typeof buildModel !== 'string' || record.requestedModel !== buildModel
      || !(record.provider === 'OPENAI' ? buildModel.startsWith('gpt-') : buildModel.startsWith('claude-'))))
      errors.push('Native BUILD requires the current provider-local BUILD model request');
    const started = millis(record?.startedAt), completed = millis(record?.completedAt), compiled = millis(e?.compiledAt);
    const spawned = millis(spawn?.observedAt), workObserved = millis(work?.observedAt), doneObserved = millis(done?.observedAt);
    const ref = fallbackReference(record?.sourceRef, context.repository);
    if (!native(record) || record.actorId !== null || record.sessionId !== null
      || record.backendIdentityAvailability !== 'UNEXPOSED' || record.timingBasis !== 'OBSERVED_ROLE_WORK'
      || record.role !== role || record.repository !== context.repository || record.headSha !== context.headSha
      || record.changeDigest !== context.changeDigest || record.executionEvidence !== 'OPERATOR_ATTESTED'
      || !meaningful(record.executionRef) || ref?.number !== context.prNumber || ref?.kind !== 'issuecomment'
      || record.actualModel !== 'unknown' || record.identityEvidence !== 'UNKNOWN' || record.servedVerified !== false
      || !['OPENAI', 'ANTHROPIC'].includes(record.provider) || !meaningful(record.providerEvidenceRef)
      || e?.schemaVersion !== 1 || e?.executionRefBasis !== 'OPERATOR_SCOPED_NATIVE_TASK'
      || !meaningful(e?.namespace) || !meaningful(e?.captureGeneration) || !meaningful(e?.taskName)
      || !meaningful(e?.performedWorkScope) || !meaningful(e?.operatorLogin)
      || !Number.isSafeInteger(e?.operatorId) || e.operatorId < 1
      || spawn?.sourceKind !== 'OPERATOR_WITNESSED' || spawn?.tool !== 'collaboration.spawn_agent' || spawn?.assignedRole !== role
      || !meaningful(spawn?.request?.task_name) || spawn?.result?.task_name !== e.taskName
      || spawn?.result?.actorId != null || spawn?.result?.sessionId != null || spawn?.request?.freshContext !== undefined
      || !nativeSpawnMessageValid(spawn, e, record, role, context, pilot)
      || !e.taskName.endsWith('/' + spawn?.request?.task_name)
      || (spawn?.request?.model ?? 'not_requested') !== record.requestedModel || !meaningful(record.requestedModel)
      || !['none', 'all'].includes(spawn?.request?.fork_turns)
      || !['low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(spawn?.request?.reasoning_effort)
      || !['OPERATOR_WITNESSED', 'WORKER_REPORTED'].includes(work?.sourceKind)
      || !meaningful(work?.evidenceRef) || !/^[a-f0-9]{64}$/.test(work?.artifactSha256 ?? '')
      || work?.event !== 'ROLE_WORK_STARTED' || work?.startedAt !== record.startedAt
      || done?.sourceKind !== 'OPERATOR_WITNESSED' || done?.event !== 'BOUNDED_WORK_COMPLETED'
      || done?.stoppedWriting !== true || done?.headSha !== record.headSha || done?.changeDigest !== record.changeDigest
      || !meaningful(done?.evidenceRef)
      || ![started, completed, compiled, spawned, workObserved, doneObserved].every(Number.isFinite)
      || spawned > started || started > workObserved || workObserved > completed || completed !== doneObserved
      || completed > compiled || compiled > now) errors.push(`Invalid native ${role} operator observation receipt`);
    if (record?.sourceActor && (record.sourceActor.login !== e?.operatorLogin || record.sourceActor.id !== e?.operatorId))
      errors.push('Native operator differs from canonical submitting actor');
    if (context.nativeCanonical === true && (!record?.sourceActor
      || !Number.isFinite(millis(record.sourceUpdatedAt)) || compiled > millis(record.sourceUpdatedAt)))
      errors.push('Native canonical source metadata is missing or inconsistent');
  }
  const b = builder?.nativeTaskEvidence, r = reviewer?.nativeTaskEvidence;
  if (!b || !r) return errors;
  if (b.operatorLogin !== r.operatorLogin || b.operatorId !== r.operatorId
    || b.namespace !== r.namespace || b.captureGeneration !== r.captureGeneration
    || b.taskName === r.taskName || builder.executionRef === reviewer.executionRef
    || builder.sourceRef === reviewer.sourceRef || reviewer.executionRef !== review.executionRef
    || reviewer.requestedModel !== review.requestedModel
    || reviewer.freshContext !== true || r.contextIsolationAttested !== true || r.participatedInBuild !== false
    || r.reviewPhase !== 'FINAL' || r.spawn?.request?.fork_turns !== 'none'
    || millis(r.spawn?.observedAt) < millis(builder.completedAt)) errors.push('Native review must be a separate fresh final task after BUILD');
  const readback = r.builderReadback, policyReadback = r.policyReadback;
  if (readback?.sourceKind !== 'OPERATOR_WITNESSED' || policyReadback?.sourceKind !== 'OPERATOR_WITNESSED'
    || readback?.sourceRef !== builder.sourceRef || !/^[a-f0-9]{64}$/.test(readback?.bodySha256 ?? '')
    || !Number.isFinite(millis(readback?.observedAt)) || !Number.isFinite(millis(readback?.updatedAt))
    || millis(builder.completedAt) > millis(readback.updatedAt) || millis(readback.updatedAt) > millis(readback.observedAt)
    || millis(readback.observedAt) > millis(r.spawn?.observedAt)
    || policyReadback?.version !== pilot.version || !/^[a-f0-9]{40}$/.test(policyReadback?.mainSha ?? '')
    || !Number.isFinite(millis(policyReadback?.observedAt)) || millis(policyReadback.observedAt) > millis(r.spawn?.observedAt))
    errors.push('Native final review requires prior BUILD and enabled-main policy readback');
  if (context.nativeCanonical === true && (builder.sourceBodySha256 !== readback?.bodySha256
    || builder.sourceUpdatedAt !== readback?.updatedAt || context.nativePolicyEvidence?.reviewedMainSha !== policyReadback?.mainSha
    || !Number.isFinite(millis(review.submittedAt)) || millis(review.submittedAt) > now
    || millis(reviewer.completedAt) > millis(review.submittedAt)))
    errors.push('Native final readback does not match authoritative source bytes');
  return errors;
}

/** Shared current role proof; independent of premium pricing/model identity. */
export function independentRoleErrors(review = {}, context = {}) {
  const errors = [];
  const proof = context.roleEvidence;
  const builder = proof?.builder, reviewer = proof?.reviewer;
  const source = value => typeof value === 'string' && value.startsWith(`https://github.com/${context.repository}/`)
    && /^https:\/\/github\.com\/[^/]+\/[^/]+\/(issues|pull)\/\d+#issuecomment-\d+$/.test(value);
  if (proof?.trusted !== true || !builder || !reviewer) errors.push('Missing independently read-back builder/reviewer role evidence');
  else if (native(builder) || native(reviewer)) {
    if (context.nativeCanonical !== true || !/^[a-f0-9]{40}$/.test(context.nativePolicyEvidence?.currentMainSha ?? ''))
      errors.push('Native role evidence needs current trusted-main source admission');
    errors.push(...nativeRoleShapeErrors(review, context, context.nativePolicyEvidence?.pilot));
  } else {
    for (const [record, role] of [[builder, 'BUILD'], [reviewer, 'REVIEW']]) {
      if (record.role !== role || record.repository !== context.repository || record.headSha !== context.headSha
        || (record.executionIdentityKind !== undefined && record.executionIdentityKind !== 'BACKEND_SESSION') || record.nativeTaskEvidence
        || record.changeDigest !== context.changeDigest || !source(record.sourceRef)
        || !['actorId', 'sessionId', 'executionRef'].every(key => meaningful(record[key]))
        || record.executionEvidence !== 'OPERATOR_ATTESTED' || !Number.isFinite(millis(record.startedAt))
        || !Number.isFinite(millis(record.completedAt)) || millis(record.completedAt) < millis(record.startedAt)) {
        errors.push(`Invalid current ${role} role execution receipt`);
      }
    }
    if (builder.actorId === reviewer.actorId || builder.sessionId === reviewer.sessionId
      || builder.executionRef === reviewer.executionRef || builder.sourceRef === reviewer.sourceRef
      || reviewer.freshContext !== true || reviewer.executionRef !== review.executionRef
      || millis(reviewer.startedAt) < millis(builder.completedAt)) errors.push('Builder cannot approve its own actor/session; fresh independent review required');
  }
  return errors;
}

/** Shared identity contract for WIP/merge, semantic reuse and DB release evidence. */
export function finalRiskReviewerErrors(review = {}, policy = {}, context = {}) {
  const sourceEvidence = context.fallbackSourceEvidence ?? review.fallbackSourceEvidence;
  const tier = review.reviewerTier ?? 'PREMIUM';
  const requested = text(review.requestedModel);
  const actual = text(review.actualModel);
  const allowed = list(policy.models?.finalRiskAllowedModels);
  const catalog = list(policy.models?.finalRiskModelCatalog);
  const validPremium = validModels(allowed) && validModels(catalog) &&
    allowed.every(model => catalog.includes(model)) && allowed.includes(policy.models?.finalRisk);
  const errors = [];
  if (policy.openaiBuilderDecision?.independentReviewerRequired === true) {
    errors.push(...independentRoleErrors(review, context));
  }
  if (tier === 'PREMIUM') {
    if (!(validPremium && requested === actual && allowed.includes(actual))) errors.push('Unverified premium reviewer identity');
    return errors;
  }
  if (!['AUDIT', 'CURRENT_AGENT', 'EVIDENCE_FALLBACK'].includes(tier)) return ['Unknown Final Risk reviewer tier'];
  if (policy.finalRiskCostControl?.version !== FINAL_RISK_COST_POLICY_VERSION ||
      review.costPolicyVersion !== FINAL_RISK_COST_POLICY_VERSION) errors.push('Missing current downgrade policy version');
  if (!REASONS.has(review.downgradeReason)) errors.push('Missing supported downgrade reason');
  if (!durable(review.downgradeEvidenceRef)) errors.push('Missing durable downgrade evidence');
  if (!meaningful(review.reviewLineage) || !meaningful(review.executionRef)) errors.push('Missing review lineage/execution reference');
  if (!meaningful(review.adversarialEvidence)) errors.push('Missing real adversarial review evidence');
  if (review.priorFindingsReviewed !== true || review.unresolvedFindingCount !== 0) errors.push('Prior findings are not reconciled');
  if (tier === 'EVIDENCE_FALLBACK') {
    if (review.fallbackPolicyVersion !== REVIEWER_FALLBACK_POLICY_VERSION ||
        review.downgradeReason !== 'REVIEWER_INFRASTRUCTURE_FAILURE' || !INFRASTRUCTURE_FAILURES.has(review.failureClass)) {
      errors.push('Missing supported infrastructure fallback policy/failure');
    }
    const reviewer = context.roleEvidence?.reviewer;
    if (requested !== 'not_requested') {
      const provider = reviewer?.provider, runtime = reviewer?.runtimeCatalog;
      const captured = millis(runtime?.captureStartedAt), observed = millis(runtime?.observedAt);
      const started = millis(reviewer?.startedAt);
      if (context.roleEvidence?.trusted !== true || !['OPENAI', 'ANTHROPIC'].includes(provider)
        || runtime?.provider !== provider || !validModels(runtime?.models)
        || !runtime.models.includes(requested) || reviewer?.requestedModel !== requested
        || !(provider === 'OPENAI' ? requested.startsWith('gpt-') : requested.startsWith('claude-'))
        || !durable(runtime?.evidenceRef) || !meaningful(reviewer?.providerEvidenceRef)
        || runtime?.providerEvidenceRef !== reviewer.providerEvidenceRef
        || !Number.isFinite(captured) || !Number.isFinite(observed) || !Number.isFinite(started)
        || captured > observed || observed > started) errors.push('Missing trusted provider-local fallback runtime evidence');
    }
    const failure = sourceRecord(review.failureEvidenceRef, review, sourceEvidence);
    const replacement = sourceRecord(review.replacementReviewRef, review, sourceEvidence);
    if (!Number.isSafeInteger(sourceEvidence?.prNumber) || sourceEvidence.prNumber < 1
      || failure?.number !== sourceEvidence.prNumber || replacement?.number !== sourceEvidence.prNumber) {
      errors.push('Fallback sources must belong to the current PR for event invalidation');
    }
    const failureCreated = millis(failure?.createdAt), failureSaved = millis(failure?.updatedAt);
    const replacementCreated = millis(replacement?.createdAt), replacementSaved = millis(replacement?.updatedAt);
    const canonicalSubmitted = millis(review.submittedAt);
    const reviewStarted = millis(reviewer?.startedAt), reviewCompleted = millis(reviewer?.completedAt);
    if (review.failureEvidenceRef === review.replacementReviewRef
      || (failure?.kind === replacement?.kind && failure?.id === replacement?.id) || context.roleEvidence?.trusted !== true
      || ![failureCreated, failureSaved, replacementCreated, reviewStarted, reviewCompleted].every(Number.isFinite)
      || failureCreated > failureSaved || failureSaved > reviewStarted || reviewCompleted < reviewStarted || reviewCompleted > replacementCreated
      || failureSaved >= replacementCreated) errors.push('Failure diagnosis must be saved separately before replacement review');
    if (![replacementCreated, replacementSaved, canonicalSubmitted].every(Number.isFinite)
      || replacementCreated > replacementSaved || replacementSaved > canonicalSubmitted) {
      errors.push('Replacement evidence must be saved before canonical review submission');
    }
    let replacementPayload;
    try {
      replacementPayload = JSON.parse(replacement?.body.match(/```astra-review\s*\n([\s\S]*?)\n```/)?.[1] ?? 'null');
    } catch { replacementPayload = null; }
    const nativeReplacementInvalid = review.nativeRolePolicyVersion &&
      ([...(replacement?.body ?? '').matchAll(/```(?:astra|sol)-review\s*\n/g)].length !== 1 ||
        replacementPayload?.servedVerified !== false || replacementPayload?.servedVerified !== review.servedVerified);
    if (!meaningful(review.failureDiagnosis) || !failure?.body.includes(review.failureDiagnosis) ||
        !replacementPayload || replacementPayload.verdict !== 'PASS' || nativeReplacementInvalid ||
        ['repository', 'changeDigest', 'executionRef', 'adversarialEvidence', 'actualModel', 'requestedModel']
          .some(key => !review[key] || replacementPayload[key] !== review[key]) ||
        ['baseSha', 'headSha', 'policyVersion', 'testBaseline', 'schemaBaseline', 'reviewerTier', 'identityEvidence', 'executionEvidence', 'modelSelectionAvailable',
          'costPolicyVersion', 'fallbackPolicyVersion', 'downgradeReason', 'downgradeEvidenceRef',
          'reviewLineage', 'failureClass', 'failureEvidenceRef', 'failureDiagnosis', 'replacementReviewRef',
          'playbookEvidenceRef', 'reviewerExecutionReceipt', 'nativeRolePolicyVersion']
          .some(key => replacementPayload[key] !== review[key]) ||
        replacementPayload.priorFindingsReviewed !== true || replacementPayload.unresolvedFindingCount !== 0) {
      errors.push('Missing durable failure diagnosis/replacement review');
    }
    const repository = text(review.repository);
    const playbookPrefix = `https://github.com/${repository}/blob/main/docs/AGENT-PLAYBOOK.md#`;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository) ||
        !text(review.playbookEvidenceRef).startsWith(playbookPrefix) ||
        !hasCanonicalPlaybookAnchor(text(review.playbookEvidenceRef).slice(playbookPrefix.length), sourceEvidence, repository)) {
      errors.push('Missing Playbook prevention evidence');
    }
    if (!requested || !actual || review.executionEvidence !== 'OPERATOR_ATTESTED') errors.push('Missing truthful replacement execution attestation');
    const models = list(policy.models?.finalRiskDowngradeAllowedModels);
    if (!validModels(models) || !validModels(catalog) || models.some(model => !catalog.includes(model)) ||
        (actual !== 'unknown' && (requested !== actual || !models.includes(actual))) ||
        (actual === 'unknown' && (requested === 'not_requested'
          ? review.modelSelectionAvailable !== false : !models.includes(requested)))) {
      errors.push('Replacement must retain qualified audit model selection');
    }
    if ((actual === 'unknown' && review.identityEvidence !== 'UNKNOWN') ||
        (actual !== 'unknown' && review.identityEvidence !== 'OPERATOR_ATTESTED')) errors.push('Replacement identity is overstated');
  } else if (tier === 'AUDIT') {
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
