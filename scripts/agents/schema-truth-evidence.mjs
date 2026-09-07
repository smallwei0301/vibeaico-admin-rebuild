import crypto from 'node:crypto';

export const EVIDENCE_SCHEMA_VERSION = 1;
export const METADATA_QUERY_VERSION = 'public-schema-metadata-v1';
export const EXPECTED_PROJECT_REFS = Object.freeze({
  TEST: 'nmwhwngojosmagjuvxol',
  PRODUCTION: 'egehnijjpgijmccagxac',
});
export const SURFACES = Object.freeze([
  'columns',
  'constraints',
  'indexes',
  'views',
  'policies',
  'routines',
  'triggers',
]);

const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const ROLE = /^(?:[a-z_][a-z0-9_]*|public)$/;
const PRIVILEGES = new Set([
  'SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN', 'EXECUTE',
]);

/*
 * This is a read-only metadata query contract. It deliberately reads catalog
 * metadata, not application rows. A capture runner must store the query
 * version and digest alongside its result so a later review can reproduce the
 * exact normalization boundary instead of trusting a count-only checkpoint.
 */
export const PUBLIC_SCHEMA_METADATA_SQL = `
WITH items AS (
  SELECT
    'columns'::text AS surface,
    n.nspname || '.' || c.relname || '.' || a.attname AS item_key,
    format_type(a.atttypid, a.atttypmod) || '|' ||
      a.attnotnull::text || '|' ||
      COALESCE(pg_get_expr(ad.adbin, ad.adrelid), '') AS item_value
  FROM pg_attribute AS a
  JOIN pg_class AS c ON c.oid = a.attrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  LEFT JOIN pg_attrdef AS ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
  WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
    AND a.attnum > 0 AND NOT a.attisdropped
  UNION ALL
  SELECT 'constraints', n.nspname || '.' || c.relname || '.' || con.conname,
    con.contype::text || '|' || pg_get_constraintdef(con.oid, true)
  FROM pg_constraint AS con
  JOIN pg_class AS c ON c.oid = con.conrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'indexes', ns.nspname || '.' || tbl.relname || '.' || idx.relname,
    pg_get_indexdef(idx.oid)
  FROM pg_index AS ix
  JOIN pg_class AS idx ON idx.oid = ix.indexrelid
  JOIN pg_class AS tbl ON tbl.oid = ix.indrelid
  JOIN pg_namespace AS ns ON ns.oid = tbl.relnamespace
  WHERE ns.nspname = 'public' AND idx.relkind = 'i'
  UNION ALL
  SELECT 'views', n.nspname || '.' || c.relname,
    c.relkind::text || '|' || COALESCE(array_to_string(c.reloptions, ','), '') || '|' ||
      COALESCE(pg_get_viewdef(c.oid, true), '')
  FROM pg_class AS c
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND c.relkind IN ('v', 'm')
  UNION ALL
  SELECT 'policies', n.nspname || '.' || c.relname || '.' || p.polname,
    p.polpermissive::text || '|' || p.polcmd::text || '|' ||
      COALESCE(array_to_string(ARRAY(
        SELECT role_name
        FROM (
          SELECT CASE WHEN role_oid = 0 THEN 'public' ELSE pg_get_userbyid(role_oid) END AS role_name
          FROM unnest(p.polroles) AS role_oid
        ) AS policy_roles
        ORDER BY role_name COLLATE "C"
      ), ','), '') || '|' ||
      COALESCE(pg_get_expr(p.polqual, p.polrelid), '') || '|' ||
      COALESCE(pg_get_expr(p.polwithcheck, p.polrelid), '')
  FROM pg_policy AS p
  JOIN pg_class AS c ON c.oid = p.polrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
  UNION ALL
  SELECT 'routines', n.nspname || '.' || p.proname || '('
      || pg_get_function_identity_arguments(p.oid) || ')',
    p.prokind::text || '|' || p.provolatile::text || '|' || p.prosecdef::text || '|' ||
      COALESCE(array_to_string(p.proconfig, ','), '') || '|' ||
      md5(pg_get_functiondef(p.oid))
  FROM pg_proc AS p
  JOIN pg_namespace AS n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
  UNION ALL
  SELECT 'triggers', n.nspname || '.' || c.relname || '.' || t.tgname,
    t.tgenabled::text || '|' || pg_get_triggerdef(t.oid, true)
  FROM pg_trigger AS t
  JOIN pg_class AS c ON c.oid = t.tgrelid
  JOIN pg_namespace AS n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public' AND NOT t.tgisinternal
)
SELECT json_build_object(
  'counts', (SELECT json_object_agg(surface, count_value)
             FROM (SELECT surface, count(*) AS count_value FROM items GROUP BY surface) AS q),
  'items', COALESCE((SELECT json_agg(json_build_object(
      'surface', surface, 'key', item_key, 'value', item_value
    ) ORDER BY surface, item_key) FROM items), '[]'::json)
) AS snapshot;
`;

