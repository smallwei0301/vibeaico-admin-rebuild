/*
 * Source-only, fixed-scope evidence for #698.
 *
 * This module deliberately consumes the existing schema observer's normalized
 * packets. It never connects to PostgreSQL and cannot authorize a write.
 * `SCOPED_CONSISTENCY_VERIFIED` is evidence for this fixed source-only scope;
 * it must never substitute a Production writer-path `CONSISTENCY_VERIFIED`.
 */
import {
  compareObserverSnapshots,
  normalizeObserverSnapshot,
} from './schema-drift-watch.mjs';

const G2_TABLES = Object.freeze(['booking_addons', 'staff', 'bookings', 'services']);
const G2_FUNCTIONS = Object.freeze([
  'function:public.create_booking_addon(p_tenant uuid, p_booking uuid, p_idempotency_key text, p_service_id uuid, p_name text, p_price numeric, p_quantity integer, p_duration_minutes integer, p_staff_id uuid, p_performance_mode text, p_performance_staff_id uuid, p_notification_requested boolean)',
  'function:public.delete_booking_addon(p_tenant uuid, p_addon uuid)',
]);
const G2_ROUTINES = Object.freeze(G2_FUNCTIONS.map((key) => key.slice('function:'.length)));
const REQUIRED_METADATA = Object.freeze({
  columns: Object.freeze([
    ...G2_TABLES.map((table) => `public.${table}.id`),
    'public.booking_addons.performance_staff_id',
    'public.booking_addons.performance_mode',
    'public.booking_addons.tenant_id',
    'public.booking_addons.idempotency_key',
    'public.booking_addons.notification_requested',
    'public.booking_addons.deleted_at',
    'public.booking_addons.updated_at',
    'public.staff.tenant_id',
  ]),
  constraints: Object.freeze([
    'public.booking_addons.booking_addons_performance_staff_id_fkey',
    'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey',
    'public.staff.staff_tenant_id_id_key',
  ]),
  routines: G2_ROUTINES,
});
const G2_CONDITIONS = Object.freeze({
  exactExpectedFingerprint: 'G2_FIXED_SCOPE_EXACT_EXPECTED_FINGERPRINT',
  source0133ForeignKeys: 'G2_0133_FOREIGN_KEY_SHAPES',
});

function isScopeKey(surface, objectKey) {
  if (surface === 'acl') return G2_TABLES.some((table) => objectKey === `table:public.${table}`) || G2_FUNCTIONS.includes(objectKey);
  if (surface === 'routines') return G2_ROUTINES.includes(objectKey);
  return G2_TABLES.some((table) => objectKey.startsWith(`public.${table}.`));
}

function scopedDifferences(fullReport) {
  return (fullReport.differences ?? []).filter(({ surface, objectKey }) => isScopeKey(surface, objectKey))
    .map((difference) => ({ ...difference, requiredCondition: G2_CONDITIONS.exactExpectedFingerprint }));
}

function requiredPresence(snapshot, environment) {
  if (snapshot.status !== 'CAPTURED') return [];
  const missing = [];
  for (const [surface, keys] of Object.entries(REQUIRED_METADATA)) {
    const observed = new Set(snapshot.surfaces[surface].items.map((item) => item.key));
    for (const objectKey of keys) if (!observed.has(objectKey)) missing.push({ environment, surface, objectKey });
  }
  const acl = new Set(snapshot.acl.items.map((item) => item.key));
  for (const table of G2_TABLES) {
    const objectKey = `table:public.${table}`;
    // The table ACL fingerprint includes rowSecurity and forceRowSecurity, so
    // this fixed key is the required RLS/ACL evidence for each table.
    if (!acl.has(objectKey)) missing.push({ environment, surface: 'acl', objectKey });
  }
  for (const objectKey of G2_FUNCTIONS) if (!acl.has(objectKey)) missing.push({ environment, surface: 'acl', objectKey });
  return missing.map((difference) => ({ ...difference, expectedFingerprint: null, observedFingerprint: null,
    classification: null, exception: null, requiredCondition: 'G2_REQUIRED_CLOSURE_PRESENT' }));
}

function sourceText(source) {
  if (typeof source !== 'string') throw new Error('G2_SOURCE_INVALID: migration source must be text');
  // A source proof must inspect executable SQL only; comments may describe a
  // contract but cannot satisfy it.
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\r\n]*/g, '').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Checks the two only allowed #0133 FK forms in migration source.  It does not
 * infer a database state or permit any other delete action.
 */
