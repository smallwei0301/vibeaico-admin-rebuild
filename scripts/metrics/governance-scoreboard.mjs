#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const TERMINAL_RUN = new Set(['COMPLETE', 'OWNER_BLOCKED']);
const LEGACY_REVIEW_ROLE = new Set(['SOL_AUDIT', 'FINAL_RISK']);
const GOVERNANCE_REVIEW_ROLE = new Set(['GOVERNANCE_REVIEW']);
const IDENTITY_EVIDENCE = new Set(['PROVIDER_VERIFIED', 'OPERATOR_ATTESTED', 'UNKNOWN']);
const VERDICT = new Set(['PASS', 'FAIL', 'FIX_REQUIRED', 'PENDING']);
const BLOCKING_VERDICT = new Set(['FAIL', 'FIX_REQUIRED']);
const RESOLVED_ON_FINAL_HEAD = 'RESOLVED_ON_FINAL_HEAD';
const SHA40 = /^[0-9a-f]{40}$/;
const DIGEST64 = /^[0-9a-f]{64}$/;
const SUBJECT = /^pr#[1-9]\d*$/i;

export const LEGACY_CORE_METRIC_PATHS = Object.freeze([
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

export const CORE_METRIC_PATHS = Object.freeze(
  LEGACY_CORE_METRIC_PATHS.filter((metricPath) => !['flow.solTouches', 'flow.solIssues'].includes(metricPath)),
);

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

function validTimestamp(value) {
  const raw = String(value ?? '').trim();
  const parsed = Date.parse(raw);
  return { raw, parsed, valid: meaningful(raw) && Number.isFinite(parsed) };
}

function evidenceContractVersion(evidence) {
  return Number(evidence?.contractVersion);
}

export function validateReviewEvidence(evidence) {
  const errors = [];
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    return ['review evidence must be an object'];
  }

  const contractVersion = evidenceContractVersion(evidence);
  if (![1, 2].includes(contractVersion)) errors.push('contractVersion must be 1 or 2');
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
    const allowedRoles = contractVersion === 2 ? GOVERNANCE_REVIEW_ROLE : LEGACY_REVIEW_ROLE;
    if (!allowedRoles.has(record.role)) {
      errors.push(contractVersion === 2
        ? `${key}.role must be GOVERNANCE_REVIEW for contract v2`
        : `${key}.role is invalid`);
    }
    if (!VERDICT.has(record.verdict)) errors.push(`${key}.verdict is invalid`);

    const executionRef = typeof record.executionRef === 'string' ? record.executionRef.trim() : '';
    if (!executionRef) errors.push(`${key}.executionRef must be a non-empty string`);
    else if (executionRefs.has(executionRef)) errors.push(`${key}.executionRef is duplicated`);
    else executionRefs.add(executionRef);

    if (!validReviewAnchor(record)) errors.push(`${key} requires reviewedSha or changeDigest`);

    if (contractVersion === 1) {
      if (!meaningful(record.requestedModel)) errors.push(`${key}.requestedModel is required`);
      if (!meaningful(record.actualModel)) errors.push(`${key}.actualModel is required`);
      if (!IDENTITY_EVIDENCE.has(record.identityEvidence)) errors.push(`${key}.identityEvidence is invalid`);

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
    if (resolver.verdict !== 'PASS') errors.push(`${key} must be reconciled by a PASS review`);
    if (normalized(resolver.subject) !== normalized(record.subject)) {
      errors.push(`${key} must be reconciled by a review of the same subject`);
    }
    if (resolver.role !== record.role) errors.push(`${key} must be reconciled by the same review role`);
    if (!recordMatchesFinalAnchor(resolver, evidence)) {
      errors.push(`${key} resolver must be anchored to the final reviewed head or changeDigest`);
    }
  });

  return [...new Set(errors)];
}

// Historical contract-v1 helper. Kept only so old scoreboards remain reproducible.
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

export function computeGovernanceReviewMetrics(evidence) {
  const records = uniqueReviewRecords(evidence?.records ?? []);
  return {
    totalReviews: records.length,
    uniqueSubjects: new Set(records.map((record) => String(record.subject).toLowerCase())).size,
    blockingReviews: records.filter((record) => BLOCKING_VERDICT.has(record.verdict)).length,
    passReviews: records.filter((record) => record.verdict === 'PASS').length,
    pendingReviews: records.filter((record) => record.verdict === 'PENDING').length,
  };
}

