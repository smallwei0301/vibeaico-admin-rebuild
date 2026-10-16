import { ACL_FINGERPRINT_VERSION, LOCAL_EXPECTED_ENVIRONMENT, preApplyAclFingerprintsFromReleaseCatalog } from './schema-drift-watch.mjs';
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

function verifyPostReport(report, plan, consistency, migrationsUnchangedSincePlan, preApplyReport, preApplyCatalogs) {
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
    // Exactly one identity per planned migration: the applied row is reported as an extra Production row, so
    // an applied row together with a present canonical row (not reported missing, or reported as an extra short-spelling row) means both identities exist.
    // The canonical identity may also be present in the Supabase CLI short spelling, reported as an extra row.
    const canonicalPresent = !missing || ledger.some((item) => keys.canonical.includes(item.objectKey) && item.observedFingerprint !== null);
    if (appliedPresent && canonicalPresent) fail('POSTCHECK_DUPLICATE_LEDGER_IDENTITY', `planned migration ${migration.repoFile} has both its canonical and applied ledger identities in Production`);
    if (missing && !appliedPresent) fail('POSTCHECK_PENDING_REMAINS', `planned migration ${migration.repoFile} is still pending in the Production ledger`);
  }
  verifyNoNewUnplannedDrift({ differences, plan, preApplyReport, preApplyCatalogs, consistency, report, ownLedgerKeys: plan.migrations.flatMap((migration) => {
    const keys = plannedLedgerKeys(migration);
    return [...keys.canonical, ...keys.applied];
  }) });
  const intentional = differences.filter((item) => item.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item?.exception?.issue || !item?.exception?.expiresAt)) {
    fail('POSTCHECK_UNBOUND_INTENTIONAL_DIFFERENCE', 'Production intentional difference lacks durable exception evidence');
  }
}