export const ACL_METADATA_SQL = `
SELECT json_build_object(
  'tables', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'name', c.relname,
      'rowSecurity', c.relrowsecurity, 'forceRowSecurity', c.relforcerowsecurity,
      'policyCount', (SELECT count(*) FROM pg_policy AS p WHERE p.polrelid = c.oid),
      'privileges', COALESCE((SELECT json_agg(json_build_object(
        'grantee', CASE WHEN acl.grantee = 0 THEN 'public' ELSE pg_get_userbyid(acl.grantee) END,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) ORDER BY acl.grantee, acl.privilege_type)
      FROM aclexplode(COALESCE(c.relacl, pg_catalog.acldefault('r', c.relowner))) AS acl), '[]'::json)
    ) ORDER BY n.nspname, c.relname)
    FROM pg_class AS c
    JOIN pg_namespace AS n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f')), '[]'::json),
  'functions', COALESCE((SELECT json_agg(json_build_object(
      'schema', n.nspname, 'name', p.proname,
      'identityArguments', pg_get_function_identity_arguments(p.oid),
      'owner', pg_get_userbyid(p.proowner), 'securityDefiner', p.prosecdef,
      'privileges', COALESCE((SELECT json_agg(json_build_object(
        'grantee', CASE WHEN acl.grantee = 0 THEN 'public' ELSE pg_get_userbyid(acl.grantee) END,
        'privilege', acl.privilege_type,
        'grantable', acl.is_grantable
      ) ORDER BY acl.grantee, acl.privilege_type)
      FROM aclexplode(COALESCE(p.proacl, pg_catalog.acldefault('f', p.proowner))) AS acl
      WHERE acl.privilege_type = 'EXECUTE'), '[]'::json)
    ) ORDER BY n.nspname, p.proname, pg_get_function_identity_arguments(p.oid))
    FROM pg_proc AS p
    JOIN pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')), '[]'::json)
) AS snapshot;
`;

export const MIGRATION_LEDGER_SQL = `
SELECT version, name
FROM supabase_migrations.schema_migrations
ORDER BY version;
`;

export const METADATA_QUERY_DIGEST = digestFor({
  metadata: PUBLIC_SCHEMA_METADATA_SQL,
  acl: ACL_METADATA_SQL,
  ledger: MIGRATION_LEDGER_SQL,
});

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function digestFor(value) {
  return { algorithm: 'SHA256', value: sha256(stableStringify(value)) };
}

function assertKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_EVIDENCE', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) {
    fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
  }
}

function normalizeSha(value, label) {
  const sha = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA.test(sha)) fail('INVALID_MAIN_SHA', `${label} must be a 40-character SHA`);
  return sha;
}

function normalizeDigest(value, label) {
  assertKeys(value, ['algorithm', 'value'], label);
  const algorithm = typeof value.algorithm === 'string' ? value.algorithm.trim().toUpperCase() : '';
  const digest = typeof value.value === 'string' ? value.value.trim().toLowerCase() : '';
  if (algorithm !== 'SHA256' || !DIGEST.test(digest)) fail('INVALID_DIGEST', `${label} must be SHA256`);
  return { algorithm, value: digest };
}

