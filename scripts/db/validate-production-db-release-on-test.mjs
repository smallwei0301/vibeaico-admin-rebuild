#!/usr/bin/env node

import { canonicalMigrationTransport } from './canonical-migration-transport.mjs';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import process from 'node:process';
import postgres from 'postgres';
import { admitCanonicalMigrationSource, sha256, stableStringify } from '../agents/schema-truth-guardrails.mjs';

import {
  buildProductionDbReleasePlan,
  splitSqlStatements,
  stripSqlStringLiterals,
  verifyProductionDbReleasePlan,
} from '../agents/production-db-release-plan.mjs';

const API = 'https://api.supabase.com';
const REPOSITORY = 'smallwei0301/vibeaico-admin-rebuild';
const TEST_PROJECT_REF = 'nmwhwngojosmagjuvxol';
const PRODUCTION_PROJECT_REF = 'egehnijjpgijmccagxac';
const CREATED_BY = 'vibeaico-g3-test-validator';
const LOCK_KEY = `vibeaico-g3-test-release:${TEST_PROJECT_REF}`;
const SHA = /^[0-9a-f]{40}$/;
const TEST_SESSION_POOLER_HOST = /^aws-\d+-ap-northeast-1\.pooler\.supabase\.com$/i;
// #755's TEST baseline prerequisite is separate from every Production plan.
// This is an apply-only, closed selection; an existing identity needs read-only
// reconciliation, never replay or a manually repaired ledger.
const TEST_BASELINE_0098 = Object.freeze({
  repoFile: '0098_reconcile_tour_orders_legacy_contact_columns',
  path: 'supabase/migrations/0098_reconcile_tour_orders_legacy_contact_columns.sql',
  sha256: 'f0bd13dcf2226143d90dc1ca3431df7a3020e3d3f9eabd446b640b03261193e5',
  version: '0098',
  created_by: 'vibeaico-test-baseline-0098',
});
const BASELINE_COLUMNS_QUERY = `select pg_catalog.to_regclass('public.tour_orders') is not null as table_exists,
  coalesce((select jsonb_agg(jsonb_build_object('column_name', column_name, 'data_type', data_type,
    'is_nullable', is_nullable, 'column_default', column_default) order by column_name)
    from information_schema.columns where table_schema='public' and table_name='tour_orders'
    and column_name in ('customer_name', 'customer_phone')), '[]'::jsonb) as columns`;

