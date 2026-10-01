import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { normalizeObserverSnapshot, compareObserverSnapshots } from './schema-drift-watch.mjs';
import { stableStringify } from './schema-truth-evidence.mjs';
import { normalizeProductionDbImpactManifest } from './production-db-impact-manifest.mjs';
import { verifyProductionDbReleasePlan } from './production-db-release-plan.mjs';

export const FINALWRITER_SCOPE = 'ISSUE_46_0110_0135_CLOSURE';
export const FINALWRITER_ROOTS = Object.freeze([
  "0110_issue_42_plan_duration_pricetype_yearround",
  "0111_issue_46_guide_request_accept",
  "0115_issue_21_external_calendars",
  "0128_issue_42_plan_seasonal_pricing",
  "0130_issue_46_refund_policy_snapshot",
  "0132_issue_42_seasonal_price_resolution",
  "0135_issue_46_guide_interval_availability"
]);
const REVIEWED_SQL = Object.freeze({
  "0110_issue_42_plan_duration_pricetype_yearround": "5cf235c64f03911bedc0484876bc69a3042aacde31f42d8417a875f47809ab6a",
  "0111_issue_46_guide_request_accept": "702d3d742fe6f58b591c4fc326bae6ce821c0c3054141d6f1fdca066dca5403e",
  "0115_issue_21_external_calendars": "f4723514bdbef386a773d917996c1621f143b670d477cddd82987dc971e31d45",
  "0128_issue_42_plan_seasonal_pricing": "30cbdaf739bcfb89a9f6dad014088a497f418c12c1cc4a84ebfd107ad9ae2da2",
  "0130_issue_46_refund_policy_snapshot": "80bf6037cebfff14d9b04072e95e15d5d5448784ca079c99c4bac07ffd5a796d",
  "0132_issue_42_seasonal_price_resolution": "3dffdfee7350d87f62ca07b5508abb7cd29171e491ae1330f9f03bdc8666268c",
  "0135_issue_46_guide_interval_availability": "c798b1596d149d1f866553bf8736bea7214fc7bd0531ea750f2511a17d39a59d"
});
export const FINALWRITER_ROUTINE = "public.create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone)";

const REVIEWED_IMPACTS_DIGEST = 'd605c8fe366fdce6098b48851a8d2445385b4331627462c585e5d4677f851db4';
const WRITERS = [FINALWRITER_ROOTS[0], FINALWRITER_ROOTS[1], FINALWRITER_ROOTS[4], FINALWRITER_ROOTS[5]];
const fingerprint = (value) => createHash('sha256').update(stableStringify(value)).digest('hex');
const sqlDigest = (value) => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { const error = new Error(`${code}: ${message}`); error.code = code; throw error; };
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
const itemMap = (snapshot) => new Map([
  ...Object.entries(snapshot.surfaces).flatMap(([surface, value]) => value.items.map((item) => [`${surface}:${item.key}`, item.fingerprint])),
  ...snapshot.acl.items.map((item) => [`acl:${item.key}`, item.fingerprint]),
]);