function normalizeEvidenceRef(value, label) {
  if (typeof value !== 'string' || value !== value.trim() ||
      !/^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i.test(value) || value.includes('://')) {
    fail('INVALID_EVIDENCE_REF', `${label} must be a compact non-secret evidence reference`);
  }
  return value;
}

function normalizeObservedAt(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = ISO_UTC.exec(text);
  if (!match) fail('INVALID_OBSERVED_AT', 'observedAt must be an ISO UTC timestamp');
  const [year, month, day, hour, minute, second] = match.slice(1, 7).map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day || parsed.getUTCHours() !== hour ||
    parsed.getUTCMinutes() !== minute || parsed.getUTCSeconds() !== second
  ) fail('INVALID_OBSERVED_AT', 'observedAt must be a valid UTC calendar timestamp');
  return text;
}

function normalizeMigrationLedger(value) {
  assertKeys(value, ['state', 'identities', 'digest'], 'migrationLedger');
  if (value.state !== 'PRESENT') fail('INVALID_LEDGER_STATE', 'migrationLedger.state must be PRESENT');
  if (!Array.isArray(value.identities) || value.identities.length === 0) {
    fail('INVALID_LEDGER_IDENTITIES', 'migrationLedger.identities must be non-empty');
  }
  const identities = value.identities.map((identity, index) => {
    assertKeys(identity, ['version', 'name'], `migrationLedger.identities[${index}]`);
    const version = typeof identity.version === 'string' ? identity.version.trim() : '';
    const name = typeof identity.name === 'string' ? identity.name.trim() : '';
    if (!/^\d{8,20}$/.test(version) || !/^[A-Za-z0-9._-]{1,160}$/.test(name)) {
      fail('INVALID_LEDGER_IDENTITY', `migrationLedger.identities[${index}] is invalid`);
    }
    return { version, name };
  }).sort((left, right) => left.version.localeCompare(right.version) || left.name.localeCompare(right.name));
  const identityKeys = identities.map((identity) => `${identity.version}\u0000${identity.name}`);
  if (new Set(identityKeys).size !== identityKeys.length) fail('DUPLICATE_LEDGER_IDENTITY', 'migration identities must be unique');
  const digest = normalizeDigest(value.digest, 'migrationLedger.digest');
  const expected = digestFor(identities);
  if (digest.value !== expected.value) fail('LEDGER_DIGEST_MISMATCH', 'migration digest does not match identities');
  return { state: 'PRESENT', identities, digest };
}

function normalizeSurfaces(value) {
  assertKeys(value, SURFACES, 'surfaces');
  const normalized = {};
  for (const surface of SURFACES) {
    const item = value[surface];
    assertKeys(item, ['count', 'digest'], `surfaces.${surface}`);
    if (!Number.isInteger(item.count) || item.count < 0) fail('INVALID_SURFACE_COUNT', `surfaces.${surface}.count is invalid`);
    normalized[surface] = { count: item.count, digest: normalizeDigest(item.digest, `surfaces.${surface}.digest`) };
  }
  return normalized;
}

function normalizeRole(value, label) {
  const role = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!ROLE.test(role)) fail('INVALID_ACL_ROLE', `${label} is invalid`);
  return role;
}

function normalizePrivileges(value, label) {
  if (!Array.isArray(value)) fail('INVALID_ACL_PRIVILEGES', `${label} must be an array`);
  const privileges = value.map((item, index) => {
    assertKeys(item, ['grantee', 'privilege', 'grantable'], `${label}[${index}]`);
    const privilege = typeof item.privilege === 'string' ? item.privilege.trim().toUpperCase() : '';
    if (!PRIVILEGES.has(privilege)) fail('INVALID_ACL_PRIVILEGE', `${label}[${index}].privilege is invalid`);
    if (typeof item.grantable !== 'boolean') fail('INVALID_ACL_GRANTABLE', `${label}[${index}].grantable must be boolean`);
    return { grantee: normalizeRole(item.grantee, `${label}[${index}].grantee`), privilege, grantable: item.grantable };
  }).sort((left, right) => `${left.grantee}|${left.privilege}`.localeCompare(`${right.grantee}|${right.privilege}`));
  const keys = privileges.map((item) => `${item.grantee}|${item.privilege}`);
  if (new Set(keys).size !== keys.length) fail('DUPLICATE_ACL_PRIVILEGE', `${label} contains a duplicate privilege`);
  return privileges;
}