// Unrelated Production drift is tolerated only if it already existed in the release's own pre-apply G2
// report with the same observedFingerprint: otherwise the apply itself introduced or changed it. ACL
// fingerprints are comparable only between reports of the same aclFingerprintVersion (missing = 1); across
// versions no key-only acceptance exists, so any out-of-scope acl difference fails closed - unless the
// release's pre-apply raw catalogs (collect-run artifact) are supplied: they are digest/main/capture bound
// and let the pre-apply Production ACL differences be recomputed at the report's fingerprint version.
function preApplyAclDifferences({ g2, plan, preApplyCatalogs, consistency }) {
  const bindings = [['expected', LOCAL_EXPECTED_ENVIRONMENT, preApplyCatalogs?.expected, g2.environments?.expected],
    ['production', 'PRODUCTION', preApplyCatalogs?.production, g2.environments?.PRODUCTION]];
  const maps = {};
  for (const [label, environment, catalog, reported] of bindings) {
    if (!catalog || typeof catalog !== 'object') fail('POSTCHECK_PREAPPLY_CATALOG_REQUIRED', `pre-apply ${label} catalog is required`);
    if (catalog.mainSha !== plan.mainSha) fail('POSTCHECK_PREAPPLY_CATALOG_MAIN_MISMATCH', `pre-apply ${label} catalog is not for the release main SHA`);
    const bound = reported?.captureDigest?.value;
    if (typeof bound !== 'string' || catalog.snapshotCaptureDigest !== bound) {
      fail('POSTCHECK_PREAPPLY_CATALOG_CAPTURE_MISMATCH', `pre-apply ${label} catalog is not the capture bound by the G2 report`);
    }
    // Lock the raw catalog bytes to the consistency evidence the EXECUTE packet used.
    const evidenceDigest = consistency?.captureDigests?.[environment];
    if (typeof evidenceDigest !== 'string' || catalog.captureDigest !== evidenceDigest) {
      fail('POSTCHECK_PREAPPLY_CATALOG_EVIDENCE_MISMATCH', `pre-apply ${label} catalog is not the capture bound by the consistency evidence`);
    }
    try { maps[label] = preApplyAclFingerprintsFromReleaseCatalog(catalog, environment); } catch (error) {
      fail(`POSTCHECK_PREAPPLY_CATALOG_${error?.code ?? 'INVALID'}`, error instanceof Error ? error.message : String(error));
    }
  }
  const keys = [...new Set([...maps.expected.keys(), ...maps.production.keys()])].sort();
  return keys.filter((key) => (maps.expected.get(key) ?? null) !== (maps.production.get(key) ?? null)).map((objectKey) => ({
    environment: 'PRODUCTION', surface: 'acl', objectKey,
    expectedFingerprint: maps.expected.get(objectKey) ?? null, observedFingerprint: maps.production.get(objectKey) ?? null,
  }));
}
function verifyNoNewUnplannedDrift({ differences, plan, preApplyReport, preApplyCatalogs, consistency, ownLedgerKeys, report }) {
  const g2 = preApplyReport;
  if (!g2 || typeof g2 !== 'object' || !Array.isArray(g2.differences) || g2.status === 'EVIDENCE_UNAVAILABLE'
    || g2.observedMainSha !== plan.mainSha || g2.safety?.authorizesDatabaseWrite !== false) {
    fail('POSTCHECK_PREAPPLY_REPORT_REQUIRED', 'the release pre-apply G2 drift report is required and must be valid for the release main');
  }
  if ((consistency?.rawObserverStatus !== undefined && consistency.rawObserverStatus !== g2.status)
    || (consistency?.rawObserverDifferenceCount !== undefined && consistency.rawObserverDifferenceCount !== g2.differenceCount)) {
    fail('POSTCHECK_PREAPPLY_REPORT_MISMATCH', 'pre-apply G2 report is not the one bound by the release consistency evidence');
  }
  const aclVersion = (value) => value?.aclFingerprintVersion ?? 1;
  let aclComparable = aclVersion(g2) === aclVersion(report);
  let baseline = g2.differences.filter((item) => item?.environment === 'PRODUCTION');
  if (!aclComparable && preApplyCatalogs && aclVersion(report) === ACL_FINGERPRINT_VERSION) {
    baseline = [...baseline.filter((item) => item.surface !== 'acl'), ...preApplyAclDifferences({ g2, plan, preApplyCatalogs, consistency })];
    aclComparable = true;
  }
  const before = new Map(baseline.map((item) => [`${item.surface}\0${item.objectKey}`, item]));
  const planned = new Set((consistency?.plannedProductionDifferences ?? []).map((item) => `${item.surface}\0${item.objectKey}`));
  for (const item of differences) {
    if (item.surface === 'migrationLedger' && ownLedgerKeys.includes(item.objectKey)) continue;
    if (planned.has(`${item.surface}\0${item.objectKey}`)) continue;
    if (item.surface === 'acl' && !aclComparable) {
      fail('POSTCHECK_ACL_BASELINE_INCOMPATIBLE', `out-of-scope ACL difference ${item.objectKey} cannot be compared across ACL fingerprint versions`);
    }
    const prior = before.get(`${item.surface}\0${item.objectKey}`);
    if (!prior) fail('POSTCHECK_NEW_PRODUCTION_DRIFT', `Production difference ${item.surface}:${item.objectKey} was not present before apply`);
    if ((prior.observedFingerprint ?? null) !== (item.observedFingerprint ?? null)) {
      fail('POSTCHECK_NEW_PRODUCTION_DRIFT', `Production difference ${item.surface}:${item.objectKey} changed since the pre-apply report`);
    }
  }
}

/**
 * @param {{
 *   report?: any,
 *   plan?: any,
 *   consistency?: any,
 *   migrationsUnchangedSincePlan?: boolean,
 *   preApplyReport?: any,
 *   preApplyCatalogs?: { expected: any, production: any },
 *   journal?: any,
 *   now?: string,
 * }} [input]
 */
export function finalizeProductionDbPostcheck({ report, plan, journal, consistency, migrationsUnchangedSincePlan = false, preApplyReport, preApplyCatalogs, now = new Date().toISOString() } = {}) {
  assertReleaseJournalMatchesPlan(journal, plan);
  if (journal.status !== 'APPLIED_CONFIRMED') fail('POSTCHECK_JOURNAL_NOT_APPLIED', `journal status is ${journal.status}`);
  try {
    verifyPostReport(report, plan, consistency, migrationsUnchangedSincePlan, preApplyReport, preApplyCatalogs);
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
