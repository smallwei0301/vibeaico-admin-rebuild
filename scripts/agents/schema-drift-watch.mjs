import { fileURLToPath } from 'node:url';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postgres from 'postgres';
import {
  ACL_METADATA_SQL, EXPECTED_PROJECT_REFS, METADATA_QUERY_DIGEST, METADATA_QUERY_VERSION,
  MIGRATION_LEDGER_SQL, PUBLIC_SCHEMA_METADATA_SQL, SURFACES, normalizeMetadataEvidencePacket,
  sha256, stableStringify,
} from './schema-truth-evidence.mjs';
import { isMigrationLedgerVersion } from './schema-truth-proof-policy.mjs';
// Version 2 is intentionally separate from schema-truth-evidence's v1 packet:
// it adds LOCAL_EXPECTED and object-level fingerprints for the live observer.
export const DRIFT_WATCH_SCHEMA_VERSION = 2;
export const DRIFT_STATUSES = Object.freeze([
  'MATCH', 'EXPECTED_PENDING_TEST', 'EXPECTED_PENDING_PRODUCTION',
  'INTENTIONAL_DIFFERENCE', 'DRIFT_BLOCKED', 'EVIDENCE_UNAVAILABLE',
]);
export const LOCAL_EXPECTED_ENVIRONMENT = 'LOCAL_EXPECTED';
const SHA = /^[0-9a-f]{40}$/;
const DIGEST = /^[0-9a-f]{64}$/;
const ISO_UTC = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?Z$/;
const ALL_SURFACES = Object.freeze([...SURFACES, 'acl']);
const SCHEMA_OBSERVER_ROLE = 'schema_observer';
const SESSION_POOLER_HOSTS = Object.freeze({
  TEST: /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/i,
  PRODUCTION: /^aws-\d+-ap-southeast-1\.pooler\.supabase\.com$/i,
});
const EXCEPTION_CLASSES = new Set(['INTENTIONAL_DIFFERENCE', 'EXPECTED_PENDING_TEST', 'EXPECTED_PENDING_PRODUCTION']);
const stripSql = (sql) => sql.trim().replace(/;\s*$/, '');
export const READ_ONLY_SNAPSHOT_SQL = `
SELECT json_build_object(
  'metadata', (SELECT snapshot FROM (${stripSql(PUBLIC_SCHEMA_METADATA_SQL)}) AS metadata_row),
  'acl', (SELECT snapshot FROM (${stripSql(ACL_METADATA_SQL)}) AS acl_row),
  'ledger', COALESCE((SELECT json_agg(json_build_object('version', version::text, 'name', name)
    ORDER BY version, name) FROM (${stripSql(MIGRATION_LEDGER_SQL)}) AS ledger_rows), '[]'::json)
) AS snapshot;
`;
function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}
function decodeUsername(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { fail('MALFORMED_SCHEMA_OBSERVER_URL', 'observer username is not valid URL encoding'); }
}
function assertObserverTls(parsed) {
  const entries = [...parsed.searchParams.entries()];
  if (parsed.hash || entries.length !== 1 || entries[0][0] !== 'sslmode' || String(entries[0][1]).toLowerCase() !== 'verify-full') {
    fail('SCHEMA_OBSERVER_TLS_VERIFICATION_REQUIRED', 'observer URL must use exactly sslmode=verify-full');
  }
}

