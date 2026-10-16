import { advanceReleaseJournal, assertReleaseJournalMatchesPlan } from './production-db-release-journal.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

const shortName = (repoFile) => repoFile.slice(5);

function plannedLedgerKeys(migration) {
  const repoFile = String(migration?.repoFile ?? '');
  const canonical = [`${repoFile.slice(0, 4)}/${repoFile}`, `${repoFile.slice(0, 4)}/${shortName(repoFile)}`];
  const applied = migration?.ledgerVersion ? [`${migration.ledgerVersion}/${repoFile}`, `${migration.ledgerVersion}/${shortName(repoFile)}`] : [];
  return { canonical, applied };
}

function verifyPostReport(report, plan, consistency, migrationsUnchangedSincePlan) {
  if (!report || report.status === 'EVIDENCE_UNAVAILABLE') fail('POSTCHECK_EVIDENCE_UNAVAILABLE', 'postcheck report is missing or evidence is unavailable');
  if (report.observedMainSha !== plan.mainSha && migrationsUnchangedSincePlan !== true) {
    fail('POSTCHECK_MAIN_MISMATCH', 'postcheck report is not for the release main SHA');
  }
  if (report.safety?.authorizesDatabaseWrite !== false) fail('POSTCHECK_SCOPE_ESCALATION', 'postcheck observer must remain read-only');
  if ((report.exceptionSummary?.expired ?? 0) > 0 || (report.exceptionSummary?.unmatched ?? 0) > 0) {
    fail('POSTCHECK_STALE_EXCEPTION', 'postcheck exceptions are stale or unmatched');
  }
  const planned = consistency?.plannedProductionDifferences;
  if (!consistency || consistency.status !== 'CONSISTENCY_VERIFIED' || consistency.mainSha !== plan.mainSha || consistency.planDigest !== plan.planDigest
    || !Array.isArray(planned) || planned.length === 0
    || planned.some((item) => typeof item?.surface !== 'string' || typeof item?.objectKey !== 'string')) {
    fail('POSTCHECK_CONSISTENCY_EVIDENCE_REQUIRED', 'release consistency evidence with plannedProductionDifferences is required');
  }
  if (!Array.isArray(plan.migrations) || plan.migrations.length === 0) fail('POSTCHECK_PLAN_MIGRATIONS_REQUIRED', 'release plan migrations are required');
  if (!Array.isArray(report.differences)) fail('POSTCHECK_EVIDENCE_UNAVAILABLE', 'postcheck report has no differences array');
  const differences = report.differences.filter((item) => item?.environment === 'PRODUCTION');
  // Release objects must already match canonical. Unrelated Production drift
  // (migrations on main that are not part of this release) is out of scope.
  const plannedSignatures = new Set(planned.filter((item) => item.surface !== 'migrationLedger').map((item) => `${item.surface}\0${item.objectKey}`));
  if (differences.some((item) => item.surface !== 'migrationLedger' && plannedSignatures.has(`${item.surface}\0${item.objectKey}`))) {
    fail('POSTCHECK_PLANNED_OBJECT_DIFFERS', 'a release object still differs from canonical in Production');
  }
  // A planned migration is still pending when its canonical ledger identity is
  // missing from Production and its applied (plan-fixed) identity is not present.
  const ledger = differences.filter((item) => item.surface === 'migrationLedger');
  for (const migration of plan.migrations) {
    const keys = plannedLedgerKeys(migration);
    const missing = ledger.some((item) => keys.canonical.includes(item.objectKey) && item.observedFingerprint === null);
    const appliedPresent = ledger.some((item) => keys.applied.includes(item.objectKey) && item.observedFingerprint !== null);
    if (missing && !appliedPresent) fail('POSTCHECK_PENDING_REMAINS', `planned migration ${migration.repoFile} is still pending in the Production ledger`);
  }
  const intentional = differences.filter((item) => item.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item?.exception?.issue || !item?.exception?.expiresAt)) {
    fail('POSTCHECK_UNBOUND_INTENTIONAL_DIFFERENCE', 'Production intentional difference lacks durable exception evidence');
  }
}

/**
 * @param {{
 *   report?: any,
 *   plan?: any,
 *   consistency?: any,
 *   migrationsUnchangedSincePlan?: boolean,
 *   journal?: any,
 *   now?: string,
 * }} [input]
 */
export function finalizeProductionDbPostcheck({ report, plan, journal, consistency, migrationsUnchangedSincePlan = false, now = new Date().toISOString() } = {}) {
  assertReleaseJournalMatchesPlan(journal, plan);
  if (journal.status !== 'APPLIED_CONFIRMED') fail('POSTCHECK_JOURNAL_NOT_APPLIED', `journal status is ${journal.status}`);
  try {
    verifyPostReport(report, plan, consistency, migrationsUnchangedSincePlan);
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
