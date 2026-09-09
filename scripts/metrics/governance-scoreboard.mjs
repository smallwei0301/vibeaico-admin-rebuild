#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TERMINAL_RUN = new Set(['COMPLETE', 'OWNER_BLOCKED']);
const REVIEW_ROLE = new Set(['SOL_AUDIT', 'FINAL_RISK']);
const IDENTITY_EVIDENCE = new Set(['PROVIDER_VERIFIED', 'OPERATOR_ATTESTED', 'UNKNOWN']);
const VERDICT = new Set(['PASS', 'FAIL', 'FIX_REQUIRED', 'PENDING']);
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

function validReviewAnchor(record) {
  const sha = String(record.reviewedSha ?? '').trim().toLowerCase();
  const digest = String(record.changeDigest ?? '').trim().toLowerCase();
  return SHA40.test(sha) || DIGEST64.test(digest);
}

export function validateReviewEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['review evidence must be an object'];
  }
  if (evidence.contractVersion !== 1) errors.push('contractVersion must be 1');
  if (!meaningful(evidence.runId)) errors.push('runId is required');
  if (!Array.isArray(evidence.records)) return [...errors, 'records must be an array'];

  const ids = new Set();
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
    if (!meaningful(record.executionRef)) errors.push(`${key}.executionRef is required`);
    if (!validReviewAnchor(record)) errors.push(`${key} requires reviewedSha or changeDigest`);

    const actualUnknown = String(record.actualModel ?? '').trim().toLowerCase() === 'unknown';
    if (actualUnknown && record.identityEvidence !== 'UNKNOWN') {
      errors.push(`${key}: actualModel=unknown requires identityEvidence=UNKNOWN`);
    }
    if (!actualUnknown && record.identityEvidence === 'UNKNOWN') {
      errors.push(`${key}: known actualModel cannot use identityEvidence=UNKNOWN`);
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

export function computeModelReviewMetrics(evidence) {
  const records = evidence?.records ?? [];
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
  const effectiveAt = Date.parse(String(policy.effectiveAt ?? '9999-12-31T00:00:00Z'));
  const startedAt = Date.parse(String(run?.startedAt ?? ''));
  const contractApplies = Number.isFinite(effectiveAt) && Number.isFinite(startedAt) && startedAt >= effectiveAt;
  const terminal = TERMINAL_RUN.has(run?.status);

  if (enforce && contractApplies && terminal) {
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
  }

  return {
    runId: run?.runId ?? evidence?.runId ?? 'unknown',
    contractApplies,
    terminal,
    metricDataQuality: dataQuality,
    reviews,
    ledgerFlow: { solTouches: ledgerSolTouches, solIssues: ledgerSolIssues },
    solFlowMismatch: solMismatch,
    comparisonEligible: terminal && dataQuality.percent >= minimum && !solMismatch && !errors.length,
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
