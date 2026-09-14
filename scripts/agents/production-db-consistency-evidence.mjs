import { createHash } from 'node:crypto';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function signature(item) {
  return createHash('sha256').update(JSON.stringify([
    item?.surface ?? '', item?.objectKey ?? '', item?.expectedFingerprint ?? '',
  ])).digest('hex');
}

export function buildProductionConsistencyEvidence({ report, plannedProductionDifferences = [], mainSha, planDigest }) {
  if (!report || report.observedMainSha !== mainSha) fail('CONSISTENCY_MAIN_MISMATCH', 'drift report is not for the selected main SHA');
  if (report.safety?.authorizesDatabaseWrite !== false) fail('OBSERVER_SCOPE_ESCALATION', 'drift observer must stay read-only');
  if (report.status === 'DRIFT_BLOCKED' || report.status === 'EVIDENCE_UNAVAILABLE') fail('DRIFT_BLOCKED', `drift report status is ${report.status}`);
  if ((report.exceptionSummary?.expired ?? 0) > 0 || (report.exceptionSummary?.unmatched ?? 0) > 0) fail('STALE_DRIFT_EXCEPTION', 'drift exceptions must be active and matched');

  const testStatus = report.environmentStatuses?.TEST;
  if (!['MATCH', 'INTENTIONAL_DIFFERENCE'].includes(testStatus)) fail('TEST_SCHEMA_NOT_READY', `TEST status is ${testStatus ?? 'UNKNOWN'}`);
  const productionStatus = report.environmentStatuses?.PRODUCTION;
  if (!['MATCH', 'EXPECTED_PENDING_PRODUCTION', 'INTENTIONAL_DIFFERENCE'].includes(productionStatus)) fail('PRODUCTION_SCHEMA_UNEXPLAINED', `Production status is ${productionStatus ?? 'UNKNOWN'}`);

  const planned = new Set(plannedProductionDifferences.map(signature));
  const pending = (report.differences ?? []).filter((item) => item.environment === 'PRODUCTION' && item.classification === 'EXPECTED_PENDING_PRODUCTION');
  const intentional = (report.differences ?? []).filter((item) => item.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item.exception?.issue || !item.exception?.expiresAt)) fail('UNBOUND_INTENTIONAL_DIFFERENCE', 'intentional difference lacks durable exception evidence');
  if (pending.some((item) => !planned.has(signature(item)))) fail('UNPLANNED_PRODUCTION_DIFF', 'Production has a pending difference outside this release plan');
  if ([...planned].some((key) => !pending.some((item) => signature(item) === key))) fail('PLANNED_DIFF_NOT_OBSERVED', 'release plan declares a Production difference not present in live evidence');

  const observed = [report.environments?.TEST?.observedAt, report.environments?.PRODUCTION?.observedAt]
    .map((value) => Date.parse(String(value ?? ''))).filter(Number.isFinite);
  if (observed.length !== 2) fail('MISSING_OBSERVED_AT', 'TEST and Production observedAt are required');

  return {
    status: 'CONSISTENCY_VERIFIED', mainSha, planDigest,
    observedAt: new Date(Math.min(...observed)).toISOString(),
    plannedProductionDifferenceCount: pending.length,
    intentionalDifferenceCount: intentional.length,
    unexplainedDifferences: 0,
    databaseMutationAuthorized: false,
  };
}
