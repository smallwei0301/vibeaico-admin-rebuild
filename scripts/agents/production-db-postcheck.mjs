import { advanceReleaseJournal, assertReleaseJournalMatchesPlan } from './production-db-release-journal.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function verifyPostReport(report, plan) {
  if (!report || report.observedMainSha !== plan.mainSha) fail('POSTCHECK_MAIN_MISMATCH', 'postcheck report is not for the release main SHA');
  if (report.safety?.authorizesDatabaseWrite !== false) fail('POSTCHECK_SCOPE_ESCALATION', 'postcheck observer must remain read-only');
  if (report.status === 'DRIFT_BLOCKED' || report.status === 'EVIDENCE_UNAVAILABLE') fail('POSTCHECK_DRIFT_BLOCKED', `postcheck report status is ${report.status}`);
  const productionStatus = report.environmentStatuses?.PRODUCTION;
  if (!['MATCH', 'INTENTIONAL_DIFFERENCE'].includes(productionStatus)) {
    fail('POSTCHECK_PRODUCTION_NOT_READY', `Production status is ${productionStatus ?? 'UNKNOWN'}`);
  }
  const differences = Array.isArray(report.differences) ? report.differences : [];
  if (differences.some((item) => item?.environment === 'PRODUCTION' && item?.classification === 'EXPECTED_PENDING_PRODUCTION')) {
    fail('POSTCHECK_PENDING_REMAINS', 'Production still has planned pending differences after apply');
  }
  const intentional = differences.filter((item) => item?.environment === 'PRODUCTION' && item?.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item?.exception?.issue || !item?.exception?.expiresAt)) {
    fail('POSTCHECK_UNBOUND_INTENTIONAL_DIFFERENCE', 'Production intentional difference lacks durable exception evidence');
  }
  if ((report.exceptionSummary?.expired ?? 0) > 0 || (report.exceptionSummary?.unmatched ?? 0) > 0) {
    fail('POSTCHECK_STALE_EXCEPTION', 'postcheck exceptions are stale or unmatched');
  }
}

/**
 * @param {{
 *   report?: any,
 *   plan?: any,
 *   journal?: any,
 *   now?: string,
 * }} [input]
 */
export function finalizeProductionDbPostcheck({ report, plan, journal, now = new Date().toISOString() } = {}) {
  assertReleaseJournalMatchesPlan(journal, plan);
  if (journal.status !== 'APPLIED_CONFIRMED') fail('POSTCHECK_JOURNAL_NOT_APPLIED', `journal status is ${journal.status}`);
  try {
    verifyPostReport(report, plan);
    const readyJournal = advanceReleaseJournal(journal, {
      status: 'PRODUCTION_SCHEMA_READY', at: now, evidenceRef: 'postcheck:schema-acl-rls-match',
    });
    return {
      schemaVersion: 1,
      status: 'PRODUCTION_SCHEMA_READY',
      releaseId: plan.releaseId,
      mainSha: plan.mainSha,
      planDigest: plan.planDigest,
      journal: readyJournal,
      databaseMutationAuthorized: false,
    };
  } catch (error) {
    const failedJournal = advanceReleaseJournal(journal, {
      status: 'POSTCHECK_FAILED', at: now, evidenceRef: 'postcheck:failed',
    });
    const wrapped = new Error(`POSTCHECK_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    wrapped.code = 'POSTCHECK_FAILED';
    wrapped.journal = failedJournal;
    throw wrapped;
  }
}
