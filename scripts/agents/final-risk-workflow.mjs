#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { readField } from './agent-wip-policy.mjs';
import { validateWipPreflight } from './agent-wip-preflight.mjs';
import { changeDigestOf, parseAstraReviews, routing } from './astra-review-policy.mjs';

const SHA40 = /^[a-f0-9]{40}$/;
const DIGEST64 = /^[a-f0-9]{64}$/;
const PLACEHOLDER = /^(|none|unknown|pending|n\/a|tbd)$/i;
const PASS = new Set(['PASS', 'PASSED', 'SUCCESS', 'GREEN']);
const FIX_VERDICTS = new Set(['FIX_REQUIRED', 'CHANGES_REQUESTED']);
const TRANSIENT_FAILURES = new Set([
  'TOOLING',
  'ENVIRONMENT',
  'MODEL_DISPATCH',
  'RATE_LIMIT',
  'TIMEOUT',
  'SAFETY_CLASSIFIER',
]);
const PRECHECK_FAILURES = new Set(['READINESS', 'INVALID_INPUT', 'PACKET_BUDGET']);

const text = (value) => String(value ?? '').trim();
const upper = (value) => text(value).toUpperCase();
const pass = (value) => PASS.has(upper(value));
const meaningful = (value) => !PLACEHOLDER.test(text(value)) && text(value).length >= 3;
const unique = (values = []) => [...new Set((Array.isArray(values) ? values : []).map(text).filter(Boolean))];
const sorted = (values = []) => [...unique(values)].sort();
const sameMembers = (left = [], right = []) => sorted(left).join('\0') === sorted(right).join('\0');

function fileNames(records = []) {
  return unique((Array.isArray(records) ? records : []).map((record) => record?.filename));
}

function recordSignature(record = {}) {
  return [record.filename, record.previous_filename ?? '', record.status, record.sha].map(text).join('\0');
}

function findingDetails(review = {}) {
  return Array.isArray(review.findingDetails) ? review.findingDetails : [];
}

function findingPaths(review = {}) {
  return unique([
    ...findingDetails(review).flatMap((finding) => Array.isArray(finding?.paths) ? finding.paths : []),
    ...(Array.isArray(review.supportFiles) ? review.supportFiles : []),
  ]);
}

function validatePacketBudget(input = {}) {
  const errors = [];
  const summary = text(input.triageSummary);
  const summaryLines = summary ? summary.split(/\r?\n/).length : 0;
  const changedFiles = fileNames(input.changedFileRecords);
  const deltaFiles = unique(input.deltaFiles);
  const evidenceRefs = unique(input.evidenceRefs);
  const details = findingDetails(input.previousReview);

  if (summaryLines > 30) errors.push(`triageSummary exceeds 30 lines (${summaryLines})`);
  if (summary.length > 6000) errors.push(`triageSummary exceeds 6000 characters (${summary.length})`);
  if (changedFiles.length > 40) errors.push(`review packet changed-file scope exceeds 40 (${changedFiles.length})`);
  if (deltaFiles.length > 20) errors.push(`delta-file scope exceeds 20 (${deltaFiles.length})`);
  if (evidenceRefs.length > 30) errors.push(`evidenceRefs exceeds 30 (${evidenceRefs.length})`);
  if (details.length > 20) errors.push(`previous findingDetails exceeds 20 (${details.length})`);
  return errors;
}

/**
 * Rebuild the previous semantic-review state from live GitHub canonical reviews,
 * never from session memory. parseAstraReviews already ignores untrusted records
 * and sorts newest-first. Unknown/legacy payloads are retained but marked
 * ineligible, so the planner safely falls back to FULL rather than silently using
 * an older review.
 */
export function previousReviewFromCanonicalReviews(reviews = [], repository = '') {
  const latest = parseAstraReviews(reviews)[0] ?? null;
  if (!latest) return null;

  const allowedModels = new Set(unique(routing.models?.finalRiskAllowedModels ?? []));
  const canonicalTrustEligible =
    latest.parseError !== true &&
    allowedModels.has(text(latest.requestedModel)) &&
    allowedModels.has(text(latest.actualModel)) &&
    latest.identityEvidence === 'OPERATOR_ATTESTED' &&
    DIGEST64.test(text(latest.changeDigest)) &&
    routing.highRisk.includes(upper(latest.riskClass)) &&
    (!repository || text(latest.repository) === text(repository));

  return {
    ...latest,
    evidenceSource: 'CANONICAL_GITHUB_REVIEW',
    canonicalTrustEligible,
    changedFileRecords: Array.isArray(latest.changedFileRecords) ? latest.changedFileRecords : [],
    findingDetails: findingDetails(latest),
    supportFiles: Array.isArray(latest.supportFiles) ? latest.supportFiles : [],
  };
}