function normalizeAcl(value) {
  assertKeys(value, ['tables', 'functions'], 'acl');
  if (!Array.isArray(value.tables) || !Array.isArray(value.functions)) fail('INVALID_ACL', 'acl tables/functions must be arrays');
  const tables = value.tables.map((table, index) => {
    assertKeys(table, ['schema', 'name', 'rowSecurity', 'forceRowSecurity', 'policyCount', 'privileges'], `acl.tables[${index}]`);
    if (table.schema !== 'public' || typeof table.name !== 'string' || !IDENTIFIER.test(table.name)) fail('INVALID_ACL_TABLE', `acl.tables[${index}] is invalid`);
    if (typeof table.rowSecurity !== 'boolean' || typeof table.forceRowSecurity !== 'boolean' || !Number.isInteger(table.policyCount) || table.policyCount < 0) {
      fail('INVALID_ACL_TABLE_SECURITY', `acl.tables[${index}] security metadata is invalid`);
    }
    return {
      schema: 'public', name: table.name, rowSecurity: table.rowSecurity,
      forceRowSecurity: table.forceRowSecurity, policyCount: table.policyCount,
      privileges: normalizePrivileges(table.privileges, `acl.tables[${index}].privileges`),
    };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const tableKeys = tables.map((item) => `${item.schema}.${item.name}`);
  if (new Set(tableKeys).size !== tableKeys.length) fail('DUPLICATE_ACL_TABLE', 'acl.tables contains a duplicate table');

  const functions = value.functions.map((fn, index) => {
    assertKeys(fn, ['schema', 'name', 'identityArguments', 'owner', 'securityDefiner', 'privileges'], `acl.functions[${index}]`);
    if (fn.schema !== 'public' || typeof fn.name !== 'string' || !IDENTIFIER.test(fn.name)) fail('INVALID_ACL_FUNCTION', `acl.functions[${index}] is invalid`);
    if (typeof fn.identityArguments !== 'string' || fn.identityArguments.length > 1000 || /[\0\r\n]/.test(fn.identityArguments)) fail('INVALID_ACL_FUNCTION_ARGS', `acl.functions[${index}].identityArguments is invalid`);
    if (typeof fn.owner !== 'string' || !ROLE.test(fn.owner.toLowerCase())) fail('INVALID_ACL_OWNER', `acl.functions[${index}].owner is invalid`);
    if (typeof fn.securityDefiner !== 'boolean') fail('INVALID_ACL_SECURITY_DEFINER', `acl.functions[${index}].securityDefiner must be boolean`);
    return {
      schema: 'public', name: fn.name, identityArguments: fn.identityArguments,
      owner: fn.owner, securityDefiner: fn.securityDefiner,
      privileges: normalizePrivileges(fn.privileges, `acl.functions[${index}].privileges`),
    };
  }).sort((left, right) => `${left.name}(${left.identityArguments})`.localeCompare(`${right.name}(${right.identityArguments})`));
  const functionKeys = functions.map((item) => `${item.schema}.${item.name}(${item.identityArguments})`);
  if (new Set(functionKeys).size !== functionKeys.length) fail('DUPLICATE_ACL_FUNCTION', 'acl.functions contains a duplicate function');
  return { tables, functions };
}

function normalizeCaptureDigest(value, packetWithoutDigest) {
  const digest = normalizeDigest(value, 'captureDigest');
  const expected = digestFor(packetWithoutDigest);
  if (digest.value !== expected.value) fail('CAPTURE_DIGEST_MISMATCH', 'captureDigest does not match normalized evidence');
  return digest;
}

export function normalizeMetadataEvidencePacket(value, currentMainSha) {
  const mainSha = normalizeSha(currentMainSha, 'currentMainSha');
  assertKeys(value, [
    'schemaVersion', 'queryVersion', 'queryDigest', 'environment', 'projectRef', 'observedAt',
    'observedMainSha', 'evidenceRef', 'migrationLedger', 'surfaces', 'acl', 'rawDataIncluded', 'captureDigest',
  ], 'evidencePacket');
  if (value.schemaVersion !== EVIDENCE_SCHEMA_VERSION) fail('INVALID_SCHEMA_VERSION', 'schemaVersion is unsupported');
  if (value.queryVersion !== METADATA_QUERY_VERSION) fail('INVALID_QUERY_VERSION', 'queryVersion is unsupported');
  const queryDigest = normalizeDigest(value.queryDigest, 'queryDigest');
  if (queryDigest.value !== METADATA_QUERY_DIGEST.value) fail('QUERY_DIGEST_MISMATCH', 'queryDigest does not match the checked-in metadata query contract');
  if (value.environment !== 'TEST' && value.environment !== 'PRODUCTION') fail('INVALID_ENVIRONMENT', 'environment is invalid');
  if (value.projectRef !== EXPECTED_PROJECT_REFS[value.environment]) fail('PROJECT_REF_MISMATCH', 'projectRef is not the pinned environment');
  const observedMainSha = normalizeSha(value.observedMainSha, 'observedMainSha');
  if (observedMainSha !== mainSha) fail('STALE_MAIN_SHA', `observedMainSha must match ${mainSha}`);
  if (value.rawDataIncluded !== false) fail('RAW_DATA_FORBIDDEN', 'evidence packets must not contain raw application data');
  const normalized = {
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    queryVersion: METADATA_QUERY_VERSION,
    queryDigest,
    environment: value.environment,
    projectRef: value.projectRef,
    observedAt: normalizeObservedAt(value.observedAt),
    observedMainSha,
    evidenceRef: normalizeEvidenceRef(value.evidenceRef, 'evidenceRef'),
    migrationLedger: normalizeMigrationLedger(value.migrationLedger),
    surfaces: normalizeSurfaces(value.surfaces),
    acl: normalizeAcl(value.acl),
    rawDataIncluded: false,
  };
  return { ...normalized, captureDigest: normalizeCaptureDigest(value.captureDigest, normalized) };
}

export function compareMetadataEvidence({ testPacket, productionPacket, currentMainSha }) {
  const test = normalizeMetadataEvidencePacket(testPacket, currentMainSha);
  const production = normalizeMetadataEvidencePacket(productionPacket, currentMainSha);
  if (test.environment !== 'TEST' || production.environment !== 'PRODUCTION') {
    fail('ENVIRONMENT_PAIR_MISMATCH', 'compareMetadataEvidence requires TEST then PRODUCTION packets');
  }
  if (test.queryDigest.value !== production.queryDigest.value) fail('QUERY_CONTRACT_MISMATCH', 'TEST and Production query contracts differ');
  const surfaces = Object.fromEntries(SURFACES.map((surface) => [
    surface,
    test.surfaces[surface].count === production.surfaces[surface].count &&
    test.surfaces[surface].digest.value === production.surfaces[surface].digest.value
      ? 'MATCH' : 'ENVIRONMENT_DIFF',
  ]));
  const ledger = test.migrationLedger.digest.value === production.migrationLedger.digest.value ? 'MATCH' : 'ENVIRONMENT_DIFF';
  const acl = stableStringify(test.acl) === stableStringify(production.acl) ? 'MATCH' : 'ENVIRONMENT_DIFF';
  const overall = ledger === 'MATCH' && acl === 'MATCH' && Object.values(surfaces).every((status) => status === 'MATCH')
    ? 'MATCH' : 'DRIFT_OBSERVED';
  return {
    observedMainSha: normalizeSha(currentMainSha, 'currentMainSha'),
    overall,
    migrationLedger: ledger,
    publicObjects: surfaces,
    acl,
    captureDigests: { TEST: test.captureDigest, PRODUCTION: production.captureDigest },
  };
}