/** @returns {never} */
function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}
function decodeUsername(value) {
  try { return decodeURIComponent(String(value ?? '')); } catch { fail('MALFORMED_TEST_RELEASE_URL', 'TEST release username is not valid URL encoding'); }
}
/** The direct TEST path is intentionally bound to the one canonical test pooler. */
export function parseProjectBoundTestDbReleaseUrl(connectionString) {
  const raw = String(connectionString ?? '').trim();
  if (!raw) fail('MISSING_TEST_RELEASE_URL', 'TEST_DB_RELEASE_URL is required');
  let parsed;
  try { parsed = new URL(raw); } catch { fail('MALFORMED_TEST_RELEASE_URL', 'TEST_DB_RELEASE_URL is not a valid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) fail('MALFORMED_TEST_RELEASE_URL', 'TEST_DB_RELEASE_URL must use postgres/postgresql protocol');
  if (String(parsed.port || '5432') !== '5432') fail('TEST_RELEASE_URL_SESSION_MODE_REQUIRED', 'TEST release URL must use session/direct port 5432');
  if ((parsed.pathname || '/postgres').replace(/^\//, '') !== 'postgres') fail('TEST_RELEASE_URL_DATABASE_MISMATCH', 'TEST release URL must target postgres');
  if (!TEST_SESSION_POOLER_HOST.test(String(parsed.hostname ?? '')) || decodeUsername(parsed.username) !== `postgres.${TEST_PROJECT_REF}`) {
    fail('TEST_RELEASE_URL_PROJECT_MISMATCH', 'TEST release URL must bind the canonical postgres TEST pooler user');
  }
  if (!parsed.password) fail('TEST_RELEASE_URL_PASSWORD_REQUIRED', 'TEST release URL requires a password');
  let password;
  try { password = decodeURIComponent(parsed.password); } catch {
    fail('MALFORMED_TEST_RELEASE_URL', 'TEST release password is not valid URL encoding');
  }
  const entries = [...parsed.searchParams.entries()];
  if (parsed.hash || entries.length !== 1 || entries[0][0] !== 'sslmode' || String(entries[0][1]).toLowerCase() !== 'verify-full') {
    fail('TEST_RELEASE_TLS_VERIFICATION_REQUIRED', 'TEST release URL must use exactly sslmode=verify-full');
  }
  return { projectRef: TEST_PROJECT_REF, role: 'postgres', transportMode: 'SUPAVISOR_SESSION', connectionString: raw,
    host: parsed.hostname, port: 5432, database: 'postgres', username: `postgres.${TEST_PROJECT_REF}`, password };
}
/** Pass admitted fields, never a raw URL for postgres.js to reinterpret. */
export function buildProjectBoundTestDbReleaseClientOptions(connectionString) {
  const target = parseProjectBoundTestDbReleaseUrl(connectionString);
  return { host: [target.host], port: [target.port], database: target.database,
    username: target.username, password: target.password, ssl: 'verify-full',
    max: 1, prepare: false, connect_timeout: 15, idle_timeout: 5 };
}
async function queryViaTestDbReleaseUrl({ connectionString, sql: statement, readOnly }) {
  const client = postgres(buildProjectBoundTestDbReleaseClientOptions(connectionString));
  try {
    if (readOnly) {
      return await client.begin(async (transaction) => {
        await transaction.unsafe('set local transaction read only');
        return transaction.unsafe(statement);
      });
    }
    return await client.unsafe(statement);
  } finally {
    await client.end({ timeout: 5 });
  }
}
function directTestConnectionString(value) {
  const raw = String(value ?? '').trim();
  return /^postgres(?:ql)?:\/\//i.test(raw) ? raw : null;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function textArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(', ')}]::text[]`;
}

function exactSha(value, label = 'mainSha') {
  const text = String(value ?? '').trim().toLowerCase();
  if (!SHA.test(text)) fail('INVALID_MAIN_SHA', `${label} must be an exact 40-character SHA`);
  return text;
}

function runGit(repoRoot, args, runner = spawnSync) {
  const result = runner('git', ['-C', repoRoot, ...args], {
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    fail('GIT_COMMAND_FAILED', `git ${args.join(' ')} failed: ${String(result.stderr ?? '').trim() || 'unknown error'}`);
  }
  return String(result.stdout ?? '').trim();
}

export function assertTrustedMainCheckout(expectedMainSha, repoRoot = process.cwd(), runner = spawnSync) {
  const expected = exactSha(expectedMainSha, 'expectedMainSha');
  runGit(repoRoot, ['fetch', '--quiet', 'origin', 'main'], runner);
  const head = exactSha(runGit(repoRoot, ['rev-parse', 'HEAD'], runner), 'checkout HEAD');
  const main = exactSha(runGit(repoRoot, ['rev-parse', 'origin/main'], runner), 'origin/main');
  if (head !== expected || main !== expected) {
    fail('TRUSTED_MAIN_CHECKOUT_MISMATCH', `checkout=${head}, origin/main=${main}, expected=${expected}`);
  }
  return { status: 'TRUSTED_MAIN_VERIFIED', mainSha: expected, databaseMutationAuthorized: false };
}

export function assertTestReleaseTarget(projectRef) {
  const value = String(projectRef ?? '').trim();
  if (value === PRODUCTION_PROJECT_REF) fail('PRODUCTION_TARGET_FORBIDDEN', 'G3 TEST validator may never target Production');
  if (value !== TEST_PROJECT_REF) fail('CANONICAL_TEST_TARGET_REQUIRED', 'G3 TEST validator only targets canonical TEST');
  return value;
}

function assertAtomicCompatibleSql(sql, repoFile) {
  // Keep G3 admission at least as strict as the Production atomic writer:
  // nested BEGIN does not create a nested PostgreSQL transaction, and COMMIT
  // would release the lock before the migration ledger and postchecks finish.
  const statements = splitSqlStatements(sql);
  const transactionControl = /^(?:begin\b|start\s+transaction\b|commit\b|rollback\b|abort\b|end(?:\s+(?:work|transaction|and\s+chain))?\b|savepoint\b|release(?:\s+savepoint)?\b|prepare\s+transaction\b|set\s+(?:(?:local|session)\s+)?transaction\b|set\s+session\s+characteristics\s+as\s+transaction\b)/i;
  const procedural = /^(?:do\b|create\s+(?:or\s+replace\s+)?(?:function|procedure)\b)/i;
  const proceduralTransactionControl = /\b(?:commit|rollback|abort|savepoint|release(?:\s+savepoint)?|prepare\s+transaction)\b/i;
  for (const statement of statements) {
    const trimmed = statement.trim();
    const lexicalBody = procedural.test(trimmed) ? stripSqlStringLiterals(trimmed) : '';
    if (transactionControl.test(trimmed) || (lexicalBody && proceduralTransactionControl.test(lexicalBody))) {
      fail('TRANSACTION_CONTROL_NOT_ADMITTED', `${repoFile} contains a transaction boundary command that would escape the atomic G3 validator`);
    }
    if (/^(?:set|reset|discard)\b/i.test(trimmed)) {
      fail('WRITER_CONFIGURATION_NOT_ADMITTED', `${repoFile} cannot override the G3 validator session configuration`);
    }
  }
  const text = statements.join('\n');
  if (/\b(create|reindex)\s+index\s+concurrently\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} uses CONCURRENTLY and cannot run in the atomic G3 validator`);
  }
  if (/\b(vacuum|cluster|alter\s+system|create\s+database|drop\s+database)\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} contains a command not admitted by the atomic G3 validator`);
  }
}

function canonicalReader(repoRoot) {
  return (path) => readFileSync(resolve(repoRoot, path), 'utf8');
}

function readAliasMap(repoRoot) {
  return JSON.parse(readFileSync(resolve(repoRoot, 'supabase/ledger-alias-map.json'), 'utf8'));
}

/**
 * Build the Production release plan only from an exact trusted-main checkout.
 * @param {{
 *   releaseId: string,
 *   mainSha: string,
 *   plannedAt: string,
 *   migrationScope?: string,
 *   repoRoot?: string,
 *   runner?: typeof spawnSync,
 * }} input
 */
export function buildTestReleasePlanFromCheckout({
  releaseId,
  mainSha,
  plannedAt,
  migrationScope,
  repoRoot = process.cwd(),
  runner = spawnSync,
} = /** @type {any} */ ({})) {
  const exactMain = exactSha(mainSha);
  assertTrustedMainCheckout(exactMain, repoRoot, runner);
  return buildProductionDbReleasePlan({
    releaseId,
    mainSha: exactMain,
    plannedAt,
    migrationScope,
    aliasMap: readAliasMap(repoRoot),
    readCanonicalSql: canonicalReader(repoRoot),
  });
}

/**
 * @param {{
 *   token?: string,
 *   projectRef?: string,
 *   fetchImpl?: typeof fetch,
 * }} input
 */
export async function captureTestProviderLedger({
  token,
  connectionString = null,
  directQuery = queryViaTestDbReleaseUrl,
  projectRef = TEST_PROJECT_REF,
  fetchImpl = fetch,
} = /** @type {any} */ ({})) {
  const target = assertTestReleaseTarget(projectRef);
  if (connectionString) {
    parseProjectBoundTestDbReleaseUrl(connectionString);
    const rows = await directQuery({
      connectionString,
      sql: 'select version, name, created_by, idempotency_key from supabase_migrations.schema_migrations order by version, name',
      readOnly: true,
    });
    if (!Array.isArray(rows)) fail('TEST_LEDGER_READ_FAILED', 'TEST direct ledger read did not return rows');
    return rows.map((row) => ({
      version: String(row?.version ?? ''), name: String(row?.name ?? ''),
      created_by: row?.created_by == null ? null : String(row.created_by),
      idempotency_key: row?.idempotency_key == null ? null : String(row.idempotency_key),
    }));
  }
  if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN is required');
  const response = await fetchImpl(`${API}/v1/projects/${target}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      query: 'select version, name, created_by, idempotency_key from supabase_migrations.schema_migrations order by version, name',
    }),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok || !Array.isArray(body)) fail('TEST_LEDGER_READ_FAILED', `TEST ledger read failed with HTTP ${response.status}`);
  return body.map((row) => ({
    version: String(row?.version ?? ''),
    name: String(row?.name ?? ''),
    created_by: row?.created_by == null ? null : String(row.created_by),
    idempotency_key: row?.idempotency_key == null ? null : String(row.idempotency_key),
  }));
}

function assertPlanLedgerAdmission(plan, liveLedgerRows) {
  if (!Array.isArray(liveLedgerRows)) fail('INVALID_TEST_LEDGER_ROWS', 'TEST ledger rows must be an array');
  const decisions = [];
  for (const migration of plan.migrations) {
    const name = String(migration.repoFile);
    const matches = liveLedgerRows.filter((row) => row.name === name);
    if (matches.length > 1) fail('DUPLICATE_TEST_LEDGER_NAME', `${name} appears multiple times in TEST provider ledger`);
    const idempotencyKey = `g3:${plan.releaseId}:${name}`;
    if (matches.length === 1) {
      decisions.push({ repoFile: name, existedBefore: true, existingVersion: matches[0].version, idempotencyKey });
      continue;
    }
    const versionCollision = liveLedgerRows.find((row) => row.version === String(migration.ledgerVersion));
    if (versionCollision) {
      fail('TEST_LEDGER_VERSION_COLLISION', `${migration.ledgerVersion} already belongs to ${versionCollision.name}`);
    }
    const keyCollision = liveLedgerRows.find((row) => row.idempotency_key === idempotencyKey);
    if (keyCollision) fail('TEST_LEDGER_IDEMPOTENCY_COLLISION', `${idempotencyKey} already belongs to ${keyCollision.name}`);
    decisions.push({ repoFile: name, existedBefore: false, existingVersion: null, idempotencyKey });
  }
  return decisions;
}

export function buildAtomicTestReleaseValidationSql({
  plan,
  aliasMap,
  liveLedgerRows,
  readCanonicalSql,
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  const decisions = assertPlanLedgerAdmission(plan, liveLedgerRows);
  const baseline = [...liveLedgerRows]
    .map((row) => `${row.version}:${row.name}`)
    .sort();
  const statements = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    `do $lock$ begin if not pg_try_advisory_xact_lock(hashtextextended(${sqlLiteral(LOCK_KEY)}, 0)) then raise exception 'G3_TEST_RELEASE_LOCK_BUSY'; end if; end $lock$;`,
    `do $baseline$ declare actual text[]; expected text[] := ${textArray(baseline)}; begin select coalesce(array_agg(version || ':' || name order by version, name), array[]::text[]) into actual from supabase_migrations.schema_migrations; if actual is distinct from expected then raise exception 'G3_TEST_LEDGER_CHANGED_AFTER_LOCK'; end if; end $baseline$;`,
  ];

  for (const migration of plan.migrations) {
    const decision = decisions.find((item) => item.repoFile === migration.repoFile);
    const sql = String(readCanonicalSql(migration.path));
    const transport = canonicalMigrationTransport({ entry: migration, sql });
    assertAtomicCompatibleSql(transport.sql, migration.repoFile);
    if (decision.existedBefore) {
      // A migration already present in the TEST ledger is replay evidence, not
      // permission to execute its DDL again. Historical migrations are allowed
      // to be non-idempotent (for example, a bare CREATE TABLE), and the
      // post-TEST ledger plus integration/schema evidence verifies that the
      // exact planned identity is already present. Only migrations absent from
      // the ledger are admitted to this mutable transaction.
      statements.push(`-- G3 replay verification ${migration.repoFile}: existing TEST ledger; DDL not replayed`);
      continue;
    }
    statements.push(`-- G3 exact-main validation ${migration.repoFile}\n${transport.sql.trim()}${transport.sql.trim().endsWith(';') ? '' : ';'}`);
    statements.push(
      `insert into supabase_migrations.schema_migrations(version, statements, name, created_by, idempotency_key) values (` +
      `${sqlLiteral(migration.ledgerVersion)}, null, ${sqlLiteral(migration.repoFile)}, ${sqlLiteral(CREATED_BY)}, ${sqlLiteral(decision.idempotencyKey)});`,
    );
  }

  const plannedNames = plan.migrations.map((item) => item.repoFile);
  statements.push(
    `do $postledger$ declare missing text[]; begin select array_agg(x) into missing from unnest(${textArray(plannedNames)}) x where not exists (select 1 from supabase_migrations.schema_migrations m where m.name=x); if missing is not null then raise exception 'G3_TEST_POST_LEDGER_MISSING:%', array_to_string(missing, ','); end if; end $postledger$;`,
    'commit;',
  );

  return { sql: statements.join('\n\n'), decisions };
}

/**
 * @param {{token?: string, projectRef?: string, sql?: string, fetchImpl?: typeof fetch}} input
 */
async function executeAtomicTestRelease({ token, connectionString = null, directQuery = queryViaTestDbReleaseUrl, projectRef = TEST_PROJECT_REF, sql, fetchImpl = fetch } = /** @type {any} */ ({})) {
  const target = assertTestReleaseTarget(projectRef);
  if (connectionString) {
    await directQuery({ connectionString, sql, readOnly: false });
    return;
  }
  if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN is required');
  const response = await fetchImpl(`${API}/v1/projects/${target}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await response.text();
  if (!response.ok) fail('TEST_RELEASE_APPLY_FAILED', `atomic TEST release validation failed with HTTP ${response.status}: ${text.slice(0, 500)}`);
}

function verifyPostTestLedger(plan, rows) {
  const result = new Map();
  for (const migration of plan.migrations) {
    const matches = rows.filter((row) => row.name === migration.repoFile);
    if (matches.length !== 1) fail('TEST_POST_LEDGER_MISMATCH', `${migration.repoFile} must exist exactly once after G3 validation`);
    result.set(migration.repoFile, matches[0]);
  }
  return result;
}

/**
 * Execute the locked release plan on canonical TEST only. Production is rejected
 * before any network request. The returned envelope is TEST evidence only and
 * never a Production mutation credential.
 * @param {{
 *   plan: any,
 *   token?: string,
 *   connectionString?: string,
 *   directQuery?: (input:{connectionString:string, sql:string, readOnly:boolean}) => Promise<any>,
 *   projectRef?: string,
 *   sourceRunId: string | number,
 *   sourceRunAttempt: number,
 *   repoRoot?: string,
 *   fetchImpl?: typeof fetch,
 *   runner?: typeof spawnSync,
 * }} input
 */
export async function validateProductionDbReleasePlanOnTest({
  plan,
  token,
  connectionString = null,
  directQuery = queryViaTestDbReleaseUrl,
  projectRef = TEST_PROJECT_REF,
  sourceRunId,
  sourceRunAttempt,
  repoRoot = process.cwd(),
  fetchImpl = fetch,
  runner = spawnSync,
} = /** @type {any} */ ({})) {
  const target = assertTestReleaseTarget(projectRef);
  const directConnectionString = connectionString || directTestConnectionString(token);
  if (directConnectionString) parseProjectBoundTestDbReleaseUrl(directConnectionString);
  else if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'TEST_DB_RELEASE_TOKEN or TEST_DB_RELEASE_URL is required');
  const runId = String(sourceRunId ?? '').trim();
  const runAttempt = Number(sourceRunAttempt);
  if (!runId || !Number.isSafeInteger(runAttempt) || runAttempt < 1) fail('INVALID_TEST_RUN_IDENTITY', 'GitHub run id/attempt are required');
  assertTrustedMainCheckout(plan?.mainSha, repoRoot, runner);
  const aliasMap = readAliasMap(repoRoot);
  const readCanonicalSql = canonicalReader(repoRoot);
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });

  const before = await captureTestProviderLedger({ token, connectionString: directConnectionString, directQuery, projectRef: target, fetchImpl });
  const built = buildAtomicTestReleaseValidationSql({ plan, aliasMap, liveLedgerRows: before, readCanonicalSql });
  await executeAtomicTestRelease({ token, connectionString: directConnectionString, directQuery, projectRef: target, sql: built.sql, fetchImpl });
  const after = await captureTestProviderLedger({ token, connectionString: directConnectionString, directQuery, projectRef: target, fetchImpl });
  const post = verifyPostTestLedger(plan, after);

  return {
    schemaVersion: 1,
    status: 'TEST_RELEASE_PLAN_VERIFIED',
    repository: REPOSITORY,
    testProjectRef: target,
    mainSha: plan.mainSha,
    planDigest: plan.planDigest,
    releaseId: plan.releaseId,
    sourceRunId: runId,
    sourceRunAttempt: runAttempt,
    migrations: plan.migrations.map((migration) => {
      const decision = built.decisions.find((item) => item.repoFile === migration.repoFile);
      const ledger = post.get(migration.repoFile);
      return {
        repoFile: migration.repoFile,
        sha256: migration.sha256,
        riskTier: migration.riskTier,
        execution: decision.existedBefore ? 'REPLAY_VERIFIED' : 'APPLIED_VERIFIED',
        ledgerVersion: ledger.version,
      };
    }),
    testMutationPerformed: true,
    productionMutationPerformed: false,
    databaseMutationAuthorized: false,
  };
}

function baselineLedgerSnapshot(rows) {
  if (!Array.isArray(rows)) fail('INVALID_TEST_BASELINE_LEDGER', 'ledger rows are required');
  const snapshot = {};
  for (const row of rows) {
    if (!row || typeof row.version !== 'string' || !/^\d{4,14}$/.test(row.version)
      || typeof row.name !== 'string' || !row.name
      || ![row.created_by, row.idempotency_key].every((value) => value === null || typeof value === 'string')
      || Object.hasOwn(snapshot, row.version)) {
      fail('INVALID_TEST_BASELINE_LEDGER', 'ledger identities and provenance must be complete and unique');
    }
    snapshot[row.version] = { version: row.version, name: row.name,
      created_by: row.created_by, idempotency_key: row.idempotency_key };
  }
  return snapshot;
}

function assertBaselineColumns(state) {
  const columns = state?.columns;
  if (state?.table_exists !== true || !Array.isArray(columns)
    || ![0, 2].includes(columns.length)
    || (columns.length === 2 && columns.map((column) => column?.column_name).join(',') !== 'customer_name,customer_phone')
    || columns.some((column) => column.data_type !== 'text' || !['YES', 'NO'].includes(column.is_nullable)
      || (column.column_default !== null && typeof column.column_default !== 'string'))) {
    fail('TEST_BASELINE_COLUMN_SHAPE_NOT_ADMITTED', 'tour_orders must exist with both legacy text columns or neither');
  }
  return { table_exists: true, columns: columns.map(({ column_name, data_type, is_nullable, column_default }) =>
    ({ column_name, data_type, is_nullable, column_default })) };
}

/** Pure construction only: only the pinned canonical 0098 bytes are accepted. */
export function buildAtomic0098TestBaselineSql({ sql, liveLedgerRows, liveColumns } = {}) {
  if (typeof sql !== 'string' || sha256(sql) !== TEST_BASELINE_0098.sha256) {
    fail('TEST_BASELINE_SOURCE_PIN_MISMATCH', 'only the reviewed canonical 0098 bytes are admitted');
  }
  assertAtomicCompatibleSql(sql, TEST_BASELINE_0098.repoFile);
  const beforeLedger = baselineLedgerSnapshot(liveLedgerRows);
  if (liveLedgerRows.some((row) => row.version === TEST_BASELINE_0098.version
    || row.name === 'reconcile_tour_orders_legacy_contact_columns' || /^0098(?:_|$)/.test(row.name)
    || row.idempotency_key?.startsWith('test-baseline-0098:'))) {
    fail('TEST_BASELINE_0098_HISTORY_PRESENT', '0098 history already exists; stop and reconcile without replay');
  }
  const beforeColumns = assertBaselineColumns(liveColumns);
  const expectedColumns = { table_exists: true, columns: beforeColumns.columns.map((column) =>
    ({ ...column, is_nullable: 'YES', column_default: "''::text" })) };
  const ledger = { version: TEST_BASELINE_0098.version, name: TEST_BASELINE_0098.repoFile,
    created_by: TEST_BASELINE_0098.created_by, idempotency_key: `test-baseline-0098:${TEST_BASELINE_0098.sha256}` };
  const expectedLedger = { ...beforeLedger, [ledger.version]: ledger };
  const ledgerQuery = `select coalesce(jsonb_object_agg(version, jsonb_build_object('version', version,
    'name', name, 'created_by', created_by, 'idempotency_key', idempotency_key)), '{}'::jsonb)
    from supabase_migrations.schema_migrations`;
  // Single-quote escaping cannot protect an outer DO dollar-quote delimiter.
  // Encode metadata as UTF8 hex so even a stored $baselineledger$ stays data.
  const check = (tag, query, expected, code) => {
    const hex = Buffer.from(stableStringify(expected), 'utf8').toString('hex');
    return `do $${tag}$ declare actual jsonb; begin ${query};
      if actual is distinct from pg_catalog.convert_from(pg_catalog.decode(${sqlLiteral(hex)}, 'hex'), 'UTF8')::jsonb
      then raise exception '${code}'; end if; end $${tag}$;`;
  };
  // Wrap each SELECT to reuse the readback query inside the locked transaction.
  const ledgerCheck = (tag, expected, code) => check(tag, `select value into actual from (${ledgerQuery}) as s(value)`, expected, code);
  const columnsCheck = (tag, expected, code) => check(tag, `select to_jsonb(s) into actual from (${BASELINE_COLUMNS_QUERY}) s`, expected, code);
  const statements = [
    'begin;', "set local lock_timeout = '5s';", "set local statement_timeout = '60s';",
    `do $lock$ begin if not pg_try_advisory_xact_lock(hashtextextended(${sqlLiteral(LOCK_KEY)}, 0)) then raise exception 'G3_TEST_RELEASE_LOCK_BUSY'; end if; end $lock$;`,
    ledgerCheck('baselineledger', beforeLedger, 'TEST_BASELINE_LEDGER_CHANGED_AFTER_LOCK'),
    columnsCheck('baselinecolumns', beforeColumns, 'TEST_BASELINE_COLUMNS_CHANGED_AFTER_LOCK'),
    sql,
    `insert into supabase_migrations.schema_migrations(version, statements, name, created_by, idempotency_key)
      values (${sqlLiteral(ledger.version)}, null, ${sqlLiteral(ledger.name)}, ${sqlLiteral(ledger.created_by)}, ${sqlLiteral(ledger.idempotency_key)});`,
    ledgerCheck('postledger', expectedLedger, 'TEST_BASELINE_POST_LEDGER_MISMATCH'),
    columnsCheck('postcolumns', expectedColumns, 'TEST_BASELINE_POST_COLUMNS_MISMATCH'),
    'commit;',
  ];
  return { sql: statements.join('\n\n'), expectedLedger, expectedColumns, ledger };
}

async function capture0098TestColumns({ token, connectionString, directQuery, projectRef, fetchImpl }) {
  let rows;
  if (connectionString) {
    rows = await directQuery({ connectionString, sql: BASELINE_COLUMNS_QUERY, readOnly: true });
  } else {
    const response = await fetchImpl(`${API}/v1/projects/${projectRef}/database/query/read-only`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: BASELINE_COLUMNS_QUERY }),
    });
    rows = await response.json().catch(() => null);
    if (!response.ok) fail('TEST_BASELINE_COLUMN_READ_FAILED', 'TEST column metadata read failed');
  }
  if (!Array.isArray(rows) || rows.length !== 1) fail('TEST_BASELINE_COLUMN_READ_FAILED', 'one column metadata snapshot is required');
  return assertBaselineColumns(rows[0]);
}