/**
 * Fail before an expensive reviewer is started. This is an orchestration gate,
 * not a merge-admission replacement: the existing Final Risk guard remains the
 * canonical merge gate.
 */
export function evaluateFinalRiskReadiness(input = {}, deps = {}) {
  const body = String(input.body ?? '');
  const records = Array.isArray(input.changedFileRecords) ? input.changedFileRecords : [];
  const changedFiles = fileNames(records);
  const riskClass = upper(readField(body, 'ASTRA_RISK'));
  const errors = [];

  if (!routing.highRisk.includes(riskClass)) {
    return {
      ready: false,
      status: 'NOT_REQUIRED',
      nextAction: 'SKIP_FINAL_RISK_USE_NORMAL_AUDIT',
      riskClass,
      errors: [],
    };
  }

  const preflightEvaluator = deps.preflightEvaluator ?? validateWipPreflight;
  const preflight = preflightEvaluator({
    body,
    changedFiles,
    requireAstraClassification: true,
    prNumber: input.prNumber ?? 1,
    action: input.action ?? 'synchronize',
    repositoryRoot: input.repositoryRoot ?? process.cwd(),
    fileExists: deps.fileExists,
  });
  if (!preflight?.valid) {
    for (const error of preflight?.errors ?? ['unknown preflight failure']) {
      errors.push(`metadata preflight: ${error}`);
    }
  }

  if (input.sourceFrozen !== true) errors.push('source is not frozen');
  if (!SHA40.test(text(input.exactHead))) errors.push('exactHead must be a 40-character SHA');
  if (!records.length) errors.push('changedFileRecords is required');
  if (records.some((record) => !text(record?.filename) || !text(record?.status) || !text(record?.sha))) {
    errors.push('changedFileRecords contains an incomplete file record');
  }

  const computedDigest = changeDigestOf(records);
  const suppliedDigest = text(input.changeDigest);
  if (!DIGEST64.test(suppliedDigest)) errors.push('changeDigest must be a 64-character sha256');
  if (!computedDigest) errors.push('unable to compute changeDigest from changedFileRecords');
  else if (computedDigest !== suppliedDigest) errors.push('changeDigest does not match changed-file blobs');

  const policyVersion = text(input.policyVersion || routing.version);
  if (policyVersion !== routing.version) errors.push(`policyVersion is stale: expected ${routing.version}`);
  if (!pass(input.sourceCiStatus)) errors.push('source CI is not PASS');
  if (!pass(input.testEvidenceStatus)) errors.push('required test evidence is not PASS');
  if (!pass(input.coreRegressionStatus)) errors.push('core regression suite is not PASS');

  const testBaseline = text(input.testBaseline || readField(body, 'ASTRA_TEST_BASELINE'));
  const schemaBaseline = text(input.schemaBaseline || readField(body, 'ASTRA_SCHEMA_BASELINE'));
  if (!meaningful(testBaseline)) errors.push('concrete testBaseline is required');
  if (!meaningful(schemaBaseline)) errors.push('concrete schemaBaseline is required');

  errors.push(...validatePacketBudget(input));
  return {
    ready: errors.length === 0,
    status: errors.length ? 'NOT_READY' : 'READY',
    nextAction: errors.length ? 'RETURN_TO_PRECHECK' : 'PLAN_REVIEW_MODE',
    riskClass,
    policyVersion,
    computedDigest,
    changedFiles,
    testBaseline,
    schemaBaseline,
    errors: unique(errors),
  };
}

/**
 * First semantic review is FULL. A finding-fix round may be DELTA only when the
 * reviewed universe did not grow and the fix stays inside reviewer-declared
 * finding/support paths. The reviewer may still demand a FULL reset.
 */