export function computeMetricDataQuality(run, contractVersion = 2) {
  const paths = Number(contractVersion) === 1 ? LEGACY_CORE_METRIC_PATHS : CORE_METRIC_PATHS;
  const present = paths.filter((metricPath) => {
    const value = getPath(run, metricPath);
    return value !== null && value !== undefined;
  });
  return {
    present: present.length,
    total: paths.length,
    missing: paths.filter((metricPath) => !present.includes(metricPath)),
    percent: round(present.length / paths.length * 100),
  };
}

function resolveContract(run, evidence, policy) {
  const started = validTimestamp(run?.startedAt);
  const currentEffective = validTimestamp(policy?.effectiveAt);
  const policyVersion = Number(policy?.contractVersion);
  const v2Applies = policyVersion >= 2 && currentEffective.valid && started.valid && started.parsed >= currentEffective.parsed;
  const version = v2Applies ? 2 : 1;
  const selectedPolicy = version === 1 ? (policy?.legacyV1 ?? policy) : policy;
  const selectedEffective = validTimestamp(selectedPolicy?.effectiveAt);
  return {
    version,
    evidenceVersion: evidenceContractVersion(evidence),
    selectedPolicy,
    started,
    selectedEffective,
    contractApplies: selectedEffective.valid && started.valid && started.parsed >= selectedEffective.parsed,
  };
}

export function evaluateGovernanceScoreboard(run, evidence, policy = {}, { enforce = false } = {}) {
  const errors = [];
  const observations = [];
  const contract = resolveContract(run, evidence, policy);
  const terminal = TERMINAL_RUN.has(run?.status);

  const evidenceErrors = validateReviewEvidence(evidence);
  errors.push(...evidenceErrors);
  if (meaningful(evidence?.runId) && evidence.runId !== run?.runId) {
    errors.push(`review evidence runId ${evidence.runId} does not match ledger ${run?.runId}`);
  }

  if (terminal && contract.contractApplies && contract.evidenceVersion !== contract.version) {
    errors.push(`terminal Run requires review evidence contractVersion ${contract.version}`);
  }

  const dataQuality = computeMetricDataQuality(run, contract.version);
  const minimum = Number(contract.selectedPolicy?.minimumMetricDataQualityPercent ?? 95);
  const reviews = contract.version === 1
    ? computeModelReviewMetrics(evidence)
    : computeGovernanceReviewMetrics(evidence);

  let legacyFlow = null;
  let legacyFlowMismatch = false;
  if (contract.version === 1) {
    const ledgerSolTouches = Number(run?.flow?.solTouches ?? 0);
    const ledgerSolIssues = Number(run?.flow?.solIssues ?? 0);
    legacyFlow = { solTouches: ledgerSolTouches, solIssues: ledgerSolIssues };
    legacyFlowMismatch = ledgerSolTouches !== reviews.solTouches || ledgerSolIssues !== reviews.solSubjects;
    if (legacyFlowMismatch) {
      observations.push(
        `ledger Sol flow is ${ledgerSolTouches}/${ledgerSolIssues}, durable review evidence is ${reviews.solTouches}/${reviews.solSubjects}`,
      );
    }
  }

  const policyComparisonErrors = [];
  if (terminal && contract.contractApplies) {
    if (dataQuality.percent < minimum) {
      policyComparisonErrors.push(`terminal Run metric data quality ${dataQuality.percent}% is below ${minimum}%`);
    }
    if (contract.version === 1 && legacyFlowMismatch) {
      policyComparisonErrors.push('terminal Run Sol flow must match durable review evidence');
    }

    const recordedCompleteness = run?.auditability?.scoreInputsCompletePercent;
    if (recordedCompleteness === null || recordedCompleteness === undefined) {
      policyComparisonErrors.push('terminal Run requires auditability.scoreInputsCompletePercent');
    } else if (Math.abs(Number(recordedCompleteness) - dataQuality.percent) > 0.11) {
      policyComparisonErrors.push(`auditability.scoreInputsCompletePercent=${recordedCompleteness} must equal computed ${dataQuality.percent}`);
    }
  }

  const reconciliationErrors = terminal && contract.contractApplies
    ? validateBlockingFindingReconciliation(evidence)
    : [];

  if (enforce && terminal) {
    if (!contract.selectedEffective.valid) errors.push('scoreboard policy requires a valid effectiveAt timestamp');
    if (!contract.started.valid) errors.push('terminal Run requires a valid startedAt timestamp');
    if (contract.contractApplies) {
      errors.push(...policyComparisonErrors);
      errors.push(...reconciliationErrors);
    }
  }

  const comparisonErrors = [
    ...errors,
    ...policyComparisonErrors,
    ...reconciliationErrors,
    ...(terminal && !contract.selectedEffective.valid ? ['terminal Run has an invalid scoreboard policy timestamp'] : []),
    ...(terminal && !contract.started.valid ? ['terminal Run has an invalid startedAt timestamp'] : []),
  ];
  const uniqueComparisonErrors = [...new Set(comparisonErrors)];

  return {
    runId: run?.runId ?? evidence?.runId ?? 'unknown',
    contractVersion: contract.version,
    evidenceContractVersion: contract.evidenceVersion,
    contractApplies: contract.contractApplies,
    terminal,
    metricDataQuality: dataQuality,
    reviews,
    legacyFlow,
    legacyFlowMismatch,
    comparisonEligible: terminal
      && dataQuality.percent >= minimum
      && !legacyFlowMismatch
      && !uniqueComparisonErrors.length,
    comparisonErrors: uniqueComparisonErrors,
    observations,
    errors: [...new Set(errors)],
  };
}