/** TEST-only baseline evidence, not a Production plan, G3 or G2 approval. */
export async function validate0098TestBaselineFromCheckout({
  mainSha, token, connectionString = null, directQuery = queryViaTestDbReleaseUrl,
  projectRef = TEST_PROJECT_REF, sourceRunId, sourceRunAttempt,
  repoRoot = process.cwd(), fetchImpl = fetch,
} = /** @type {any} */ ({})) {
  const target = assertTestReleaseTarget(projectRef);
  const directConnectionString = connectionString || directTestConnectionString(token);
  if (directConnectionString) parseProjectBoundTestDbReleaseUrl(directConnectionString);
  else if (!String(token ?? '').trim()) fail('MISSING_TEST_RELEASE_TOKEN', 'existing TEST release credential is required');
  const runId = String(sourceRunId ?? '');
  const runAttempt = Number(sourceRunAttempt);
  if (!/^\d+$/.test(runId) || !Number.isSafeInteger(runAttempt) || runAttempt < 1) fail('INVALID_TEST_RUN_IDENTITY', 'GitHub run id/attempt are required');
  const exactMain = exactSha(mainSha);
  assertTrustedMainCheckout(exactMain, repoRoot);
  const source = admitCanonicalMigrationSource({ repoRoot, migrationPath: TEST_BASELINE_0098.path,
    targetEnvironment: 'TEST', expectedSha256: TEST_BASELINE_0098.sha256 });
  if (source.currentMainSha !== exactMain) fail('TRUSTED_MAIN_CHECKOUT_MISMATCH', 'source admission must match expected main');
  const sql = canonicalReader(repoRoot)(TEST_BASELINE_0098.path);
  if (sha256(sql) !== source.migrationSha256) fail('TEST_BASELINE_SOURCE_PIN_MISMATCH', 'source bytes changed after admission');
  const capture = { token, connectionString: directConnectionString, directQuery, projectRef: target, fetchImpl };
  const beforeLedger = await captureTestProviderLedger(capture);
  const beforeColumns = await capture0098TestColumns(capture);
  const built = buildAtomic0098TestBaselineSql({ sql, liveLedgerRows: beforeLedger, liveColumns: beforeColumns });
  try {
    await executeAtomicTestRelease({ ...capture, sql: built.sql });
  } catch {
    fail('TEST_BASELINE_APPLY_UNKNOWN', 'mutable request outcome is unverified; read back before any further action, do not retry');
  }
  try {
    const afterLedger = baselineLedgerSnapshot(await captureTestProviderLedger(capture));
    const afterColumns = await capture0098TestColumns(capture);
    if (stableStringify(afterLedger) !== stableStringify(built.expectedLedger)
      || stableStringify(afterColumns) !== stableStringify(built.expectedColumns)) {
      fail('TEST_BASELINE_POSTCHECK_MISMATCH', 'actual ledger or column metadata differs from the atomic baseline result');
    }
    return { schemaVersion: 1, status: 'TEST_BASELINE_0098_VERIFIED', repository: REPOSITORY,
      testProjectRef: target, mainSha: exactMain, sourceRunId: runId, sourceRunAttempt: runAttempt,
      migration: { repoFile: TEST_BASELINE_0098.repoFile, sha256: source.migrationSha256, ledger: built.ledger },
      columnFingerprints: { before: sha256(stableStringify(beforeColumns)), after: sha256(stableStringify(afterColumns)) },
      testMutationPerformed: true, productionMutationPerformed: false, databaseMutationAuthorized: false };
  } catch {
    fail('TEST_BASELINE_POSTCHECK_UNKNOWN', 'post-apply evidence is unverified; stop and reconcile, do not retry');
  }
}