// The transport is a same-run artifact from the trusted-main reusable observer.
// Snapshot digests alone never establish that canonical SQL was replayed.
function verifyTransport({ provenance, expectedSnapshot, testSnapshot, productionSnapshot, report }, plan) {
  const env = process.env;
  if (env.GITHUB_ACTIONS !== 'true' || env.GITHUB_REF !== 'refs/heads/main' ||
      env.GITHUB_REPOSITORY !== plan.repository || env.GITHUB_SHA !== plan.mainSha ||
      env.GITHUB_WORKFLOW !== 'production-db-release-orchestrator' ||
      !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') || !/^\d+$/.test(env.GITHUB_RUN_ATTEMPT ?? '')) {
    fail('TRUSTED_MAIN_TRANSPORT_REQUIRED', 'only the exact-main orchestrator may consume the same-run observer artifact');
  }
  if (!provenance || provenance.schemaVersion !== 1 || provenance.repository !== plan.repository ||
      provenance.mainSha !== plan.mainSha || provenance.ref !== 'refs/heads/main' ||
      provenance.runId !== env.GITHUB_RUN_ID || provenance.runAttempt !== env.GITHUB_RUN_ATTEMPT ||
      provenance.producer !== '.github/workflows/agent-schema-drift-watch.yml' || provenance.artifactSuffix !== 'g2' ||
      provenance.replay !== 'TRUSTED_MAIN_FRESH_INSTALL_BASELINE' || provenance.databaseMutationAuthorized !== false) {
    fail('OBSERVER_PROVENANCE_MISMATCH', 'fresh replay / same-run artifact identity is absent or mismatched');
  }
  if (git('rev-parse', 'origin/main').trim() !== plan.mainSha) fail('CANONICAL_MAIN_MISMATCH', 'canonical SQL must be current origin/main');
  const canonicalNames = git('ls-tree', '--name-only', `${plan.mainSha}:supabase/migrations`).trim().split('\n').sort();
  const canonical = canonicalNames.map((name) => ({ name, digest: sqlDigest(git('show', `${plan.mainSha}:supabase/migrations/${name}`)) }));
  if (provenance.canonicalSourceDigest !== fingerprint(canonical)) fail('FRESH_CANONICAL_SOURCE_MISMATCH', 'observer replay source is not current-main canonical SQL');
  const replay = provenance.freshReplayEvidence;
  if (Object.values(provenance.outcomes ?? {}).length !== 3 || ['freshReplay', 'localCapture', 'remoteCapture'].some((step) => provenance.outcomes?.[step] !== 'success') ||
      provenance.localProjectId !== `schema-proof-observer-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT}-g2` ||
      replay?.observedHead !== plan.mainSha || replay?.profile !== 'FRESH_INSTALL_COMPATIBILITY_BASELINE' || replay?.candidateOverlayIncluded !== false ||
      replay?.remoteDatabaseUsed !== false || replay?.canonicalApproved !== false || !Array.isArray(replay?.files) ||
      replay.sourceManifestSha256 !== sqlDigest(JSON.stringify(replay.files))) fail('FRESH_REPLAY_PROOF_REQUIRED', 'actual successful disposable replay/capture evidence is required');
  const replayCanonical = replay.files.filter((file) => file.origin === 'CANONICAL').map((file) => ({ name: file.name, digest: file.sha256 })).sort((a, b) => a.name.localeCompare(b.name));
  if (fingerprint(replayCanonical) !== fingerprint(canonical) || replay.files.filter((file) => file.origin === 'CANONICAL').some((file) => file.sourcePath !== `supabase/migrations/${file.name}`)) fail('FRESH_REPLAY_SOURCE_MISMATCH', 'actual replayed canonical files must equal current-main SQL');
  for (const [name, packet] of Object.entries({ expectedSnapshot, testSnapshot, productionSnapshot, report })) {
    if (provenance.packetDigests?.[name] !== fingerprint(packet)) fail('OBSERVER_PACKET_TAMPERED', `${name} is not the producer artifact`);
  }
}

