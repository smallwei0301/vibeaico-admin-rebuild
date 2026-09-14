import { createHash } from 'node:crypto';

import { normalizeProductionDbImpactManifest } from './production-db-impact-manifest.mjs';

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function signature(item) {
  return createHash('sha256').update(JSON.stringify([
    item?.surface ?? '', item?.objectKey ?? '', item?.expectedFingerprint ?? '', item?.observedFingerprint ?? null,
  ])).digest('hex');
}

function impactManifestDigest(manifest) {
  const normalized = normalizeProductionDbImpactManifest(manifest);
  const entries = normalized.entries
    .map((entry) => ({
      repoFile: entry.repoFile,
      impacts: [...entry.impacts].sort((a, b) => `${a.surface}:${a.objectKey}`.localeCompare(`${b.surface}:${b.objectKey}`)),
    }))
    .sort((a, b) => a.repoFile.localeCompare(b.repoFile));
  return createHash('sha256').update(JSON.stringify({ schemaVersion: 1, entries })).digest('hex');
}

function plannedProductionDifferences({ report, plan, impactManifest }) {
  if (!plan || !Array.isArray(plan.migrations) || plan.migrations.length === 0) fail('CONSISTENCY_PLAN_REQUIRED', 'release plan migrations are required');
  const normalized = normalizeProductionDbImpactManifest(impactManifest);
  const byFile = new Map(normalized.entries.map((entry) => [entry.repoFile, entry]));
  const allowed = new Map();

  for (const migration of plan.migrations) {
    const repoFile = String(migration?.repoFile ?? '').trim();
    const entry = byFile.get(repoFile);
    if (!entry) fail('MISSING_IMPACT_MANIFEST_ENTRY', `${repoFile || '<unknown>'} has no impact manifest entry`);
    for (const impact of entry.impacts) {
      const key = `${impact.surface}:${impact.objectKey}`;
      const owner = allowed.get(key);
      if (owner && owner !== repoFile) fail('AMBIGUOUS_IMPACT_OWNERSHIP', `${key} belongs to multiple migrations`);
      allowed.set(key, repoFile);
    }
  }

  const pending = (report.differences ?? []).filter(
    (item) => item.environment === 'PRODUCTION' && item.classification === 'EXPECTED_PENDING_PRODUCTION',
  );
  for (const item of pending) {
    const key = `${item.surface}:${item.objectKey}`;
    if (!allowed.has(key)) fail('UNPLANNED_PRODUCTION_DIFF', `${key} is outside this release impact manifest`);
  }
  return pending;
}

export function buildProductionConsistencyEvidence({ report, plan, impactManifest, mainSha, planDigest }) {
  if (!report || report.observedMainSha !== mainSha) fail('CONSISTENCY_MAIN_MISMATCH', 'drift report is not for the selected main SHA');
  if (!plan || plan.mainSha !== mainSha || plan.planDigest !== planDigest) fail('CONSISTENCY_PLAN_MISMATCH', 'release plan is not the selected main SHA / plan digest');
  if (report.safety?.authorizesDatabaseWrite !== false) fail('OBSERVER_SCOPE_ESCALATION', 'drift observer must stay read-only');
  if (report.status === 'DRIFT_BLOCKED' || report.status === 'EVIDENCE_UNAVAILABLE') fail('DRIFT_BLOCKED', `drift report status is ${report.status}`);
  if ((report.exceptionSummary?.expired ?? 0) > 0 || (report.exceptionSummary?.unmatched ?? 0) > 0) fail('STALE_DRIFT_EXCEPTION', 'drift exceptions must be active and matched');

  const testStatus = report.environmentStatuses?.TEST;
  if (!['MATCH', 'INTENTIONAL_DIFFERENCE'].includes(testStatus)) fail('TEST_SCHEMA_NOT_READY', `TEST status is ${testStatus ?? 'UNKNOWN'}`);
  const productionStatus = report.environmentStatuses?.PRODUCTION;
  if (!['MATCH', 'EXPECTED_PENDING_PRODUCTION', 'INTENTIONAL_DIFFERENCE'].includes(productionStatus)) fail('PRODUCTION_SCHEMA_UNEXPLAINED', `Production status is ${productionStatus ?? 'UNKNOWN'}`);

  const planned = plannedProductionDifferences({ report, plan, impactManifest });
  const plannedSignatures = new Set(planned.map(signature));
  const pending = (report.differences ?? []).filter((item) => item.environment === 'PRODUCTION' && item.classification === 'EXPECTED_PENDING_PRODUCTION');
  const intentional = (report.differences ?? []).filter((item) => item.classification === 'INTENTIONAL_DIFFERENCE');
  if (intentional.some((item) => !item.exception?.issue || !item.exception?.expiresAt)) fail('UNBOUND_INTENTIONAL_DIFFERENCE', 'intentional difference lacks durable exception evidence');
  if (pending.some((item) => !plannedSignatures.has(signature(item)))) fail('UNPLANNED_PRODUCTION_DIFF', 'Production has a pending difference outside this release plan');

  const observed = [report.environments?.TEST?.observedAt, report.environments?.PRODUCTION?.observedAt]
    .map((value) => Date.parse(String(value ?? ''))).filter(Number.isFinite);
  if (observed.length !== 2) fail('MISSING_OBSERVED_AT', 'TEST and Production observedAt are required');

  return {
    status: 'CONSISTENCY_VERIFIED', mainSha, planDigest,
    impactManifestDigest: impactManifestDigest(impactManifest),
    observedAt: new Date(Math.min(...observed)).toISOString(),
    plannedProductionDifferenceCount: pending.length,
    intentionalDifferenceCount: intentional.length,
    unexplainedDifferences: 0,
    databaseMutationAuthorized: false,
  };
}
