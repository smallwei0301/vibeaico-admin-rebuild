/*
 * Shared fail-closed contracts for schema truth evidence.
 *
 * This file does not connect to PostgreSQL and never changes a database. It
 * only normalizes evidence produced by a disposable proof runner so that a
 * report cannot silently treat an unknown replay order or a broken search as
 * proof of equivalence.
 */

const LEDGER_VERSION = /^(?:\d{4}|\d{8,20})$/;
const MIGRATION_IDENTITY = /^(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)$/;
const EVIDENCE_REF = /^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i;
const SUBJECT = /^[^\r\n|]{1,300}$/;
const FIELD_NAME = /^[a-z_][a-z0-9_]*$/;

export const SCHEMA_TRUTH_PROOF_POLICY_VERSION = 1;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function assertKeys(value, expected, label) {
  if (!isObject(value)) fail('INVALID_SCHEMA_TRUTH_PROOF', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) {
    fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
  }
}

function compareText(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function isMigrationLedgerVersion(value) {
  return typeof value === 'string' && LEDGER_VERSION.test(value);
}

/**
 * Compare PostgreSQL catalog key fields as a set. `pg_constraint.conkey` is
 * ordered data, while a compatibility check for an equivalent unique target
 * must compare the fields without mistaking declaration order for identity.
 */
export function sameKeySet(observed, expected) {
  const normalize = (value, label) => {
    if (!Array.isArray(value) || value.length === 0) fail('INVALID_KEY_SET', `${label} must be a non-empty array`);
    const fields = value.map((item, index) => {
      if (typeof item !== 'string' || item !== item.trim() || !FIELD_NAME.test(item)) {
        fail('INVALID_KEY_SET', `${label}[${index}] must be a PostgreSQL field name`);
      }
      return item;
    });
    if (new Set(fields).size !== fields.length) fail('DUPLICATE_KEY_FIELD', `${label} must not contain duplicate fields`);
    return fields.sort(compareText);
  };
  const left = normalize(observed, 'observed');
  const right = normalize(expected, 'expected');
  return left.length === right.length && left.every((field, index) => field === right[index]);
}

function normalizeMigrationIdentity(value, label) {
  if (typeof value !== 'string' || value !== value.trim() || !MIGRATION_IDENTITY.test(value)) {
    fail('INVALID_MIGRATION_IDENTITY', `${label} must be NNNN_name`);
  }
  return value;
}

function normalizeDependencyList(value, label) {
  if (!Array.isArray(value)) fail('INVALID_MIGRATION_DEPENDENCIES', `${label} must be an array`);
  const dependencies = value.map((item, index) => normalizeMigrationIdentity(item, `${label}[${index}]`));
  if (new Set(dependencies).size !== dependencies.length) {
    fail('DUPLICATE_MIGRATION_DEPENDENCY', `${label} contains a duplicate identity`);
  }
  return dependencies.sort(compareText);
}

/**
 * Validate and order an explicit migration replay dependency plan.
 *
 * A migration filename gives a replay position, but it does not prove that
 * the migration's prerequisites were included. The plan therefore requires
 * named dependencies and rejects unknown, forward, duplicate-prefix, and
 * cyclic edges before a report can call the replay order trustworthy.
 */
export function buildMigrationDependencyPlan(value, label = 'migrationDependencyPlan') {
  assertKeys(value, ['schemaVersion', 'migrations'], label);
  if (value.schemaVersion !== SCHEMA_TRUTH_PROOF_POLICY_VERSION) {
    fail('INVALID_MIGRATION_DEPENDENCY_PLAN', `${label}.schemaVersion is unsupported`);
  }
  if (!Array.isArray(value.migrations)) fail('INVALID_MIGRATION_DEPENDENCY_PLAN', `${label}.migrations must be an array`);
  if (value.migrations.length === 0) fail('EMPTY_MIGRATION_DEPENDENCY_PLAN', `${label}.migrations must not be empty`);

  const migrations = value.migrations.map((item, index) => {
    assertKeys(item, ['identity', 'dependsOn'], `${label}.migrations[${index}]`);
    return {
      identity: normalizeMigrationIdentity(item.identity, `${label}.migrations[${index}].identity`),
      dependsOn: normalizeDependencyList(item.dependsOn, `${label}.migrations[${index}].dependsOn`),
    };
  });

  if (new Set(migrations.map((item) => item.identity)).size !== migrations.length) {
    fail('DUPLICATE_MIGRATION_IDENTITY', `${label}.migrations must contain unique identities`);
  }
  const prefixes = migrations.map((item) => item.identity.slice(0, 4));
  if (new Set(prefixes).size !== prefixes.length) {
    fail('DUPLICATE_MIGRATION_PREFIX', `${label}.migrations must contain unique four-digit prefixes`);
  }

  const byIdentity = new Map(migrations.map((item) => [item.identity, item]));
  for (const migration of migrations) {
    const currentPrefix = Number(migration.identity.slice(0, 4));
    for (const dependency of migration.dependsOn) {
      if (!byIdentity.has(dependency)) {
        fail('UNKNOWN_MIGRATION_DEPENDENCY', `${migration.identity} depends on ${dependency}, which is not in the plan`);
      }
      if (dependency === migration.identity) {
        fail('INVALID_MIGRATION_DEPENDENCY_SELF', `${migration.identity} cannot depend on itself`);
      }
      if (Number(dependency.slice(0, 4)) >= currentPrefix) {
        fail('INVALID_MIGRATION_DEPENDENCY_ORDER', `${migration.identity} cannot depend on later migration ${dependency}`);
      }
    }
  }

  const indegree = new Map(migrations.map((item) => [item.identity, item.dependsOn.length]));
  const dependents = new Map(migrations.map((item) => [item.identity, []]));
  for (const migration of migrations) {
    for (const dependency of migration.dependsOn) dependents.get(dependency).push(migration.identity);
  }
  for (const identities of dependents.values()) identities.sort(compareText);

  const ready = migrations.filter((item) => indegree.get(item.identity) === 0).map((item) => item.identity).sort(compareText);
  const replayOrder = [];
  while (ready.length) {
    const identity = ready.shift();
    replayOrder.push(identity);
    for (const dependent of dependents.get(identity)) {
      indegree.set(dependent, indegree.get(dependent) - 1);
      if (indegree.get(dependent) === 0) {
        ready.push(dependent);
        ready.sort(compareText);
      }
    }
  }
  if (replayOrder.length !== migrations.length) {
    fail('CYCLIC_MIGRATION_DEPENDENCY', `${label} contains a dependency cycle`);
  }

  return {
    schemaVersion: SCHEMA_TRUTH_PROOF_POLICY_VERSION,
    status: 'PASS',
    migrations: [...migrations].sort((left, right) => compareText(left.identity, right.identity)),
    replayOrder,
  };
}

/**
 * A passing graph is not enough if it describes only part of the repository.
 * Compare it with the checked-in manifest before a report can call the replay
 * plan complete.
 */
export function ensureMigrationDependencyPlanCoverage(plan, migrationManifest, label = 'migrationDependencyPlan') {
  if (!isObject(plan) || !Array.isArray(plan.migrations)) {
    fail('INVALID_MIGRATION_DEPENDENCY_PLAN', `${label} must be a normalized migration dependency plan`);
  }
  if (!isObject(migrationManifest) || !Array.isArray(migrationManifest.files)) {
    fail('INVALID_MIGRATION_MANIFEST', 'migrationManifest.files must be an array');
  }
  const expected = migrationManifest.files.map((file, index) => {
    const filePath = typeof file?.path === 'string' ? file.path.replaceAll('\\', '/') : '';
    const match = /^supabase\/migrations\/(\d{4}_[a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/.exec(filePath);
    if (!match) fail('MIGRATION_MANIFEST_NOT_CANONICAL', `migrationManifest.files[${index}] must use NNNN_name.sql`);
    return match[1];
  }).sort(compareText);
  const actual = plan.migrations.map((item) => item.identity).sort(compareText);
  if (expected.length !== actual.length || expected.some((identity, index) => identity !== actual[index])) {
    fail('MIGRATION_DEPENDENCY_PLAN_COVERAGE_MISMATCH', `${label} must cover every checked-in migration exactly once`);
  }
  return plan;
}

function normalizeSubject(value, label) {
  if (typeof value !== 'string' || value !== value.trim() || !SUBJECT.test(value)) {
    fail('INVALID_PROOF_SUBJECT', `${label} must be a compact single-line subject`);
  }
  return value;
}

function normalizeEvidenceRef(value, label) {
  if (typeof value !== 'string' || value !== value.trim() || !EVIDENCE_REF.test(value) || value.includes('://')) {
    fail('INVALID_EVIDENCE_REF', `${label} must be a compact non-secret evidence reference`);
  }
  return value;
}

function normalizeBoolean(value, label) {
  if (typeof value !== 'boolean') fail('INVALID_PROOF_RESULT', `${label} must be boolean`);
  return value;
}

function normalizePresenceControl(value, label, expected, errorCode) {
  assertKeys(value, ['subject', 'found', 'evidenceRef'], label);
  const subject = normalizeSubject(value.subject, `${label}.subject`);
  const found = normalizeBoolean(value.found, `${label}.found`);
  const evidenceRef = normalizeEvidenceRef(value.evidenceRef, `${label}.evidenceRef`);
  if (found !== expected) fail(errorCode, `${label} expected found=${expected}`);
  return { subject, found, evidenceRef };
}

/**
 * Require all three controls that make a schema search trustworthy:
 * a known-present object must be found, a known-absent object must stay absent,
 * and a deliberate mutation must change the observation.
 */
export function normalizeSchemaProofControls(value, label = 'proofControls') {
  assertKeys(value, ['schemaVersion', 'positive', 'negative', 'mutation', 'keySetComparison'], label);
  if (value.schemaVersion !== SCHEMA_TRUTH_PROOF_POLICY_VERSION) {
    fail('INVALID_SCHEMA_TRUTH_PROOF', `${label}.schemaVersion is unsupported`);
  }
  const positive = normalizePresenceControl(value.positive, `${label}.positive`, true, 'PROOF_POSITIVE_CONTROL_FAILED');
  const negative = normalizePresenceControl(value.negative, `${label}.negative`, false, 'PROOF_NEGATIVE_CONTROL_FAILED');

  assertKeys(value.mutation, ['subject', 'baselineFound', 'mutatedFound', 'evidenceRef'], `${label}.mutation`);
  const mutation = {
    subject: normalizeSubject(value.mutation.subject, `${label}.mutation.subject`),
    baselineFound: normalizeBoolean(value.mutation.baselineFound, `${label}.mutation.baselineFound`),
    mutatedFound: normalizeBoolean(value.mutation.mutatedFound, `${label}.mutation.mutatedFound`),
    evidenceRef: normalizeEvidenceRef(value.mutation.evidenceRef, `${label}.mutation.evidenceRef`),
  };
  if (mutation.baselineFound !== true || mutation.mutatedFound !== false) {
    fail('PROOF_MUTATION_CONTROL_FAILED', `${label}.mutation must change found=true to found=false`);
  }

  assertKeys(value.keySetComparison, ['observed', 'expected', 'equivalent'], `${label}.keySetComparison`);
  if (typeof value.keySetComparison.equivalent !== 'boolean') {
    fail('INVALID_PROOF_RESULT', `${label}.keySetComparison.equivalent must be boolean`);
  }
  const equivalent = sameKeySet(value.keySetComparison.observed, value.keySetComparison.expected);
  const observed = [...value.keySetComparison.observed];
  const expected = [...value.keySetComparison.expected];
  if (value.keySetComparison.equivalent !== equivalent) {
    fail('PROOF_KEY_SET_COMPARISON_FAILED', `${label}.keySetComparison.equivalent does not match the field sets`);
  }

  return {
    schemaVersion: SCHEMA_TRUTH_PROOF_POLICY_VERSION,
    status: 'PASS',
    positive,
    negative,
    mutation,
    keySetComparison: { observed, expected, equivalent },
  };
}
