#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TERMINAL_RUN = new Set(['COMPLETE', 'OWNER_BLOCKED']);
const REVIEW_ROLE = new Set(['SOL_AUDIT', 'FINAL_RISK']);
const IDENTITY_EVIDENCE = new Set(['PROVIDER_VERIFIED', 'OPERATOR_ATTESTED', 'UNKNOWN']);
const VERDICT = new Set(['PASS', 'FAIL', 'FIX_REQUIRED', 'PENDING']);
const BLOCKING_VERDICT = new Set(['FAIL', 'FIX_REQUIRED']);
const RESOLVED_ON_FINAL_HEAD = 'RESOLVED_ON_FINAL_HEAD';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const SUBJECT = /^pr#[1-9]\d*$/i;

export const CORE_METRIC_PATHS = Object.freeze([
  'delivery.cycleTimeMinutes',
  'ci.fullCiRuns',
  'ci.invalidReruns',
  'ci.firstPassRatePercent',
  'quality.acceptanceEvidenceCoveragePercent',
  'quality.auditFirstPassRatePercent',
  'quality.unresolvedP0',
  'quality.unresolvedP1',
  'quality.reopenedIssues',
  'quality.postMergeRegressions',
  'quality.safetyViolations',
  'flow.duplicateAgentTasks',
  'flow.ownershipCollisions',
  'flow.waitTimeConvertedPercent',
  'flow.solTouches',
  'flow.solIssues',
  'auditability.evidenceFieldsCompletePercent',
  'auditability.exactHeadTestCoveragePercent',
  'auditability.preciseBlockersPercent',
]);

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function getPath(object, dottedPath) {
  return dottedPath.split('.').reduce((value, key) => value?.[key], object);
}

function meaningful(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalized(value) {
  return String(value ?? '').trim().toLowerCase();
}

function validReviewAnchor(record) {
  const sha = normalized(record.reviewedSha);
  const digest = normalized(record.changeDigest);
  return SHA40.test(sha) || DIGEST64.test(digest);
}

function validFinalAnchor(evidence) {
  return SHA40.test(normalized(evidence?.finalReviewedSha))
    || DIGEST64.test(normalized(evidence?.finalChangeDigest));
}

function recordMatchesFinalAnchor(record, evidence) {
  const finalSha = normalized(evidence?.finalReviewedSha);
  const finalDigest = normalized(evidence?.finalChangeDigest);
  const recordSha = normalized(record?.reviewedSha);
  const recordDigest = normalized(record?.changeDigest);
  return (SHA40.test(finalSha) && recordSha === finalSha)
    || (DIGEST64.test(finalDigest) && recordDigest === finalDigest);
}

function uniqueReviewRecords(records) {
  const seen = new Set();
  return records.filter((record) => {
    if (typeof record?.executionRef !== 'string' || !record.executionRef.trim()) return false;
    const executionRef = record.executionRef.trim();
    if (seen.has(executionRef)) return false;
    seen.add(executionRef);
    return true;
  });
}

export function validateReviewEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['review evidence must be an object'];
  }
  if (evidence.contractVersion !== 1) errors.push('contractVersion must be 1');
  if (!meaningful(evidence.runId)) errors.push('runId is required');
  if (!Array.isArray(evidence.records)) return [...errors, 'records must be an array'];

  if (evidence.finalReviewedSha !== null && evidence.finalReviewedSha !== undefined
      && !SHA40.test(normalized(evidence.finalReviewedSha))) {
    errors.push('finalReviewedSha must be a 40-character SHA when provided');
  }
  if (evidence.finalChangeDigest !== null && evidence.finalChangeDigest !== undefined
      && !DIGEST64.test(normalized(evidence.finalChangeDigest))) {
    errors.push('finalChangeDigest must be a 64-character digest when provided');
  }

  const ids = new Set();
  const executionRefs = new Set();
  evidence.records.forEach((record, index) => {
    const key = `records[${index}]`;
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      errors.push(`${key} must be an object`);
      return;
    }
    if (!meaningful(record.id)) errors.push(`${key}.id is required`);
    else if (ids.has(record.id)) errors.push(`${key}.id is duplicated`);
    else ids.add(record.id);

    if (!SUBJECT.test(String(record.subject ?? '').trim())) errors.push(`${key}.subject must look like pr#123`);
    if (!REVIEW_ROLE.has(record.role)) errors.push(`${key}.role is invalid`);
    if (!meaningful(record.requestedModel)) errors.push(`${key}.requestedModel is required`);
    if (!meaningful(record.actualModel)) errors.push(`${key}.actualModel is required`);
    if (!IDENTITY_EVIDENCE.has(record.identityEvidence)) errors.push(`${key}.identityEvidence is invalid`);
    if (!VERDICT.has(record.verdict)) errors.push(`${key}.verdict is invalid`);

    const executionRef = typeof record.executionRef === 'string' ? record.executionRef.trim() : '';
    if (!executionRef) errors.push(`${key}.executionRef must be a non-empty string`);
    else if (executionRefs.has(executionRef)) errors.push(`${key}.executionRef is duplicated`);
    else executionRefs.add(executionRef);

    if (!validReviewAnchor(record)) errors.push(`${key} requires reviewedSha or changeDigest`);

    const actualUnknown = normalized(record.actualModel) === 'unknown';
    if (actualUnknown && record.identityEvidence !== 'UNKNOWN') {
      errors.push(`${key}: actualModel=unknown requires identityEvidence=UNKNOWN`);
    }
    if (record.identityEvidence === 'PROVIDER_VERIFIED') {
      if (actualUnknown) errors.push(`${key}: provider-verified identity cannot have actualModel=unknown`);
      if (!meaningful(record.providerExecutionRef)) errors.push(`${key}.providerExecutionRef is required for PROVIDER_VERIFIED`);
    }
    if (record.identityEvidence === 'OPERATOR_ATTESTED' && actualUnknown) {
      errors.push(`${key}: operator attestation requires a known actualModel claim`);
    }
  });
  return [...new Set(errors)];
}