function renderLegacyGovernanceScoreboard(result) {
  const show = (value) => value === null || value === undefined ? 'N/A' : String(value);
  return [
    `# Governance Scoreboard：${result.runId}`,
    '',
    '- Contract: **v1 historical / read-only**',
    `- Metric data quality: **${result.metricDataQuality.percent}%** (${result.metricDataQuality.present}/${result.metricDataQuality.total})`,
    `- Comparison eligible: **${result.comparisonEligible ? 'YES' : 'NO'}**`,
    `- Sol flow (ledger → evidence): **${result.legacyFlow?.solTouches ?? 0}/${result.legacyFlow?.solIssues ?? 0} → ${result.reviews.solTouches}/${result.reviews.solSubjects}**`,
    `- Model review identity coverage (provider verified): **${show(result.reviews.modelReviewIdentityCoveragePercent)}%**`,
    `- Assigned/attested identity coverage: **${show(result.reviews.assignedIdentityCoveragePercent)}%**`,
    '',
    '## Historical model review evidence',
    '',
    `- total reviews: ${result.reviews.totalReviews}`,
    `- Sol audit touches: ${result.reviews.solTouches}`,
    `- unique Sol subjects: ${result.reviews.solSubjects}`,
    `- Final Risk touches: ${result.reviews.finalRiskTouches}`,
    `- provider verified: ${result.reviews.providerVerified}`,
    `- operator attested: ${result.reviews.operatorAttested}`,
    `- identity unknown: ${result.reviews.identityUnknown}`,
    '',
    '> Historical v1 fields are reproduced for audit compatibility only. New MODEL_GOVERNANCE retrospectives must not use model identity as a quality trend.',
    '',
  ];
}

function renderModelAgnosticGovernanceScoreboard(result) {
  return [
    `# Governance Scoreboard：${result.runId}`,
    '',
    '- Contract: **v2 model-agnostic governance**',
    `- Metric data quality: **${result.metricDataQuality.percent}%** (${result.metricDataQuality.present}/${result.metricDataQuality.total})`,
    `- Comparison eligible: **${result.comparisonEligible ? 'YES' : 'NO'}**`,
    `- Review evidence records: **${result.reviews.totalReviews}**`,
    `- Unique reviewed subjects: **${result.reviews.uniqueSubjects}**`,
    `- Blocking review records: **${result.reviews.blockingReviews}**`,
    '',
    '## Governance review evidence',
    '',
    `- PASS: ${result.reviews.passReviews}`,
    `- PENDING: ${result.reviews.pendingReviews}`,
    '',
    '> MODEL_GOVERNANCE is model-agnostic. This scoreboard intentionally does not analyze requested/actual model or provider model identity coverage.',
    '',
  ];
}

export function renderGovernanceScoreboard(run, result) {
  const lines = result.contractVersion === 1
    ? renderLegacyGovernanceScoreboard(result)
    : renderModelAgnosticGovernanceScoreboard(result);

  lines.push(
    '## Missing core metrics',
    '',
    ...(result.metricDataQuality.missing.length ? result.metricDataQuality.missing.map((item) => `- ${item}`) : ['- none']),
    '',
  );
  if (result.observations.length) lines.push('## Observations', '', ...result.observations.map((item) => `- ${item}`), '');
  const comparisonOnlyErrors = (result.comparisonErrors ?? []).filter((item) => !result.errors.includes(item));
  if (comparisonOnlyErrors.length) lines.push('## Comparison blockers', '', ...comparisonOnlyErrors.map((item) => `- ${item}`), '');
  if (result.errors.length) lines.push('## Contract errors', '', ...result.errors.map((item) => `- ${item}`), '');
  lines.push('---', '');
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