/** A derived, release-scoped reconciliation; the raw observer report is retained unchanged. */
export function reconcileFinalwriterConsistency({ plan, report, impactManifest, observerBundle } = {}) {
  if (plan?.migrationScope !== FINALWRITER_SCOPE || !observerBundle) fail('FINALWRITER_PACKETS_REQUIRED', 'exact seven scope requires full trusted observer packets');
  verifyTransport({ ...observerBundle, report }, plan);
  const readCanonicalSql = (path) => git('show', `${plan.mainSha}:${path}`);
  const aliasMap = JSON.parse(readCanonicalSql('supabase/ledger-alias-map.json'));
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  if (plan.migrations.map((migration) => migration.repoFile).join('\n') !== FINALWRITER_ROOTS.join('\n')) fail('FINALWRITER_ORDER_MISMATCH', 'only the exact ordered seven closure is admitted');
  for (const root of FINALWRITER_ROOTS) {
    if (sqlDigest(readCanonicalSql(`supabase/migrations/${root}.sql`)) !== REVIEWED_SQL[root]) fail('FINALWRITER_SQL_CHANGED', `${root} differs from the reviewed canonical source`);
  }
  const main = plan.mainSha;
  const expected = normalizeObserverSnapshot(observerBundle.expectedSnapshot, main);
  const test = normalizeObserverSnapshot(observerBundle.testSnapshot, main);
  const production = normalizeObserverSnapshot(observerBundle.productionSnapshot, main);
  if (expected.environment !== 'LOCAL_EXPECTED' || test.environment !== 'TEST' || production.environment !== 'PRODUCTION') fail('OBSERVER_ENVIRONMENT_MISMATCH', 'three packets must have their exact identities');
  const exceptions = JSON.parse(readCanonicalSql('docs/schema-truth/schema-drift-exceptions.json')).exceptions;
  const recomputed = compareObserverSnapshots({ expectedSnapshot: expected, testSnapshot: test, productionSnapshot: production, currentMainSha: main, exceptions });
  if (fingerprint(recomputed) !== fingerprint(report)) fail('OBSERVER_REPORT_MISMATCH', 'raw report is not the exact current packet comparison');
  if (recomputed.status === 'EVIDENCE_UNAVAILABLE' || recomputed.environmentStatuses?.TEST !== 'MATCH' ||
      (recomputed.exceptionSummary?.matched ?? 0) || (recomputed.exceptionSummary?.unmatched ?? 0) || (recomputed.exceptionSummary?.expired ?? 0)) fail('CANONICAL_TEST_REQUIRED', 'fresh evidence and full canonical TEST match are required without exceptions');
  const expectedItems = itemMap(expected);
  const testItems = itemMap(test);
  if (fingerprint([...expectedItems]) !== fingerprint([...testItems]) ||
      fingerprint(expected.migrationLedger.identities) !== fingerprint(test.migrationLedger.identities)) fail('CANONICAL_TEST_REQUIRED', 'all TEST objects and ledger identities must match fresh canonical replay');
  for (const snapshot of [expected, test, production]) {
    const orderSignatures = snapshot.surfaces.routines.items.filter((item) => item.key.startsWith('public.create_tour_order('));
    if (orderSignatures.length !== 1 || orderSignatures[0].key !== FINALWRITER_ROUTINE) fail('UNIQUE_TEN_ARGUMENT_ROUTINE_REQUIRED', 'reviewed 0099 alias requires one exact routine identity');
  }
  const normalized = normalizeProductionDbImpactManifest(impactManifest);
  const selectedImpacts = normalized.entries.filter((entry) => FINALWRITER_ROOTS.includes(entry.repoFile)).sort((a, b) => a.repoFile.localeCompare(b.repoFile));
  if (fingerprint(selectedImpacts) !== REVIEWED_IMPACTS_DIGEST) fail('FINALWRITER_IMPACTS_CHANGED', 'exact reviewed impact roots are required');
  const entries = new Map(normalized.entries.map((entry) => [entry.repoFile, entry]));
  const owners = new Map();
  for (const root of FINALWRITER_ROOTS) {
    const entry = entries.get(root);
    if (!entry) fail('MISSING_IMPACT_MANIFEST_ENTRY', root);
    for (const impact of entry.impacts) {
      const key = `${impact.surface}:${impact.objectKey}`;
      if (!expectedItems.has(key)) fail('MISSING_EXPECTED_IMPACT', `${key} absent from canonical fresh state`);
      owners.set(key, [...(owners.get(key) ?? []), root]);
    }
  }
  const repeated = [`routines:${FINALWRITER_ROUTINE}`, `acl:function:${FINALWRITER_ROUTINE}`];
  for (const [key, roots] of owners) {
    if (roots.length > 1 && (!repeated.includes(key) || roots.join('\n') !== WRITERS.join('\n'))) fail('AMBIGUOUS_IMPACT_OWNERSHIP', key);
  }
  for (const key of repeated) if (owners.get(key)?.join('\n') !== WRITERS.join('\n')) fail('FINALWRITER_LINEAGE_REQUIRED', key);
  const productionItems = itemMap(production);
  const differences = [];
  for (const key of new Set([...expectedItems.keys(), ...productionItems.keys()])) {
    const wanted = expectedItems.get(key) ?? null;
    const actual = productionItems.get(key) ?? null;
    if (wanted === actual) continue;
    if (!wanted || !owners.has(key)) fail('UNPLANNED_PRODUCTION_DIFF', key);
    // Existing shape/RLS/ACL drift is never disguised as additive rollout.
    // Only the explicitly declared routine-body replacements may differ in place.
    if (actual !== null && !key.startsWith('routines:')) fail('EXISTING_PRODUCTION_SHAPE_DRIFT', key);
    differences.push({ key, expectedFingerprint: wanted, observedFingerprint: actual, finalWriter: owners.get(key).at(-1) });
  }
  const identityKey = (item) => `${item.version}/${item.name}`;
  const expectedLedger = new Map(expected.migrationLedger.identities.map((item) => [identityKey(item), item]));
  const legacyName = '0099_drop_legacy_create_tour_order_overload';
  const canonicalLegacy = expected.migrationLedger.identities.filter((item) => item.name === legacyName);
  const observedAliases = production.migrationLedger.identities.filter((item) => item.name === 'drop_legacy_create_tour_order_overload');
  if (observedAliases.length > 1 || (observedAliases.length && (canonicalLegacy.length !== 1 || production.migrationLedger.identities.some((item) => item.name === legacyName)))) fail('REVIEWED_0099_ALIAS_MISMATCH', 'only one literal legacy alias is admitted');
  const actualLedger = new Set(production.migrationLedger.identities.map((item) => item.name === 'drop_legacy_create_tour_order_overload' ? identityKey(canonicalLegacy[0]) : identityKey(item)));
  for (const key of actualLedger) if (!expectedLedger.has(key)) fail('UNPLANNED_PRODUCTION_LEDGER', key);
  const missingLedger = [...expectedLedger].filter(([key]) => !actualLedger.has(key)).map(([, item]) => item);
  if (missingLedger.length !== FINALWRITER_ROOTS.length || missingLedger.map((item) => item.name).sort().join('\n') !== [...FINALWRITER_ROOTS].sort().join('\n')) fail('EXACT_PENDING_IDENTITIES_REQUIRED', 'only the selected seven canonical identities may be absent');
  return {
    status: 'CONSISTENCY_VERIFIED', reconciliation: 'EXACT_SEVEN_FINALWRITER_0132', mainSha: main, planDigest: plan.planDigest,
    impactManifestDigest: fingerprint(normalized), observerCaptureDigests: { expected: expected.captureDigest, TEST: test.captureDigest, PRODUCTION: production.captureDigest },
    rawReportDigest: fingerprint(report), rawReportStatus: report.status, rawDifferences: report.differences,
    resolvedProductionDifferences: differences, pendingCanonicalIdentities: missingLedger,
    reviewed0099Aliases: observedAliases,
    finalWriter: FINALWRITER_ROOTS[5], plannedProductionDifferenceCount: differences.length + missingLedger.length,
    intentionalDifferenceCount: 0, unexplainedDifferences: 0, observedAt: new Date(Math.min(Date.parse(expected.observedAt), Date.parse(test.observedAt), Date.parse(production.observedAt))).toISOString(),
    databaseMutationAuthorized: false,
  };
}