export function validateBlockingFindingReconciliation(evidence) {
  if (!evidence || typeof evidence !== 'object' || !Array.isArray(evidence.records)) return [];

  const blockers = evidence.records.filter((record) => BLOCKING_VERDICT.has(record?.verdict));
  if (!blockers.length) return [];

  const errors = [];
  if (!validFinalAnchor(evidence)) {
    errors.push('blocking review reconciliation requires finalReviewedSha or finalChangeDigest');
    return errors;
  }

  const byId = new Map(
    evidence.records
      .filter((record) => meaningful(record?.id))
      .map((record) => [record.id, record]),
  );

  blockers.forEach((record) => {
    const key = `blocking review ${record.id ?? 'unknown'}`;
    const reconciliation = record.reconciliation;
    if (!reconciliation || typeof reconciliation !== 'object' || Array.isArray(reconciliation)) {
      errors.push(`${key} requires reconciliation`);
      return;
    }
    if (reconciliation.status !== RESOLVED_ON_FINAL_HEAD) {
      errors.push(`${key} reconciliation.status must be ${RESOLVED_ON_FINAL_HEAD}`);
    }
    if (!meaningful(reconciliation.byRecordId)) {
      errors.push(`${key} reconciliation.byRecordId is required`);
      return;
    }

    const resolver = byId.get(reconciliation.byRecordId);
    if (!resolver) {
      errors.push(`${key} reconciliation.byRecordId must reference an existing review record`);
      return;
    }
    if (resolver.verdict !== 'PASS') {
      errors.push(`${key} must be reconciled by a PASS review`);
    }
    if (normalized(resolver.subject) !== normalized(record.subject)) {
      errors.push(`${key} must be reconciled by a review of the same subject`);
    }
    if (resolver.role !== record.role) {
      errors.push(`${key} must be reconciled by the same review role`);
    }
    if (!recordMatchesFinalAnchor(resolver, evidence)) {
      errors.push(`${key} resolver must be anchored to the final reviewed head or changeDigest`);
    }
  });

  return [...new Set(errors)];
}