export function validate0133CompositeForeignKeySource(source) {
  const text = sourceText(source);
  const single = /foreign key \(performance_staff_id\) references public\.staff \(id\) on delete set null/.test(text);
  const compositeNoAction = /foreign key \(tenant_id, performance_staff_id\) references public\.staff \(tenant_id, id\) on delete no action/.test(text);
  const compositeSetNull = /confdeltype = 'n' and fk\.confdelsetcols = array\[child_perf\]::smallint\[\]/.test(text);
  const rejectsOtherComposite = /fk\.confdeltype = 'a'.*fk\.confdelsetcols is null.*or.*fk\.confdeltype = 'n'.*fk\.confdelsetcols = array\[child_perf\]::smallint\[\]/.test(text);
  const onlyKnownDeleteCodes = !/confdeltype = '[^an]'/.test(text);
  return {
    status: single && compositeNoAction && compositeSetNull && rejectsOtherComposite && onlyKnownDeleteCodes ? 'VALID' : 'BLOCKED',
    condition: G2_CONDITIONS.source0133ForeignKeys,
    singleDeleteAction: single ? 'SET_NULL' : null,
    compositeDeleteActions: compositeNoAction && compositeSetNull ? ['NO_ACTION', 'SET_NULL_PERFORMANCE_STAFF_ID'] : [],
    rejectsOtherComposite: rejectsOtherComposite && onlyKnownDeleteCodes,
  };
}

/**
 * A display-only mapping. Provider version/name remain unchanged in the
 * normalized evidence; the mapping simply recognizes source-style names.
 */
export function deriveProviderLedgerIdentityView(snapshot, currentMainSha) {
  const normalized = normalizeObserverSnapshot(snapshot, currentMainSha);
  if (normalized.status !== 'CAPTURED') return [];
  return normalized.migrationLedger.identities.map(({ version, name }) => ({
    providerVersion: version,
    providerName: name,
    sourceIdentity: /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name) ? name : null,
    mapping: /^\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*$/.test(name) ? 'DERIVED_FROM_PROVIDER_NAME' : 'UNMAPPED_PROVIDER_NAME',
  }));
}

/**
 * Compare the entire observer result first, then expose only the fixed #698
 * closure. Callers cannot select a scope or supply exceptions.
 */
/** @param {{ expectedSnapshot:any, testSnapshot:any, productionSnapshot:any, currentMainSha:string, now?:number, maxEvidenceAgeMinutes?:number, migration0133Source:string }} input */
export function buildScopedG2Proof(input) {
  const { expectedSnapshot, testSnapshot, productionSnapshot, currentMainSha, now = undefined, maxEvidenceAgeMinutes = undefined, migration0133Source } = input;
  const fullReport = compareObserverSnapshots({
    expectedSnapshot,
    testSnapshot,
    productionSnapshot,
    currentMainSha,
    exceptions: [],
    ...(now === undefined ? {} : { now }),
    ...(maxEvidenceAgeMinutes === undefined ? {} : { maxEvidenceAgeMinutes }),
  });
  const expected = normalizeObserverSnapshot(expectedSnapshot, currentMainSha);
  const test = normalizeObserverSnapshot(testSnapshot, currentMainSha);
  const production = normalizeObserverSnapshot(productionSnapshot, currentMainSha);
  const source0133 = validate0133CompositeForeignKeySource(migration0133Source);
  const differences = [
    ...scopedDifferences(fullReport),
    ...requiredPresence(expected, 'expected'),
    ...requiredPresence(test, 'TEST'),
    ...requiredPresence(production, 'PRODUCTION'),
  ];
  const captures = Object.fromEntries([
    ['expected', expected], ['TEST', test], ['PRODUCTION', production],
  ].map(([environment, snapshot]) => [environment, snapshot.status === 'CAPTURED'
    ? { captureDigest: snapshot.captureDigest, queryDigest: snapshot.queryDigest, observedMainSha: snapshot.observedMainSha, evidenceRef: snapshot.evidenceRef }
    : { status: snapshot.status, evidenceRef: snapshot.evidenceRef }]));

  let status = 'SCOPED_CONSISTENCY_VERIFIED';
  if (fullReport.status === 'EVIDENCE_UNAVAILABLE') status = 'EVIDENCE_UNAVAILABLE';
  else if (source0133.status !== 'VALID' || differences.length > 0) status = 'SCOPED_DRIFT_BLOCKED';
  else if (fullReport.status !== 'MATCH') status = 'GLOBAL_STATUS_NOT_VERIFIED';

  return {
    schemaVersion: 1,
    status,
    fixedScope: {
      tables: G2_TABLES,
      tableAclKeys: G2_TABLES.map((table) => `table:public.${table}`),
      functionAclKeys: G2_FUNCTIONS,
      requiredMetadata: REQUIRED_METADATA,
      rlsEvidence: G2_TABLES.map((table) => `table:public.${table}`),
      requiredCondition: G2_CONDITIONS.exactExpectedFingerprint,
    },
    fullReport,
    fullReportRef: {
      type: 'EMBEDDED_FULL_REPORT',
      observedMainSha: fullReport.observedMainSha,
      status: fullReport.status,
      differenceCount: fullReport.differenceCount,
    },
    source0133,
    scopedDifferences: differences,
    captures,
    providerLedgerView: {
      expected: deriveProviderLedgerIdentityView(expectedSnapshot, currentMainSha),
      TEST: deriveProviderLedgerIdentityView(testSnapshot, currentMainSha),
      PRODUCTION: deriveProviderLedgerIdentityView(productionSnapshot, currentMainSha),
    },
    safety: {
      authorizesDatabaseWrite: false,
      fullEnvironmentParityProven: false,
      rawDataIncluded: false,
      writerPathEligible: false,
      substitutesWriterConsistencyVerified: false,
    },
  };
}