export function planFinalRiskReview(input = {}) {
  const previous = input.previousReview;
  const currentDigest = text(input.changeDigest);
  const currentRisk = upper(input.riskClass);
  const currentPolicy = text(input.policyVersion || routing.version);
  const currentRecords = Array.isArray(input.changedFileRecords) ? input.changedFileRecords : [];
  const currentFiles = fileNames(currentRecords);

  if (!previous) return { mode: 'FULL', reason: 'INITIAL_REVIEW', resetReasons: [] };

  const previousVerdict = upper(previous.verdict);
  const sameRisk = upper(previous.riskClass) === currentRisk;
  const samePolicy = text(previous.policyVersion) === currentPolicy;
  const trustedCanonical = previous.canonicalTrustEligible !== false;
  if (
    previousVerdict === 'PASS' &&
    text(previous.changeDigest) === currentDigest &&
    sameRisk &&
    samePolicy &&
    trustedCanonical
  ) {
    return { mode: 'REUSE', reason: 'UNCHANGED_SEMANTIC_DIGEST', resetReasons: [] };
  }

  const resetReasons = [];
  if (!trustedCanonical) resetReasons.push('previous canonical review is not eligible for semantic reuse');
  if (!FIX_VERDICTS.has(previousVerdict)) resetReasons.push(`previous verdict is ${previousVerdict || 'missing'}`);
  if (!sameRisk) resetReasons.push('risk class changed');
  if (!samePolicy) resetReasons.push('Final Risk policy version changed');
  if (input.hotBoundaryExpanded === true) resetReasons.push('high-risk boundary expanded');
  if (input.reviewerRequestedFullReset === true) resetReasons.push('reviewer requested FULL reset');
  if (!pass(input.coreRegressionStatus)) resetReasons.push('core regression suite is not PASS');

  const previousRecords = Array.isArray(previous.changedFileRecords) ? previous.changedFileRecords : [];
  const previousFiles = fileNames(previousRecords);
  if (!previousRecords.length || changeDigestOf(previousRecords) !== text(previous.changeDigest)) {
    resetReasons.push('previous reviewed blob manifest is unavailable or invalid');
  }
  if (!sameMembers(currentFiles, previousFiles)) resetReasons.push('changed-file universe changed');

  const previousByFile = new Map(previousRecords.map((record) => [text(record.filename), recordSignature(record)]));
  const deltaFiles = currentRecords
    .filter((record) => previousByFile.get(text(record.filename)) !== recordSignature(record))
    .map((record) => text(record.filename));
  if (!deltaFiles.length) resetReasons.push('blob-derived delta is empty');
  if (deltaFiles.length > 20) resetReasons.push(`blob-derived delta exceeds 20 files (${deltaFiles.length})`);

  const declaredDelta = unique(input.deltaFiles);
  if (declaredDelta.length && !sameMembers(declaredDelta, deltaFiles)) {
    resetReasons.push('declared delta does not match blob-derived delta');
  }
  const allowedDelta = new Set(findingPaths(previous));
  if (!allowedDelta.size) resetReasons.push('previous review did not declare structured finding/support paths');
  const outsideFinding = deltaFiles.filter((path) => !allowedDelta.has(path));
  if (outsideFinding.length) resetReasons.push(`delta escaped finding/support scope: ${outsideFinding.join(', ')}`);

  return resetReasons.length
    ? { mode: 'FULL', reason: 'FULL_RESET_REQUIRED', resetReasons: unique(resetReasons), deltaFiles }
    : { mode: 'DELTA', reason: 'FINDING_FIX_ONLY', resetReasons: [], deltaFiles };
}

export function buildFinalRiskPacket(input = {}, deps = {}) {
  const previousReview = previousReviewFromCanonicalReviews(input.reviews, input.repository);
  const normalized = { ...input, previousReview };
  const readiness = evaluateFinalRiskReadiness(normalized, deps);
  if (readiness.status === 'NOT_REQUIRED') return { ...readiness, packet: null };
  if (!readiness.ready) return { ...readiness, packet: null };

  const plan = planFinalRiskReview({
    ...normalized,
    riskClass: readiness.riskClass,
    policyVersion: readiness.policyVersion,
    changedFileRecords: input.changedFileRecords,
  });

  if (plan.mode === 'REUSE') {
    return {
      ...readiness,
      reviewMode: 'REUSE',
      previousReviewSource: previousReview?.evidenceSource ?? 'NONE',
      nextAction: 'USE_EXISTING_ATTESTATION_AND_RUN_EXACT_HEAD_CI',
      packet: null,
      plan,
    };
  }

  const evidenceRefs = unique(input.evidenceRefs);
  const packet = {
    packetVersion: 2,
    reviewMode: plan.mode,
    repository: text(input.repository),
    prNumber: Number(input.prNumber) || null,
    exactHead: text(input.exactHead),
    changeDigest: text(input.changeDigest),
    policyVersion: readiness.policyVersion,
    riskClass: readiness.riskClass,
    baselines: {
      test: readiness.testBaseline,
      schema: readiness.schemaBaseline,
    },
    evidenceRefs,
    triageSummary: text(input.triageSummary),
    scope: plan.mode === 'DELTA'
      ? {
          deltaFiles: plan.deltaFiles,
          reviewedUniverse: readiness.changedFiles,
          changedFileRecords: input.changedFileRecords,
          previousChangeDigest: text(previousReview?.changeDigest),
          previousFindingDetails: findingDetails(previousReview),
        }
      : { changedFiles: readiness.changedFiles, changedFileRecords: input.changedFileRecords },
    attestationPersistence: {
      copyExactly: {
        riskClass: readiness.riskClass,
        changedFileRecords: input.changedFileRecords,
      },
      reviewerStructuredFields: ['findingDetails', 'supportFiles'],
      keepExistingRequiredFields: ['findings', 'report', 'requestedModel', 'actualModel', 'identityEvidence'],
    },
    reviewerContract: [
      'Do not repeat ordinary CI unless needed to challenge evidence.',
      'Prioritize concurrency, tenant boundary, rollback, permission bypass, fake-success and negative controls.',
      'Persist riskClass + changedFileRecords in the canonical astra-review payload.',
      'For blocking findings, persist findingDetails [{id, paths, summary}] and optional supportFiles; keep findings as the existing human-readable string.',
      'DELTA mode still requires a fresh trusted verdict for the current changeDigest.',
      'If the fix creates new scope or uncertainty, require FULL reset.',
    ],
  };

  return {
    ...readiness,
    reviewMode: plan.mode,
    previousReviewSource: previousReview?.evidenceSource ?? 'NONE',
    nextAction: 'DISPATCH_FINAL_RISK_REVIEWER',
    plan,
    packet,
  };
}