export function computeModelReviewMetrics(evidence) {
  const records = uniqueReviewRecords(evidence?.records ?? []);
  const sol = records.filter((record) => record.role === 'SOL_AUDIT');
  const finalRisk = records.filter((record) => record.role === 'FINAL_RISK');
  const providerVerified = records.filter((record) => record.identityEvidence === 'PROVIDER_VERIFIED');
  const operatorAttested = records.filter((record) => record.identityEvidence === 'OPERATOR_ATTESTED');
  const identityUnknown = records.filter((record) => record.identityEvidence === 'UNKNOWN');
  const total = records.length;
  return {
    totalReviews: total,
    solTouches: sol.length,
    solSubjects: new Set(sol.map((record) => String(record.subject).toLowerCase())).size,
    finalRiskTouches: finalRisk.length,
    providerVerified: providerVerified.length,
    operatorAttested: operatorAttested.length,
    identityUnknown: identityUnknown.length,
    modelReviewIdentityCoveragePercent: total ? round(providerVerified.length / total * 100) : null,
    assignedIdentityCoveragePercent: total ? round((providerVerified.length + operatorAttested.length) / total * 100) : null,
  };
}

export function computeMetricDataQuality(run) {
  const present = CORE_METRIC_PATHS.filter((metricPath) => {
    const value = getPath(run, metricPath);
    return value !== null && value !== undefined;
  });
  return {
    present: present.length,
    total: CORE_METRIC_PATHS.length,
    missing: CORE_METRIC_PATHS.filter((metricPath) => !present.includes(metricPath)),
    percent: round(present.length / CORE_METRIC_PATHS.length * 100),
  };
}

export function evaluateGovernanceScoreboard(run, evidence, policy = {}, { enforce = false } = {}) {
  const errors = [];
  const observations = [];
  const evidenceErrors = validateReviewEvidence(evidence);
  errors.push(...evidenceErrors);
  if (meaningful(evidence?.runId) && evidence.runId !== run?.runId) {
    errors.push(`review evidence runId ${evidence.runId} does not match ledger ${run?.runId}`);
  }

  const reviews = computeModelReviewMetrics(evidence);
  const dataQuality = computeMetricDataQuality(run);
  const ledgerSolTouches = Number(run?.flow?.solTouches ?? 0);
  const ledgerSolIssues = Number(run?.flow?.solIssues ?? 0);
  const solMismatch = ledgerSolTouches !== reviews.solTouches || ledgerSolIssues !== reviews.solSubjects;
  if (solMismatch) {
    observations.push(
      `ledger Sol flow is ${ledgerSolTouches}/${ledgerSolIssues}, durable review evidence is ${reviews.solTouches}/${reviews.solSubjects}`,
    );
  }

  const minimum = Number(policy.minimumMetricDataQualityPercent ?? 95);
  const effectiveAtRaw = String(policy.effectiveAt ?? '').trim();
  const startedAtRaw = String(run?.startedAt ?? '').trim();
  const effectiveAt = Date.parse(effectiveAtRaw);
  const startedAt = Date.parse(startedAtRaw);
  const effectiveAtValid = meaningful(effectiveAtRaw) && Number.isFinite(effectiveAt);
  const startedAtValid = meaningful(startedAtRaw) && Number.isFinite(startedAt);
  const contractApplies = effectiveAtValid && startedAtValid && startedAt >= effectiveAt;
  const terminal = TERMINAL_RUN.has(run?.status);
  const reconciliationErrors = terminal && contractApplies
    ? validateBlockingFindingReconciliation(evidence)
    : [];

  if (enforce && terminal) {
    if (!effectiveAtValid) errors.push('scoreboard policy requires a valid effectiveAt timestamp');
    if (!startedAtValid) errors.push('terminal Run requires a valid startedAt timestamp');

    if (contractApplies) {
      if (dataQuality.percent < minimum) {
        errors.push(`terminal Run metric data quality ${dataQuality.percent}% is below ${minimum}%`);
      }
      if (solMismatch) errors.push('terminal Run Sol flow must match durable review evidence');

      const recordedCompleteness = run?.auditability?.scoreInputsCompletePercent;
      if (recordedCompleteness === null || recordedCompleteness === undefined) {
        errors.push('terminal Run requires auditability.scoreInputsCompletePercent');
      } else if (Math.abs(Number(recordedCompleteness) - dataQuality.percent) > 0.11) {
        errors.push(`auditability.scoreInputsCompletePercent=${recordedCompleteness} must equal computed ${dataQuality.percent}`);
      }

      errors.push(...reconciliationErrors);
    }
  }

  // Report generation is intentionally non-failing, but it must not label a
  // terminal Run as comparable when a post-policy blocker is unresolved.
  // Keep these separate from enforcement errors so the CLI can render an
  // honest report without turning historical read-only reconciliation into a
  // required-check failure.
  const comparisonErrors = [
    ...errors,
    ...reconciliationErrors,
    ...(terminal && !effectiveAtValid ? ['terminal Run has an invalid scoreboard policy timestamp'] : []),
    ...(terminal && !startedAtValid ? ['terminal Run has an invalid startedAt timestamp'] : []),
  ];
  const uniqueComparisonErrors = [...new Set(comparisonErrors)];

  return {
    runId: run?.runId ?? evidence?.runId ?? 'unknown',
    contractApplies,
    terminal,
    metricDataQuality: dataQuality,
    reviews,
    ledgerFlow: { solTouches: ledgerSolTouches, solIssues: ledgerSolIssues },
    solFlowMismatch: solMismatch,
    comparisonEligible: terminal && dataQuality.percent >= minimum && !solMismatch && !uniqueComparisonErrors.length,
    comparisonErrors: uniqueComparisonErrors,
    observations,
    errors: [...new Set(errors)],
  };
}