async function main() {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'plan') {
      const [releaseId, mainSha, plannedAt, outputPath, migrationScope] = args;
      if (!releaseId || !mainSha || !plannedAt || !outputPath) fail('USAGE', 'plan <releaseId> <mainSha> <plannedAt> <output.json> [migrationScope]');
      const plan = buildTestReleasePlanFromCheckout({ releaseId, mainSha, plannedAt, migrationScope });
      writeFileSync(outputPath, `${JSON.stringify(plan, null, 2)}\n`);
      return;
    }
    if (command === 'apply') {
      const [planPath, outputPath] = args;
      if (!planPath || !outputPath) fail('USAGE', 'apply <plan.json> <evidence.json>');
      const plan = JSON.parse(readFileSync(planPath, 'utf8'));
      const evidence = await validateProductionDbReleasePlanOnTest({
        plan,
        token: process.env.TEST_DB_RELEASE_TOKEN,
        connectionString: process.env.TEST_DB_RELEASE_URL,
        projectRef: process.env.TEST_PROJECT_REF || TEST_PROJECT_REF,
        sourceRunId: process.env.GITHUB_RUN_ID,
        sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      });
      writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    if (command === 'test-baseline-0098') {
      const [mainSha, outputPath] = args;
      if (!mainSha || !outputPath || args.length !== 2) fail('USAGE', 'test-baseline-0098 <mainSha> <evidence.json>');
      const evidence = await validate0098TestBaselineFromCheckout({ mainSha,
        token: process.env.TEST_DB_RELEASE_TOKEN, connectionString: process.env.TEST_DB_RELEASE_URL,
        projectRef: process.env.TEST_PROJECT_REF || TEST_PROJECT_REF,
        sourceRunId: process.env.GITHUB_RUN_ID, sourceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) });
      writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
      return;
    }
    fail('USAGE', 'use plan, apply or test-baseline-0098');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1]?.endsWith('validate-production-db-release-on-test.mjs')) main();

export const G3_TEST_PROJECT_REF = TEST_PROJECT_REF;