function normalizeObserverConnectionString(raw) {
  const value = String(raw ?? '').trim();
  const match = /^(postgres(?:ql)?:\/\/)([^/?#]*)(\/[^?#]*)?(\?.*)?$/i.exec(value);
  if (!match) return value;
  const authority = match[2];
  const hostSeparator = authority.lastIndexOf('@');
  if (hostSeparator < 0) return value;
  const userInfo = authority.slice(0, hostSeparator);
  const colon = userInfo.indexOf(':');
  if (colon < 0) return value;
  const username = userInfo.slice(0, colon);
  const password = userInfo.slice(colon + 1);
  if (!password.includes('@')) return value;
  return `${match[1]}${username}:${encodeURIComponent(password)}@${authority.slice(hostSeparator + 1)}${match[3] ?? ''}${match[4] ?? ''}`;
}
/**
 * A direct observer connection is an alternate transport for the exact same
 * read-only snapshot contract. It deliberately binds both project and role.
 */
export function parseProjectBoundSchemaObserverUrl(connectionString, environment) {
  const env = String(environment ?? '').trim().toUpperCase();
  const projectRef = EXPECTED_PROJECT_REFS[env];
  if (!projectRef || !SESSION_POOLER_HOSTS[env]) fail('SCHEMA_OBSERVER_ENVIRONMENT_INVALID', 'observer environment must be TEST or PRODUCTION');
  const raw = normalizeObserverConnectionString(connectionString);
  if (!raw) fail('MISSING_SCHEMA_OBSERVER_URL', 'schema observer connection URL is required');
  let parsed;
  try { parsed = new URL(raw); } catch { fail('MALFORMED_SCHEMA_OBSERVER_URL', 'schema observer URL is not a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('MALFORMED_SCHEMA_OBSERVER_URL', 'schema observer URL must use postgres/postgresql protocol');
  if (String(parsed.port || '5432') !== '5432') fail('SCHEMA_OBSERVER_SESSION_MODE_REQUIRED', 'observer URL must use session/direct port 5432');
  if ((parsed.pathname || '/postgres').replace(/^\//, '') !== 'postgres') fail('SCHEMA_OBSERVER_DATABASE_MISMATCH', 'observer URL must target the postgres database');
  if (!SESSION_POOLER_HOSTS[env].test(String(parsed.hostname ?? ''))) fail('SCHEMA_OBSERVER_URL_PROJECT_MISMATCH', 'observer host does not match the requested environment');
  if (decodeUsername(parsed.username) !== `${SCHEMA_OBSERVER_ROLE}.${projectRef}`) fail('SCHEMA_OBSERVER_ROLE_MISMATCH', 'observer URL must use the dedicated schema_observer role for this project');
  if (!parsed.password) fail('SCHEMA_OBSERVER_PASSWORD_REQUIRED', 'observer URL requires a dedicated role password');
  assertObserverTls(parsed);
  return { environment: env, projectRef, role: SCHEMA_OBSERVER_ROLE, transportMode: 'SUPAVISOR_SESSION', connectionString: raw };
}
async function querySnapshotViaPostgres({ connectionString, query, readOnly }) {
  if (readOnly !== true) fail('SCHEMA_OBSERVER_WRITE_FORBIDDEN', 'schema observer may only execute a read-only query');
  const sql = postgres(connectionString, { max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 });
  try {
    const rows = await sql.begin(async (transaction) => {
      await transaction.unsafe('set local transaction read only');
      return transaction.unsafe(query);
    });
    return unwrapSnapshot(rows);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
export function parseLocalSchemaObserverUrl(connectionString) {
  const raw = String(connectionString ?? '').trim();
  if (!raw) fail('MISSING_LOCAL_SCHEMA_OBSERVER_URL', 'Supabase CLI local DB_URL is required');
  let parsed;
  try { parsed = new URL(raw); } catch { fail('MALFORMED_LOCAL_SCHEMA_OBSERVER_URL', 'local DB_URL is not a valid PostgreSQL URL'); }
  const host = String(parsed.hostname ?? '').toLowerCase();
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) ||
      !['127.0.0.1', 'localhost', '[::1]'].includes(host) ||
      parsed.username !== 'postgres' || (parsed.pathname || '/postgres') !== '/postgres' || parsed.search || parsed.hash) {
    fail('LOCAL_SCHEMA_OBSERVER_TARGET_INVALID', 'local observer URL must target the local postgres database over loopback');
  }
  return raw;
}
/**
 * @param {{ connectionString?: string, directQuery?: (input: { connectionString: string, query: string, readOnly: boolean }) => Promise<unknown> }} options
 */
export async function captureLocalExpectedSnapshot({ connectionString, directQuery = querySnapshotViaPostgres } = {}) {
  const localConnectionString = parseLocalSchemaObserverUrl(connectionString);
  return directQuery({ connectionString: localConnectionString, query: READ_ONLY_SNAPSHOT_SQL, readOnly: true });
}
function observerConnectionStringFor(environment, value) {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^postgres(?:ql)?:\/\//i.test(raw)) return raw;
  if (!raw.startsWith('{')) return null;
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('MALFORMED_SCHEMA_OBSERVER_CREDENTIAL', 'observer credential map is not valid JSON'); }
  const expectedKeys = ['PRODUCTION', 'TEST'];
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || Object.keys(parsed).sort().join('|') !== expectedKeys.join('|')) {
    fail('MALFORMED_SCHEMA_OBSERVER_CREDENTIAL', 'observer credential map must contain exactly TEST and PRODUCTION');
  }
  const connectionString = parsed[environment];
  if (typeof connectionString !== 'string' || !connectionString.trim()) fail('MALFORMED_SCHEMA_OBSERVER_CREDENTIAL', `observer credential map has no ${environment} connection`);
  return connectionString.trim();
}
function assertKeys(value, expected, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_EVIDENCE', `${label} must be an object`);
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.join('\n') !== wanted.join('\n')) fail('UNKNOWN_OR_MISSING_FIELD', `${label} keys must be exactly: ${wanted.join(', ')}`);
}
function digest(value) { return { algorithm: 'SHA256', value: sha256(stableStringify(value)) }; }
function validSha(value, label) {
  const result = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA.test(result)) fail('INVALID_MAIN_SHA', `${label} must be a 40-character SHA`);
  return result;
}
function validDigest(value, label) {
  assertKeys(value, ['algorithm', 'value'], label);
  const algorithm = String(value.algorithm ?? '').trim().toUpperCase();
  const result = String(value.value ?? '').trim().toLowerCase();
  if (algorithm !== 'SHA256' || !DIGEST.test(result)) fail('INVALID_DIGEST', `${label} must be SHA256`);
  return { algorithm, value: result };
}
function validTime(value, label) {
  const text = typeof value === 'string' ? value.trim() : '';
  const match = ISO_UTC.exec(text);
  if (!match) fail('INVALID_OBSERVED_AT', `${label} must be an ISO UTC timestamp`);
  const parts = match.slice(1, 7).map(Number);
  const date = new Date(Date.UTC(...[parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]]));
  if (date.getUTCFullYear() !== parts[0] || date.getUTCMonth() !== parts[1] - 1 || date.getUTCDate() !== parts[2] ||
      date.getUTCHours() !== parts[3] || date.getUTCMinutes() !== parts[4] || date.getUTCSeconds() !== parts[5]) {
    fail('INVALID_OBSERVED_AT', `${label} is not a valid UTC calendar timestamp`);
  }
  return text;
}
function validEvidenceRef(value) {
  if (typeof value !== 'string' || value !== value.trim() || value.includes('://') ||
      !/^[a-z][a-z0-9+.-]*:[A-Za-z0-9._/#:-]{1,299}$/i.test(value)) fail('INVALID_EVIDENCE_REF', 'evidenceRef is invalid');
  return value;
}
function compareText(left, right) { return left < right ? -1 : left > right ? 1 : 0; }
function cloneJson(value) {
  try { return JSON.parse(JSON.stringify(value)); } catch { fail('INVALID_EVIDENCE', 'evidence is not JSON'); }
}
function normalizeRawMetadata(value) {
  assertKeys(value, ['counts', 'items'], 'raw.metadata');
  if (!Array.isArray(value.items)) fail('INVALID_METADATA_ITEMS', 'raw.metadata.items must be an array');
  const items = Object.fromEntries(SURFACES.map((surface) => [surface, []]));
  value.items.forEach((item, index) => {
    assertKeys(item, ['surface', 'key', 'value'], `raw.metadata.items[${index}]`);
    if (!SURFACES.includes(item.surface) || typeof item.key !== 'string' || !item.key.trim() || item.key.length > 1024 ||
        typeof item.value !== 'string' || item.value.length > 128 * 1024 || /\0/.test(item.value)) {
      fail('INVALID_METADATA_ITEM', `raw.metadata.items[${index}] is invalid`);
    }
    items[item.surface].push({ key: item.key, fingerprint: sha256(item.value) });
  });
  for (const surface of SURFACES) {
    items[surface].sort((left, right) => compareText(left.key, right.key));
    if (new Set(items[surface].map((item) => item.key)).size !== items[surface].length) fail('DUPLICATE_METADATA_ITEM', `${surface} contains a duplicate key`);
  }
  if (value.counts !== null) {
    if (!value.counts || typeof value.counts !== 'object' || Array.isArray(value.counts)) fail('INVALID_METADATA_COUNTS', 'raw.metadata.counts must be an object or null');
    for (const key of Object.keys(value.counts)) if (!SURFACES.includes(key)) fail('UNKNOWN_METADATA_SURFACE', `${key} is not an approved surface`);
    for (const surface of SURFACES) {
      if (value.counts[surface] !== undefined && value.counts[surface] !== items[surface].length) fail('METADATA_COUNT_MISMATCH', `${surface} count does not match items`);
    }
  }
  return items;
}
function normalizeLedgerRows(value) {
  if (!Array.isArray(value) || value.length === 0) fail('MIGRATION_LEDGER_UNAVAILABLE', 'migration ledger is missing or empty');
  const identities = value.map((item, index) => {
    assertKeys(item, ['version', 'name'], `raw.ledger[${index}]`);
    const version = typeof item.version === 'string' ? item.version.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!isMigrationLedgerVersion(version) || !/^[A-Za-z0-9._-]{1,160}$/.test(name)) fail('INVALID_LEDGER_IDENTITY', `raw.ledger[${index}] is invalid`);
    return { version, name };
  }).sort((left, right) => compareText(left.version, right.version) || compareText(left.name, right.name));
  if (new Set(identities.map((item) => `${item.version}\0${item.name}`)).size !== identities.length) fail('DUPLICATE_LEDGER_IDENTITY', 'raw.ledger contains a duplicate');
  return identities;
}
function sortAcl(value) {
  const acl = cloneJson(value);
  const privilegeOrder = (left, right) => compareText(`${left.grantee}|${left.privilege}`, `${right.grantee}|${right.privilege}`);
  acl.tables.sort((left, right) => compareText(left.name, right.name));
  acl.functions.sort((left, right) => compareText(`${left.name}(${left.identityArguments})`, `${right.name}(${right.identityArguments})`));
  acl.tables.forEach((table) => table.privileges.sort(privilegeOrder));
  acl.functions.forEach((fn) => fn.privileges.sort(privilegeOrder));
  return acl;
}
function aclItems(acl) {
  const items = [
    ...acl.tables.map((item) => ({ key: `table:${item.schema}.${item.name}`, fingerprint: sha256(stableStringify(item)) })),
    ...acl.functions.map((item) => ({ key: `function:${item.schema}.${item.name}(${item.identityArguments})`, fingerprint: sha256(stableStringify(item)) })),
  ];
  return items.sort((left, right) => compareText(left.key, right.key));
}
function outputSnapshot({ normalized, environment, projectRef, metadataItems, acl }) {
  const surfaces = Object.fromEntries(SURFACES.map((surface) => {
    const items = metadataItems[surface];
    return [surface, { count: items.length, digest: digest(items), items }];
  }));
  const aclEntries = aclItems(acl);
  const core = {
    schemaVersion: DRIFT_WATCH_SCHEMA_VERSION, status: 'CAPTURED', queryVersion: normalized.queryVersion,
    queryDigest: normalized.queryDigest, environment, projectRef, observedAt: normalized.observedAt,
    observedMainSha: normalized.observedMainSha, evidenceRef: normalized.evidenceRef,
    migrationLedger: normalized.migrationLedger, surfaces, acl: { count: aclEntries.length, digest: digest(aclEntries), items: aclEntries },
    rawDataIncluded: false,
  };
  return { ...core, captureDigest: digest(core) };
}
export function buildObserverSnapshotFromRaw({ environment, projectRef, observedAt, observedMainSha, evidenceRef, raw }) {
  const target = environment === LOCAL_EXPECTED_ENVIRONMENT ? 'TEST' : environment;
  if (![LOCAL_EXPECTED_ENVIRONMENT, 'TEST', 'PRODUCTION'].includes(environment)) fail('INVALID_ENVIRONMENT', 'environment is invalid');
  const expectedRef = environment === LOCAL_EXPECTED_ENVIRONMENT ? 'local-fresh' : EXPECTED_PROJECT_REFS[environment];
  if (projectRef !== expectedRef) fail('PROJECT_REF_MISMATCH', 'projectRef is not the pinned environment');
  assertKeys(raw, ['metadata', 'acl', 'ledger'], 'raw snapshot');
  const metadataItems = normalizeRawMetadata(raw.metadata);
  const identities = normalizeLedgerRows(raw.ledger);
  const migrationLedger = { state: 'PRESENT', identities, digest: digest(identities) };
  const surfaces = Object.fromEntries(SURFACES.map((surface) => [surface, { count: metadataItems[surface].length, digest: digest(metadataItems[surface]) }]));
  const acl = sortAcl(raw.acl);
  const packet = {
    schemaVersion: 1, queryVersion: METADATA_QUERY_VERSION, queryDigest: METADATA_QUERY_DIGEST,
    environment: target, projectRef: EXPECTED_PROJECT_REFS[target], observedAt, observedMainSha, evidenceRef,
    migrationLedger, surfaces, acl, rawDataIncluded: false,
  };
  const normalized = normalizeMetadataEvidencePacket({ ...packet, captureDigest: digest(packet) }, observedMainSha);
  return outputSnapshot({ normalized, environment, projectRef, metadataItems, acl: normalized.acl });
}
export function buildUnavailableSnapshot({ environment, observedAt = new Date().toISOString(), observedMainSha, reason }) {
  if (![LOCAL_EXPECTED_ENVIRONMENT, 'TEST', 'PRODUCTION'].includes(environment)) fail('INVALID_ENVIRONMENT', 'environment is invalid');
  const projectRef = environment === LOCAL_EXPECTED_ENVIRONMENT ? 'local-fresh' : EXPECTED_PROJECT_REFS[environment];
  const code = typeof reason === 'string' ? reason.trim().replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 120) : '';
  if (!code) fail('INVALID_UNAVAILABLE_REASON', 'reason is required');
  return { schemaVersion: DRIFT_WATCH_SCHEMA_VERSION, status: 'EVIDENCE_UNAVAILABLE', environment, projectRef,
    observedAt: validTime(observedAt, 'observedAt'), observedMainSha: validSha(observedMainSha, 'observedMainSha'),
    evidenceRef: environment === LOCAL_EXPECTED_ENVIRONMENT ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`, reason: code };
}
function normalizeLedgerOutput(value) {
  assertKeys(value, ['state', 'identities', 'digest'], 'migrationLedger');
  if (value.state !== 'PRESENT' || !Array.isArray(value.identities) || value.identities.length === 0) fail('INVALID_LEDGER_EVIDENCE', 'migrationLedger must be PRESENT and non-empty');
  const identities = value.identities.map((item, index) => {
    assertKeys(item, ['version', 'name'], `migrationLedger.identities[${index}]`);
    const version = typeof item.version === 'string' ? item.version.trim() : '';
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    if (!isMigrationLedgerVersion(version) || !/^[A-Za-z0-9._-]{1,160}$/.test(name)) fail('INVALID_LEDGER_IDENTITY', `migrationLedger.identities[${index}] is invalid`);
    return { version, name };
  }).sort((left, right) => compareText(left.version, right.version) || compareText(left.name, right.name));
  if (new Set(identities.map((item) => `${item.version}\0${item.name}`)).size !== identities.length) fail('DUPLICATE_LEDGER_IDENTITY', 'migrationLedger identities are not unique');
  const ledger = { state: 'PRESENT', identities, digest: validDigest(value.digest, 'migrationLedger.digest') };
  if (ledger.digest.value !== digest(identities).value) fail('LEDGER_DIGEST_MISMATCH', 'migrationLedger digest does not match identities');
  return ledger;
}
function normalizeHashedItems(value, label) {
  if (!Array.isArray(value)) fail('INVALID_HASHED_ITEMS', `${label}.items must be an array`);
  const items = value.map((item, index) => {
    assertKeys(item, ['key', 'fingerprint'], `${label}.items[${index}]`);
    if (typeof item.key !== 'string' || !item.key.trim() || item.key.length > 2048 || /[\0\r\n]/.test(item.key)) fail('INVALID_HASHED_ITEM', `${label}.items[${index}].key is invalid`);
    const fingerprint = validDigest({ algorithm: 'SHA256', value: item.fingerprint }, `${label}.items[${index}].fingerprint`).value;
    return { key: item.key, fingerprint };
  }).sort((left, right) => compareText(left.key, right.key));
  if (new Set(items.map((item) => item.key)).size !== items.length) fail('DUPLICATE_HASHED_ITEM', `${label}.items contains a duplicate key`);
  return items;
}
export function normalizeObserverSnapshot(value, currentMainSha) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_SNAPSHOT', 'snapshot must be an object');
  if (value.status === 'EVIDENCE_UNAVAILABLE') {
    assertKeys(value, ['schemaVersion', 'status', 'environment', 'projectRef', 'observedAt', 'observedMainSha', 'evidenceRef', 'reason'], 'unavailable snapshot');
    const expected = buildUnavailableSnapshot(value);
    if (value.schemaVersion !== DRIFT_WATCH_SCHEMA_VERSION || value.status !== 'EVIDENCE_UNAVAILABLE' || expected.reason !== value.reason) fail('INVALID_SNAPSHOT', 'unavailable snapshot is not canonical');
    if (expected.projectRef !== value.projectRef || expected.evidenceRef !== value.evidenceRef) fail('INVALID_SNAPSHOT', 'unavailable snapshot target is not pinned');
    if (expected.observedMainSha !== validSha(currentMainSha, 'currentMainSha')) fail('STALE_MAIN_SHA', 'unavailable snapshot is stale');
    return expected;
  }
  assertKeys(value, ['schemaVersion', 'status', 'queryVersion', 'queryDigest', 'environment', 'projectRef', 'observedAt', 'observedMainSha', 'evidenceRef', 'migrationLedger', 'surfaces', 'acl', 'rawDataIncluded', 'captureDigest'], 'snapshot');
  if (value.schemaVersion !== DRIFT_WATCH_SCHEMA_VERSION || value.status !== 'CAPTURED') fail('INVALID_SNAPSHOT', 'snapshot version/status is unsupported');
  const environment = value.environment;
  if (![LOCAL_EXPECTED_ENVIRONMENT, 'TEST', 'PRODUCTION'].includes(environment)) fail('INVALID_ENVIRONMENT', 'snapshot environment is invalid');
  const expectedProjectRef = environment === LOCAL_EXPECTED_ENVIRONMENT ? 'local-fresh' : EXPECTED_PROJECT_REFS[environment];
  if (value.projectRef !== expectedProjectRef) fail('PROJECT_REF_MISMATCH', 'snapshot projectRef is not pinned');
  if (value.queryVersion !== METADATA_QUERY_VERSION) fail('INVALID_QUERY_VERSION', 'snapshot query version is unsupported');
  const queryDigest = validDigest(value.queryDigest, 'queryDigest');
  if (queryDigest.value !== METADATA_QUERY_DIGEST.value) fail('QUERY_DIGEST_MISMATCH', 'snapshot query digest is not checked in');
  const observedMainSha = validSha(value.observedMainSha, 'observedMainSha');
  if (observedMainSha !== validSha(currentMainSha, 'currentMainSha')) fail('STALE_MAIN_SHA', 'snapshot is not for current main');
  if (value.rawDataIncluded !== false) fail('RAW_DATA_FORBIDDEN', 'snapshot must not include application rows');
  const surfaces = {};
  assertKeys(value.surfaces, SURFACES, 'surfaces');
  for (const surface of SURFACES) {
    assertKeys(value.surfaces[surface], ['count', 'digest', 'items'], `surfaces.${surface}`);
    const items = normalizeHashedItems(value.surfaces[surface].items, `surfaces.${surface}`);
    if (value.surfaces[surface].count !== items.length) fail('SURFACE_COUNT_MISMATCH', `${surface} count does not match items`);
    const surfaceDigest = validDigest(value.surfaces[surface].digest, `surfaces.${surface}.digest`);
    if (surfaceDigest.value !== digest(items).value) fail('SURFACE_DIGEST_MISMATCH', `${surface} digest does not match items`);
    surfaces[surface] = { count: items.length, digest: surfaceDigest, items };
  }
  assertKeys(value.acl, ['count', 'digest', 'items'], 'acl');
  const aclItemsValue = normalizeHashedItems(value.acl.items, 'acl');
  if (value.acl.count !== aclItemsValue.length) fail('ACL_COUNT_MISMATCH', 'acl count does not match items');
  const aclDigest = validDigest(value.acl.digest, 'acl.digest');
  if (aclDigest.value !== digest(aclItemsValue).value) fail('ACL_DIGEST_MISMATCH', 'acl digest does not match items');
  const core = {
    schemaVersion: DRIFT_WATCH_SCHEMA_VERSION, status: 'CAPTURED', queryVersion: METADATA_QUERY_VERSION,
    queryDigest, environment, projectRef: value.projectRef, observedAt: validTime(value.observedAt, 'observedAt'),
    observedMainSha, evidenceRef: validEvidenceRef(value.evidenceRef), migrationLedger: normalizeLedgerOutput(value.migrationLedger),
    surfaces, acl: { count: aclItemsValue.length, digest: aclDigest, items: aclItemsValue }, rawDataIncluded: false,
  };
  const captureDigest = validDigest(value.captureDigest, 'captureDigest');
  if (captureDigest.value !== digest(core).value) fail('CAPTURE_DIGEST_MISMATCH', 'captureDigest does not match the hashed snapshot');
  return { ...core, captureDigest };
}
export function normalizeExceptions(value = { version: 1, exceptions: [] }) {
  if (Array.isArray(value)) value = { version: 1, exceptions: value };
  assertKeys(value, ['version', 'exceptions'], 'exceptions');
  if (value.version !== 1 || !Array.isArray(value.exceptions)) fail('INVALID_EXCEPTION_FILE', 'exceptions version/list is invalid');
  const result = value.exceptions.map((item, index) => {
    assertKeys(item, ['classification', 'environment', 'surface', 'objectKey', 'expectedFingerprint', 'observedFingerprint', 'issue', 'reason', 'expiresAt'], `exceptions[${index}]`);
    if (!EXCEPTION_CLASSES.has(item.classification) || !['TEST', 'PRODUCTION'].includes(item.environment) || !ALL_SURFACES.includes(item.surface)) fail('INVALID_EXCEPTION', `exceptions[${index}] classification/environment/surface is invalid`);
    if (typeof item.objectKey !== 'string' || !item.objectKey.trim() || item.objectKey.length > 2048 || /[\0\r\n]/.test(item.objectKey)) fail('INVALID_EXCEPTION', `exceptions[${index}].objectKey is invalid`);
    for (const field of ['expectedFingerprint', 'observedFingerprint']) if (item[field] !== null && !DIGEST.test(String(item[field]))) fail('INVALID_EXCEPTION_FINGERPRINT', `exceptions[${index}].${field} is invalid`);
    if (typeof item.issue !== 'string' || !/^#\d+$/.test(item.issue.trim())) fail('INVALID_EXCEPTION_ISSUE', `exceptions[${index}].issue is invalid`);
    if (typeof item.reason !== 'string' || !item.reason.trim() || item.reason.length > 600 || /[\0\r\n]/.test(item.reason)) fail('INVALID_EXCEPTION_REASON', `exceptions[${index}].reason is invalid`);
    const expiresAt = validTime(item.expiresAt, `exceptions[${index}].expiresAt`);
    return { ...item, issue: item.issue.trim(), expectedFingerprint: item.expectedFingerprint === null ? null : String(item.expectedFingerprint).toLowerCase(), observedFingerprint: item.observedFingerprint === null ? null : String(item.observedFingerprint).toLowerCase(), expiresAt };
  });
  const keys = result.map((item) => `${item.environment}\0${item.surface}\0${item.objectKey}`);
  if (new Set(keys).size !== keys.length) fail('DUPLICATE_EXCEPTION', 'exceptions must identify one environment/object once');
  return result;
}
function snapshotSummary(value) {
  if (value.status === 'EVIDENCE_UNAVAILABLE') return { status: value.status, projectRef: value.projectRef, observedAt: value.observedAt, reason: value.reason };
  return {
    status: value.status, projectRef: value.projectRef, observedAt: value.observedAt, evidenceRef: value.evidenceRef,
    captureDigest: value.captureDigest, surfaces: Object.fromEntries(SURFACES.map((surface) => [surface, value.surfaces[surface].digest])),
    acl: value.acl.digest, migrationLedger: value.migrationLedger.digest,
  };
}
function itemsByKey(items) { return new Map(items.map((item) => [item.key, item.fingerprint])); }
function ledgerItems(snapshot) {
  return snapshot.migrationLedger.identities.map((item) => ({ key: `${item.version}/${item.name}`, fingerprint: sha256(stableStringify(item)) }));
}
function ledgerRelation(expected, actual) {
  const expectedKeys = new Set(ledgerItems(expected).map((item) => item.key));
  const actualKeys = new Set(ledgerItems(actual).map((item) => item.key));
  const missing = [...expectedKeys].filter((key) => !actualKeys.has(key));
  const extra = [...actualKeys].filter((key) => !expectedKeys.has(key));
  return { exact: missing.length === 0 && extra.length === 0, strictSubset: missing.length > 0 && extra.length === 0 };
}
function compareEnvironment({ expected, actual, environment, exceptions, now, pendingClassification = null }) {
  const differences = [];
  const usedExceptions = new Set();
  const exceptionFor = (surface, objectKey, expectedFingerprint, observedFingerprint) => exceptions.findIndex((item) =>
    item.environment === environment && item.surface === surface && item.objectKey === objectKey &&
    item.expectedFingerprint === expectedFingerprint && item.observedFingerprint === observedFingerprint);
  const compareItems = (surface, expectedItems, actualItems) => {
    const left = itemsByKey(expectedItems); const right = itemsByKey(actualItems);
    const keys = [...new Set([...left.keys(), ...right.keys()])].sort(compareText);
    for (const objectKey of keys) {
      const expectedFingerprint = left.get(objectKey) ?? null;
      const observedFingerprint = right.get(objectKey) ?? null;
      if (expectedFingerprint === observedFingerprint) continue;
      const automaticClassification = expectedFingerprint !== null && observedFingerprint === null ? pendingClassification : null;
      const index = exceptionFor(surface, objectKey, expectedFingerprint, observedFingerprint);
      const exception = index >= 0 ? exceptions[index] : null;
      const exceptionIsActive = exception && Date.parse(exception.expiresAt) >= now &&
        (exception.classification === 'INTENTIONAL_DIFFERENCE' ||
          (automaticClassification === `EXPECTED_PENDING_${environment}` && exception.classification === automaticClassification));
      if (exceptionIsActive) usedExceptions.add(index);
      differences.push({ environment, surface, objectKey, expectedFingerprint, observedFingerprint,
        classification: automaticClassification ?? (exceptionIsActive ? exception.classification : null),
        exception: exceptionIsActive ? { classification: exception.classification, issue: exception.issue, expiresAt: exception.expiresAt } : null });
    }
  };
  for (const surface of SURFACES) compareItems(surface, expected.surfaces[surface].items, actual.surfaces[surface].items);
  compareItems('acl', expected.acl.items, actual.acl.items);
  compareItems('migrationLedger', ledgerItems(expected), ledgerItems(actual));
  const relevant = exceptions.map((item, index) => ({ item, index })).filter(({ item }) => item.environment === environment);
  const expired = relevant.filter(({ item }) => Date.parse(item.expiresAt) < now).map(({ index }) => index);
  const unmatched = relevant.filter(({ index }) => !usedExceptions.has(index) && !expired.includes(index)).map(({ index }) => index);
  const unresolved = differences.filter((item) => !item.classification);
  let status = 'MATCH';
  if (expired.length || unmatched.length || unresolved.length) status = 'DRIFT_BLOCKED';
  else if (differences.length) {
    const classes = new Set(differences.map((item) => item.classification));
    status = classes.size === 1 ? [...classes][0] : 'INTENTIONAL_DIFFERENCE';
  }
  return { status, differences, usedExceptions, expired, unmatched };
}
function evidenceAgeStatus(snapshot, now, maxAgeMs) {
  if (snapshot.status !== 'CAPTURED') return null;
  const observedAt = Date.parse(snapshot.observedAt);
  if (!Number.isFinite(observedAt) || observedAt > now + 5 * 60 * 1000 || now - observedAt > maxAgeMs) return 'EVIDENCE_STALE';
  return null;
}
function evidenceUnavailableReport({ mainSha, environments, normalizedExceptions, reason, affectedEnvironments = [] }) {
  const affected = new Set(affectedEnvironments);
  const reportedEnvironments = Object.fromEntries(Object.entries(environments).map(([label, summary]) => [label,
    affected.has(label) ? { ...summary, status: 'EVIDENCE_UNAVAILABLE', reason } : summary]));
  return { schemaVersion: DRIFT_WATCH_SCHEMA_VERSION, observedMainSha: mainSha, status: 'EVIDENCE_UNAVAILABLE', differenceCount: 0,
    differences: [], environments: reportedEnvironments,
    evidence: { status: 'EVIDENCE_UNAVAILABLE', reason, affectedEnvironments: [...affected] },
    exceptionSummary: { provided: normalizedExceptions.length, matched: 0, expired: 0, unmatched: 0 },
    safety: { fullEnvironmentParityProven: false, authorizesDatabaseWrite: false, rawDataIncluded: false } };
}
export function compareObserverSnapshots({ expectedSnapshot, testSnapshot, productionSnapshot, currentMainSha, exceptions = [], now = Date.now(), maxEvidenceAgeMinutes = 60 }) {
  const mainSha = validSha(currentMainSha, 'currentMainSha');
  const compareTime = typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(compareTime)) fail('INVALID_COMPARE_TIME', 'comparison time must be finite');
  if (!Number.isInteger(maxEvidenceAgeMinutes) || maxEvidenceAgeMinutes < 1 || maxEvidenceAgeMinutes > 24 * 60) fail('INVALID_EVIDENCE_AGE', 'maxEvidenceAgeMinutes must be an integer between 1 and 1440');
  const expected = normalizeObserverSnapshot(expectedSnapshot, mainSha);
  const test = normalizeObserverSnapshot(testSnapshot, mainSha);
  const production = normalizeObserverSnapshot(productionSnapshot, mainSha);
  const normalizedExceptions = normalizeExceptions(exceptions);
  const environments = { expected: snapshotSummary(expected), TEST: snapshotSummary(test), PRODUCTION: snapshotSummary(production) };
  if ([expected, test, production].some((snapshot) => snapshot.status === 'EVIDENCE_UNAVAILABLE')) {
    return evidenceUnavailableReport({ mainSha, environments, normalizedExceptions, reason: 'EVIDENCE_UNAVAILABLE',
      affectedEnvironments: [['expected', expected], ['TEST', test], ['PRODUCTION', production]]
        .filter(([, snapshot]) => snapshot.status === 'EVIDENCE_UNAVAILABLE').map(([label]) => label) });
  }
  const maxAgeMs = maxEvidenceAgeMinutes * 60 * 1000;
  const staleEnvironments = [['expected', expected], ['TEST', test], ['PRODUCTION', production]]
    .filter(([, snapshot]) => evidenceAgeStatus(snapshot, compareTime, maxAgeMs)).map(([label]) => label);
  if (staleEnvironments.length) return evidenceUnavailableReport({ mainSha, environments, normalizedExceptions, reason: 'EVIDENCE_STALE', affectedEnvironments: staleEnvironments });
  if (expected.queryDigest.value !== test.queryDigest.value || expected.queryDigest.value !== production.queryDigest.value) fail('QUERY_CONTRACT_MISMATCH', 'snapshot query contracts differ');
  const testLedger = ledgerRelation(expected, test);
  const productionLedger = ledgerRelation(expected, production);
  const testResult = compareEnvironment({ expected, actual: test, environment: 'TEST', exceptions: normalizedExceptions, now: compareTime,
    pendingClassification: testLedger.strictSubset ? 'EXPECTED_PENDING_TEST' : null });
  const productionPendingClassification = productionLedger.strictSubset
    ? testLedger.exact ? 'EXPECTED_PENDING_PRODUCTION' : testLedger.strictSubset ? 'EXPECTED_PENDING_TEST' : null
    : null;
  const productionResult = compareEnvironment({ expected, actual: production, environment: 'PRODUCTION', exceptions: normalizedExceptions, now: compareTime,
    pendingClassification: productionPendingClassification });
  const allDifferences = [...testResult.differences, ...productionResult.differences];
  const blocked = testResult.status === 'DRIFT_BLOCKED' || productionResult.status === 'DRIFT_BLOCKED';
  const statuses = [testResult.status, productionResult.status].filter((status) => status !== 'MATCH');
  const status = blocked ? 'DRIFT_BLOCKED' : statuses.length === 0 ? 'MATCH' : new Set(statuses).size === 1 ? statuses[0] : 'INTENTIONAL_DIFFERENCE';
  return {
    schemaVersion: DRIFT_WATCH_SCHEMA_VERSION, observedMainSha: mainSha, status, differenceCount: allDifferences.length,
    differences: allDifferences, environments, environmentStatuses: { TEST: testResult.status, PRODUCTION: productionResult.status },
    exceptionSummary: { provided: normalizedExceptions.length, matched: new Set([...testResult.usedExceptions, ...productionResult.usedExceptions]).size,
      expired: new Set([...testResult.expired, ...productionResult.expired]).size, unmatched: new Set([...testResult.unmatched, ...productionResult.unmatched]).size },
    safety: { fullEnvironmentParityProven: false, authorizesDatabaseWrite: false, rawDataIncluded: false },
  };
}
function unwrapSnapshot(body) {
  const candidates = [body, body?.snapshot, Array.isArray(body) ? body[0] : null, Array.isArray(body?.result) ? body.result[0] : null,
    Array.isArray(body?.data) ? body.data[0] : null].flatMap((candidate) => [candidate, candidate?.snapshot]);
  return candidates.find((candidate) => candidate && typeof candidate === 'object' && !Array.isArray(candidate) &&
    Object.keys(candidate).sort().join('\n') === ['acl', 'ledger', 'metadata'].join('\n')) ?? null;
}
/**
 * @param {{
 *   environment: 'TEST'|'PRODUCTION',
 *   currentMainSha: string,
 *   token?: string,
 *   connectionString?: string | null,
 *   directQuery?: (input:{connectionString:string, query:string, readOnly:true}) => Promise<any>,
 *   fetchImpl?: typeof fetch,
 *   observedAt?: string,
 * }} input
 */
export async function captureEnvironmentSnapshot({ environment, currentMainSha, token = process.env.SCHEMA_OBSERVER_TOKEN, connectionString = null, directQuery = querySnapshotViaPostgres, fetchImpl = globalThis.fetch, observedAt = new Date().toISOString() } = /** @type {any} */ ({})) {
  const mainSha = validSha(currentMainSha, 'currentMainSha');
  const projectRef = EXPECTED_PROJECT_REFS[environment];
  const evidenceRef = `supabase:${String(environment).toLowerCase()}/schema-observer`;
  const unavailable = (reason) => buildUnavailableSnapshot({ environment, observedAt, observedMainSha: mainSha, reason });
  if (!['TEST', 'PRODUCTION'].includes(environment)) return unavailable('INVALID_ENVIRONMENT');
  let directConnectionString;
  try { directConnectionString = connectionString || observerConnectionStringFor(environment, token); }
  catch (error) { return unavailable(error?.code && /^[A-Z0-9_.-]+$/.test(error.code) ? error.code : 'EVIDENCE_UNAVAILABLE'); }
  if (directConnectionString) {
    try {
      directConnectionString = parseProjectBoundSchemaObserverUrl(directConnectionString, environment).connectionString;
      const raw = await directQuery({ connectionString: directConnectionString, query: READ_ONLY_SNAPSHOT_SQL, readOnly: true });
      if (!raw) return unavailable('EVIDENCE_RESPONSE_SHAPE_INVALID');
      return buildObserverSnapshotFromRaw({ environment, projectRef, observedAt, observedMainSha: mainSha, evidenceRef, raw });
    } catch (error) {
      return unavailable(error?.code && /^[A-Z0-9_.-]+$/.test(error.code) ? error.code : 'EVIDENCE_UNAVAILABLE');
    }
  }
  if (typeof token !== 'string' || !token.trim()) return unavailable('SCHEMA_OBSERVER_TOKEN_MISSING');
  if (typeof fetchImpl !== 'function') return unavailable('FETCH_UNAVAILABLE');
  try {
    const response = await fetchImpl(`https://api.supabase.com/v1/projects/${projectRef}/database/query/read-only`, {
      method: 'POST', headers: { authorization: `Bearer ${token.trim()}`, 'content-type': 'application/json' },
      body: JSON.stringify({ query: READ_ONLY_SNAPSHOT_SQL }),
    });
    if (!response || response.ok !== true) return unavailable(`HTTP_${Number(response?.status) || 'UNKNOWN'}`);
    const body = await response.json();
    const raw = unwrapSnapshot(body);
    if (!raw) return unavailable('EVIDENCE_RESPONSE_SHAPE_INVALID');
    return buildObserverSnapshotFromRaw({ environment, projectRef, observedAt, observedMainSha: mainSha, evidenceRef, raw });
  } catch (error) {
    return unavailable(error?.code && /^[A-Z0-9_.-]+$/.test(error.code) ? error.code : 'EVIDENCE_UNAVAILABLE');
  }
}
function readJson(path) {
  try { return JSON.parse(readFileSync(resolve(path), 'utf8')); } catch { fail('INPUT_JSON_UNAVAILABLE', 'input JSON could not be read'); }
}
function writeJson(path, value) {
  const target = resolve(path); mkdirSync(dirname(target), { recursive: true });
  const temporary = `${target}.tmp-${process.pid}`; writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); renameSync(temporary, target);
}
function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith('--') || !argv[index + 1] || argv[index + 1].startsWith('--')) fail('INVALID_ARGUMENT', `${key} requires a value`);
    result[key.slice(2)] = argv[++index];
  }
  return result;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = parseArgs(process.argv.slice(2));
    if (!input['json-out']) fail('INVALID_ARGUMENT', '--json-out is required');
    if (input.command === 'capture') {
      const result = await captureEnvironmentSnapshot({ environment: input.environment, currentMainSha: input['current-main-sha'] });
      writeJson(input['json-out'], result);
      if (result.status !== 'CAPTURED') process.exitCode = 2;
    } else if (input.command === 'normalize') {
      const result = buildObserverSnapshotFromRaw({ environment: input.environment, projectRef: input['project-ref'], observedAt: input['observed-at'] ?? new Date().toISOString(), observedMainSha: input['current-main-sha'], evidenceRef: input['evidence-ref'] ?? 'local:fresh-install', raw: readJson(input['raw-json']) });
      writeJson(input['json-out'], result);
    } else if (input.command === 'compare') {
      const result = compareObserverSnapshots({ expectedSnapshot: readJson(input['expected-snapshot']), testSnapshot: readJson(input['test-snapshot']), productionSnapshot: readJson(input['production-snapshot']), currentMainSha: input['current-main-sha'], exceptions: input.exceptions ? readJson(input.exceptions).exceptions : [], maxEvidenceAgeMinutes: input['max-evidence-age-minutes'] ? Number(input['max-evidence-age-minutes']) : undefined });
      writeJson(input['json-out'], result);
      if (result.status === 'DRIFT_BLOCKED' || result.status === 'EVIDENCE_UNAVAILABLE') process.exitCode = 2;
    } else fail('INVALID_ARGUMENT', 'command must be capture, normalize, or compare');
  } catch (error) {
    process.stderr.write(`${error.code ?? 'SCHEMA_DRIFT_WATCH_FAILED'}: ${error.message}\n`);
    process.exitCode = 1;
  }
}