export function renderGovernanceScoreboard(run, result) {
  const show = (value) => value === null || value === undefined ? 'N/A' : String(value);
  const lines = [
    `# Governance Scoreboard：${result.runId}`,
    '',
    `- Metric data quality: **${result.metricDataQuality.percent}%** (${result.metricDataQuality.present}/${result.metricDataQuality.total})`,
    `- Comparison eligible: **${result.comparisonEligible ? 'YES' : 'NO'}**`,
    `- Sol flow (ledger → evidence): **${result.ledgerFlow.solTouches}/${result.ledgerFlow.solIssues} → ${result.reviews.solTouches}/${result.reviews.solSubjects}**`,
    `- Model review identity coverage (provider verified): **${show(result.reviews.modelReviewIdentityCoveragePercent)}%**`,
    `- Assigned/attested identity coverage: **${show(result.reviews.assignedIdentityCoveragePercent)}%**`,
    '',
    '## Model review evidence',
    '',
    `- total reviews: ${result.reviews.totalReviews}`,
    `- Sol audit touches: ${result.reviews.solTouches}`,
    `- unique Sol subjects: ${result.reviews.solSubjects}`,
    `- Final Risk touches: ${result.reviews.finalRiskTouches}`,
    `- provider verified: ${result.reviews.providerVerified}`,
    `- operator attested: ${result.reviews.operatorAttested}`,
    `- identity unknown: ${result.reviews.identityUnknown}`,
    '',
    '## Missing core metrics',
    '',
    ...(result.metricDataQuality.missing.length ? result.metricDataQuality.missing.map((item) => `- ${item}`) : ['- none']),
    '',
  ];
  if (result.observations.length) lines.push('## Observations', '', ...result.observations.map((item) => `- ${item}`), '');
  const comparisonOnlyErrors = (result.comparisonErrors ?? []).filter((item) => !result.errors.includes(item));
  if (comparisonOnlyErrors.length) lines.push('## Comparison blockers', '', ...comparisonOnlyErrors.map((item) => `- ${item}`), '');
  if (result.errors.length) lines.push('## Contract errors', '', ...result.errors.map((item) => `- ${item}`), '');
  lines.push(
    '---',
    '',
    '`MODEL_REVIEW_VERIFIED` means provider-verified model identity. `OPERATOR_ATTESTED` remains a separate evidence class and may still be admissible to the current Final Risk merge gate; this scoreboard does not change that merge policy.',
    '',
  );
  return lines.join('\n');
}

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function cli() {
  const [ledgerPath, evidencePath, policyPath] = process.argv.slice(2);
  if (!ledgerPath || !evidencePath) {
    throw new Error('Usage: governance-scoreboard.mjs <ledger.json> <review-evidence.json> [policy.json]');
  }
  const run = loadJson(ledgerPath);
  const evidence = loadJson(evidencePath);
  const policy = policyPath ? loadJson(policyPath) : {};
  const result = evaluateGovernanceScoreboard(run, evidence, policy, { enforce: false });
  process.stdout.write(renderGovernanceScoreboard(run, result));
  if (result.errors.length) process.exitCode = 1;
}

const entry = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (entry) {
  try { cli(); }
  catch (error) { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; }
}