/**
 * Circuit breaking must stop expensive repetition, not stop the delivery loop.
 * A blocked high-risk candidate remains blocked, while independent work may refill
 * the released BUILD slot.
 */
export function decideFinalRiskRecovery(input = {}) {
  const failureClass = upper(input.failureClass);
  const sameClassAttempts = Number(input.sameClassAttempts ?? 0);
  const currentModel = text(input.currentModel);
  const allowedModels = unique(routing.models?.finalRiskAllowedModels ?? []);
  const attemptedModels = new Set(unique([...(input.attemptedModels ?? []), currentModel]));
  const continueElsewhere = () => input.independentSliceAvailable === true
    ? { breaker: 'OPEN', action: 'PARK_CURRENT_AND_REFILL_BUILD', nextModel: null }
    : { breaker: 'OPEN', action: 'PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE', nextModel: null };

  if (failureClass === 'CONTENT_FINDING' || failureClass === 'REVIEW_FINDING') {
    return { breaker: 'CLOSED', action: 'RETURN_TO_SOURCE_FIX', nextModel: null };
  }
  if (PRECHECK_FAILURES.has(failureClass)) {
    return { breaker: 'CLOSED', action: 'RETURN_TO_PRECHECK', nextModel: null };
  }
  if (!TRANSIENT_FAILURES.has(failureClass)) {
    return { breaker: 'CLOSED', action: 'CLASSIFY_FAILURE_ONCE_THEN_REENTER', nextModel: null };
  }

  if (!allowedModels.includes(currentModel)) {
    const trusted = allowedModels.find((model) => !attemptedModels.has(model)) ?? allowedModels[0];
    return trusted
      ? { breaker: 'OPEN_FOR_CURRENT_MODEL', action: 'SWITCH_REVIEWER_MODEL', nextModel: trusted }
      : continueElsewhere();
  }

  if (sameClassAttempts <= 1) {
    return { breaker: 'CLOSED', action: 'RETRY_SAME_MODEL_ONCE', nextModel: currentModel };
  }

  const alternate = allowedModels.find((model) => !attemptedModels.has(model));
  if (alternate) {
    return { breaker: 'OPEN_FOR_CURRENT_MODEL', action: 'SWITCH_REVIEWER_MODEL', nextModel: alternate };
  }

  return continueElsewhere();
}

function parseArgs(argv) {
  const args = { action: 'prepare' };
  const tokens = [...argv];
  if (tokens[0] && !tokens[0].startsWith('--')) args.action = tokens.shift();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith('--')) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = tokens[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`--${key} requires a value`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function runCli(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (!args.input) throw new Error('Usage: final-risk-workflow.mjs <prepare|recover> --input <input.json> [--output <result.json>]');
  const input = JSON.parse(readFileSync(resolve(args.input), 'utf8'));
  if (input.bodyPath && !input.body) input.body = readFileSync(resolve(input.bodyPath), 'utf8');
  const result = args.action === 'recover'
    ? decideFinalRiskRecovery(input)
    : buildFinalRiskPacket(input);
  const output = `${JSON.stringify(result, null, 2)}\n`;
  if (args.output) writeFileSync(resolve(args.output), output, 'utf8');
  else process.stdout.write(output);
  if (args.action !== 'recover' && result.status === 'NOT_READY') process.exitCode = 2;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (entry) {
  try { runCli(); } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
