import { createHash } from 'node:crypto';

import {
  advanceApplyReceipt,
  assertApplyReceiptAdmitted,
  assertConsumingApplyReceipt,
} from '../agents/production-db-apply-receipt.mjs';
import { PRODUCTION_DB_POLICY, evaluateReleasePreflight } from '../agents/production-db-release-preflight.mjs';
import { advanceReleaseJournal, assertReleaseJournalMatchesPlan, assertWriterAttemptAllowed } from '../agents/production-db-release-journal.mjs';
import { pendingProductionMigrations, sha256, splitSqlStatements, stripSqlStringLiterals, verifyProductionDbReleasePlan } from '../agents/production-db-release-plan.mjs';
import { createProjectBoundProductionDbTransport } from './production-db-postgres-transport.mjs';

const LOCK_KEY = `vibeaico-production-db-writer:${PRODUCTION_DB_POLICY.productionProjectRef}`;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function normalizedLedgerRows(rows = []) {
  if (!Array.isArray(rows)) fail('INVALID_LEDGER_ROWS', 'live ledger rows must be an array');
  const normalized = rows.map((row) => {
    const version = String(row?.version ?? '').trim();
    const name = String(row?.name ?? '').trim();
    if (!name || !version || /[\r\n]/.test(name) || /[\r\n]/.test(version)) fail('INVALID_LEDGER_IDENTITY', 'live ledger rows require non-empty single-line name and version');
    return { version, name };
  });
  const names = normalized.map((row) => row.name);
  if (new Set(names).size !== names.length) fail('DUPLICATE_LIVE_LEDGER_NAME', 'live Production ledger has duplicate migration names');
  return normalized;
}

function normalizedLedgerNames(rows) {
  return normalizedLedgerRows(rows).map((row) => row.name).sort();
}

function sanitizedLedgerRows(rows) {
  if (!Array.isArray(rows)) fail('INVALID_LEDGER_ROWS', 'live ledger rows must be an array');
  return rows.map((row) => ({ version: String(row?.version ?? ''), name: String(row?.name ?? '') }));
}

export function expectedAppliedLedgerNames(aliasMap = {}) {
  if (aliasMap?.schemaVersion !== 1 || !Array.isArray(aliasMap?.entries)) fail('INVALID_ALIAS_MAP', 'ledger alias map is unavailable');
  const names = [];
  for (const entry of aliasMap.entries) {
    const classification = String(entry?.classification ?? '');
    const ledgerNames = Array.isArray(entry?.ledgerNames) ? entry.ledgerNames.map(String) : [];
    if (classification === 'NOT_APPLIED') {
      if (ledgerNames.length) fail('INVALID_NOT_APPLIED_LEDGER_NAMES', `${entry?.repoFile ?? '<unknown>'} cannot be NOT_APPLIED and have ledger names`);
      continue;
    }
    for (const name of ledgerNames) {
      if (!name.trim() || /[\r\n]/.test(name)) fail('INVALID_LEDGER_ALIAS', 'ledger alias names must be non-empty single-line values');
      names.push(name.trim());
    }
  }
  const sorted = names.sort();
  if (new Set(sorted).size !== sorted.length) fail('DUPLICATE_ALIAS_LEDGER_NAME', 'alias map maps the same live ledger name more than once');
  return sorted;
}

export function assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows } = {}) {
  const expected = expectedAppliedLedgerNames(aliasMap);
  const actual = normalizedLedgerNames(liveLedgerRows);
  if (expected.length !== actual.length || expected.some((name, index) => name !== actual[index])) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const extraLive = actual.filter((name) => !expectedSet.has(name));
    const missingLive = expected.filter((name) => !actualSet.has(name));
    fail('LIVE_LEDGER_DRIFT', `extraLive=[${extraLive.join(', ')}], missingLive=[${missingLive.join(', ')}]`);
  }
  return { status: 'LIVE_LEDGER_VERIFIED', ledgerRowCount: actual.length, databaseMutationAuthorized: false };
}


function ledgerIdentityValues(rows = []) {
  return rows.map((entry) => {
    const name = String(entry?.name ?? entry?.repoFile ?? '').trim();
    const version = String(entry?.version ?? entry?.ledgerVersion ?? '').trim();
    if (!name || !version) fail('INVALID_LEDGER_IDENTITY', 'ledger name and version are required for reconciliation');
    return `(${sqlLiteral(name)}, ${sqlLiteral(version)})`;
  }).join(', ');
}

function expectedPostApplyLedgerRows({ plan, baselineRows } = {}) {
  const rows = [
    ...baselineRows,
    ...plan.migrations.map((entry) => ({ name: entry.repoFile, version: entry.ledgerVersion })),
  ];
  const names = rows.map((row) => row.name);
  if (new Set(names).size !== names.length) fail('DUPLICATE_EXPECTED_LEDGER_NAME', 'baseline and planned ledger names must be unique');
  return rows;
}
function ledgerReconciliationSql({ ledgerIdentity, errorFormat }) {
  const input = String(ledgerIdentity) + '\n' + String(errorFormat);
  let tag = '$ledgercheck$';
  let suffix = 0;
  while (input.includes(tag)) tag = '$ledgercheck' + String(suffix++) + '$';
  return `do ${tag} declare mismatches text[]; begin with expected(name, version) as (${ledgerIdentity ? `values ${ledgerIdentity}` : 'select null::text as name, null::text as version where false'}), actual(name, version) as (select m.name::text, m.version::text from supabase_migrations.schema_migrations m), differences(item) as (select 'MISSING:' || x.name || '@' || x.version from expected x where not exists (select 1 from actual m where m.name = x.name and m.version = x.version) union all select 'EXTRA:' || m.name || '@' || m.version from actual m where not exists (select 1 from expected x where m.name = x.name and m.version = x.version) union all select 'DUPLICATE:' || m.name || '@' || m.version from actual m group by m.name, m.version having count(*) > 1) select array_agg(item order by item) into mismatches from differences; if mismatches is not null then raise exception '${errorFormat}', array_to_string(mismatches, ','); end if; end ${tag};`;
}


function assertAtomicCompatibleSql(sql, repoFile) {
  const statements = splitSqlStatements(sql);
  const transactionControl = /^(?:begin\b|start\s+transaction\b|commit\b|rollback\b|abort\b|end(?:\s+(?:work|transaction|and\s+chain))?\b|savepoint\b|release(?:\s+savepoint)?\b|prepare\s+transaction\b|set\s+(?:(?:local|session)\s+)?transaction\b|set\s+session\s+characteristics\s+as\s+transaction\b)/i;
  const procedural = /^(?:do\b|create\s+(?:or\s+replace\s+)?(?:function|procedure)\b)/i;
  const proceduralTransactionControl = /\b(?:commit|rollback|abort|savepoint|release(?:\s+savepoint)?|prepare\s+transaction)\b/i;
  for (const statement of statements) {
    const trimmed = statement.trim();
    const lexicalBody = procedural.test(trimmed) ? stripSqlStringLiterals(trimmed) : '';
    if (transactionControl.test(trimmed) || (lexicalBody && proceduralTransactionControl.test(lexicalBody))) {
      fail('TRANSACTION_CONTROL_NOT_ADMITTED', `${repoFile} contains a transaction boundary command that would escape the atomic writer`);
    }
    // Deny every session configuration statement, including quoted/U& names and
    // RESET ALL. Re-applying timeouts afterwards would leave the migration itself
    // unbounded. DO-block configuration and set_config calls fail in the planner.
    if (/^(?:set|reset|discard)\b/i.test(trimmed)) {
      fail('WRITER_CONFIGURATION_NOT_ADMITTED', `${repoFile} cannot override the writer session configuration`);
    }
  }
  const text = statements.join('\n');
  if (/\b(create|reindex)\s+index\s+concurrently\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} uses CONCURRENTLY and cannot run in the atomic v1 writer`);
  }
  if (/\b(vacuum|cluster|alter\s+system|create\s+database|drop\s+database)\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} contains a command not admitted by the atomic v1 writer`);
  }
}


function buildBoundedBackfillSql({ repoFile } = {}) {
  fail('BACKFILL_EXECUTOR_NOT_ADMITTED', repoFile + ' cannot run through the v1 controlled writer; use a separately reviewed bounded executor');
}

export function buildAtomicProductionApplySql({
  plan,
  releasePacket,
  aliasMap,
  liveLedgerRows,
  readCanonicalSql,
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows });
  const pending = pendingProductionMigrations(aliasMap);
  const planned = plan.migrations.map((entry) => entry.repoFile).sort();
  if (pending.join('\n') !== planned.join('\n')) fail('PENDING_SET_MISMATCH', 'live apply plan no longer equals canonical PENDING_APPLY set');

  const baselineRows = normalizedLedgerRows(liveLedgerRows);
  const expectedPostApplyRows = expectedPostApplyLedgerRows({ plan, baselineRows });
  const baselineIdentity = ledgerIdentityValues(baselineRows);
  const statements = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    `do $lock$ begin if not pg_try_advisory_xact_lock(hashtextextended(${sqlLiteral(LOCK_KEY)}, 0)) then raise exception 'PRODUCTION_DB_WRITER_LOCK_BUSY'; end if; end $lock$;`,
    ledgerReconciliationSql({ ledgerIdentity: baselineIdentity, errorFormat: 'PRODUCTION_DB_LIVE_LEDGER_CHANGED_AFTER_LOCK:%' }),
  ];

  for (const entry of plan.migrations) {
    const sql = String(readCanonicalSql(entry.path));
    if (sha256(Buffer.from(sql)) !== entry.sha256) fail('MIGRATION_BYTES_MISMATCH', `${entry.path} differs from reviewed main bytes`);
    assertAtomicCompatibleSql(sql, entry.repoFile);
    const migrationSql = entry.riskTier === 'BACKFILL'
      ? buildBoundedBackfillSql({ sql, repoFile: entry.repoFile, releasePacket, plan })
      : '-- controlled migration ' + entry.repoFile + '\n' + sql.trim() + (sql.trim().endsWith(';') ? '' : ';');
    statements.push(migrationSql);
    statements.push(
      // Only name/version are guaranteed by the canonical ledger contract.
      // Single-use attempt identity belongs to #455's durable receipt, not to
      // undeclared provider columns.
      `insert into supabase_migrations.schema_migrations(version, name) values (` +
      `${sqlLiteral(entry.ledgerVersion)}, ${sqlLiteral(entry.repoFile)});`,
    );
  }

  statements.push(
    ledgerReconciliationSql({ ledgerIdentity: ledgerIdentityValues(expectedPostApplyRows), errorFormat: 'PRODUCTION_DB_POST_LEDGER_MISMATCH:%' }),
    'commit;',
  );
  return statements.join('\n\n');
}

export async function captureProductionLedger({ transport } = {}) {
  if (!transport || transport.kind !== 'PROJECT_BOUND_POSTGRES' || transport.projectRef !== PRODUCTION_DB_POLICY.productionProjectRef) {
    fail('PROJECT_BOUND_WRITER_TRANSPORT_REQUIRED', 'Production ledger reads require the canonical project-bound PostgreSQL transport');
  }
  try {
    const rows = await transport.captureLedger();
    return normalizedLedgerRows(rows);
  } catch (error) {
    if (error?.code) throw error;
    fail('LIVE_LEDGER_READ_FAILED', `Production ledger read failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Private transport: importing this module must not expose a raw-SQL write path.
async function executeAtomicProductionApply({ command, transport } = {}) {
  if (!transport || transport.kind !== 'PROJECT_BOUND_POSTGRES' || transport.projectRef !== PRODUCTION_DB_POLICY.productionProjectRef) {
    fail('PROJECT_BOUND_WRITER_TRANSPORT_REQUIRED', 'Production mutations require the canonical project-bound PostgreSQL transport');
  }
  try {
    return await transport.executePlanBoundTransaction(command);
  } catch (error) {
    if (error?.code) throw error;
    fail('CONTROLLED_APPLY_FAILED', `atomic Production apply failed: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function verifyPostApplyLedger({ plan, liveLedgerRows, baselineLedgerRows } = {}) {
  const rows = normalizedLedgerRows(liveLedgerRows);
  const expected = Array.isArray(baselineLedgerRows)
    ? expectedPostApplyLedgerRows({ plan, baselineRows: normalizedLedgerRows(baselineLedgerRows) })
    : plan.migrations.map((entry) => ({ name: entry.repoFile, version: String(entry.ledgerVersion ?? '').trim() }));
  const actualByName = new Map(rows.map((row) => [row.name, row]));
  const expectedByName = new Map(expected.map((row) => [row.name, row]));
  const missing = expected.filter((row) => !actualByName.has(row.name)).map((row) => `${row.name}@${row.version}`);
  const extra = rows.filter((row) => !expectedByName.has(row.name)).map((row) => `${row.name}@${row.version}`);
  if (missing.length || extra.length) fail('POST_APPLY_LEDGER_MISMATCH', `missing=[${missing.join(', ')}], extra=[${extra.join(', ')}]`);
  const versionMismatches = expected
    .filter((row) => actualByName.get(row.name)?.version !== String(row.version ?? '').trim())
    .map((row) => `${row.name}:expected=${row.version},actual=${actualByName.get(row.name)?.version || '<empty>'}`);
  if (versionMismatches.length) fail('POST_APPLY_LEDGER_VERSION_MISMATCH', versionMismatches.join(', '));
  return { status: 'POST_APPLY_LEDGER_VERIFIED', applied: plan.migrations.map((entry) => entry.repoFile), databaseMutationAuthorized: false };
}

function assertReleasePacketMatchesPlan(releasePacket, plan, now) {
  if (releasePacket?.releaseId !== plan.releaseId || releasePacket?.mainSha !== plan.mainSha || releasePacket?.planDigest !== plan.planDigest) {
    fail('RELEASE_PACKET_PLAN_MISMATCH', 'release packet does not identify the verified release plan');
  }
  if (releasePacket?.riskTier !== plan.riskTier) fail('RELEASE_PACKET_RISK_MISMATCH', 'release packet risk tier is not the plan risk tier');
  evaluateReleasePreflight(releasePacket, { now });
}

function preparationCore(prepared) {
  return {
    schemaVersion: prepared.schemaVersion,
    status: prepared.status,
    releaseId: prepared.releaseId,
    planDigest: prepared.planDigest,
    mainSha: prepared.mainSha,
    preparedAt: prepared.preparedAt,
    baselineLedgerRows: prepared.baselineLedgerRows,
    journal: prepared.journal,
    receipt: prepared.receipt,
  };
}

/**
 * Phase 1. This function performs only read-only network work, then moves the
 * journal/receipt to APPLYING/CONSUMING in memory and returns a serializable
 * attempt envelope. The caller MUST durably persist this returned envelope
 * before calling executePreparedControlledProductionRelease(). This source core
 * only prepares data; the workflow must persist the exact envelope before it can
 * make a mutable request.
 *
 * @param {{ [key:string]: any,
 *   plan?: any,
 *   releasePacket?: any,
 *   journal?: any,
 *   receipt?: any,
 *   aliasMap?: any,
 *   readCanonicalSql?: (path: string) => string,
 *   transport?: ReturnType<typeof createProjectBoundProductionDbTransport>,
 *   now?: string,
 * }} [input]
 */
export async function prepareControlledProductionReleaseAttempt({
  plan,
  releasePacket,
  journal,
  receipt,
  aliasMap,
  readCanonicalSql,
  transport,
  now: _ignoredNow,
} = {}) {
  const admittedAt = new Date().toISOString();
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  assertReleaseJournalMatchesPlan(journal, plan);
  assertWriterAttemptAllowed(journal);
  assertReleasePacketMatchesPlan(releasePacket, plan, admittedAt);
  assertApplyReceiptAdmitted(receipt, plan, PRODUCTION_DB_POLICY.productionProjectRef, { now: admittedAt });

  const before = await captureProductionLedger({ transport });
  buildAtomicProductionApplySql({ plan, aliasMap, liveLedgerRows: before, readCanonicalSql });
  // A slow ledger read cannot carry evidence past its expiry into the persisted
  // envelope. The workflow must start over rather than execute stale evidence.
  const preparedAt = new Date().toISOString();
  assertReleasePacketMatchesPlan(releasePacket, plan, preparedAt);

  const prepared = {
    schemaVersion: 1,
    status: 'CONTROLLED_APPLY_PREPARED',
    releaseId: plan.releaseId,
    planDigest: plan.planDigest,
    mainSha: plan.mainSha,
    preparedAt,
    baselineLedgerRows: sanitizedLedgerRows(before),
    journal: advanceReleaseJournal(journal, {
      status: 'APPLYING', at: preparedAt, evidenceRef: 'writer:prepared-before-mutable',
    }),
    receipt: advanceApplyReceipt(receipt, 'CONSUMING', preparedAt),
  };
  return {
    ...prepared,
    preparationDigest: sha256Json(preparationCore(prepared)),
    nextRequiredStep: 'DURABLY_PERSIST_ATTEMPT_ENVELOPE_BEFORE_MUTABLE_REQUEST',
    databaseMutationAuthorized: false,
  };
}

/**
 * Compatibility boundary for callers that only need the old entry point's
 * fail-closed admission checks. It intentionally never sends a mutable request:
 * production execution must use the persisted two-phase envelope above.
 */
export async function runControlledProductionRelease(input = {}) {
  const { plan, releasePacket, aliasMap, readCanonicalSql, transport } = input;
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  assertReleasePacketMatchesPlan(releasePacket, plan, new Date().toISOString());
  const before = await captureProductionLedger({ transport });
  buildAtomicProductionApplySql({ plan, releasePacket, aliasMap, liveLedgerRows: before, readCanonicalSql });
  assertReleasePacketMatchesPlan(releasePacket, plan, new Date().toISOString());
  return {
    status: 'MUTABLE_EXECUTION_REQUIRES_DURABLE_PREPARED_ATTEMPT',
    databaseMutationAuthorized: false,
  };
}

function assertPreparedAttempt({ prepared, plan, releasePacket, aliasMap, readCanonicalSql, now }) {
  if (!prepared || prepared.schemaVersion !== 1 || prepared.status !== 'CONTROLLED_APPLY_PREPARED') {
    fail('DURABLE_PREPARED_ATTEMPT_REQUIRED', 'mutable writer requires a prepared attempt envelope');
  }
  if (prepared.releaseId !== plan?.releaseId || prepared.mainSha !== plan?.mainSha || prepared.planDigest !== plan?.planDigest) {
    fail('PREPARED_ATTEMPT_PLAN_MISMATCH', 'prepared attempt belongs to another release plan');
  }
  if (sha256Json(preparationCore(prepared)) !== prepared.preparationDigest) {
    fail('PREPARED_ATTEMPT_DIGEST_MISMATCH', 'prepared attempt changed after preparation');
  }
  assertReleaseJournalMatchesPlan(prepared.journal, plan);
  if (prepared.journal.status !== 'APPLYING') fail('DURABLE_APPLYING_JOURNAL_REQUIRED', `writer requires APPLYING journal, got ${prepared.journal.status}`);
  assertConsumingApplyReceipt(prepared.receipt, plan, PRODUCTION_DB_POLICY.productionProjectRef, { now });
  assertReleasePacketMatchesPlan(releasePacket, plan, now);
  return buildAtomicProductionApplySql({
    plan,
    aliasMap,
    liveLedgerRows: prepared.baselineLedgerRows,
    readCanonicalSql,
  });
}

/**
 * Phase 2. The caller may invoke this only after the exact prepared envelope has
 * been durably persisted outside process memory. This function never accepts
 * PRE_APPLY/ISSUED state, so a process crash cannot silently fall back to the
 * reusable pre-attempt state.
 *
 * @param {{ [key:string]: any,
 *   prepared?: any,
 *   plan?: any,
 *   releasePacket?: any,
 *   aliasMap?: any,
 *   readCanonicalSql?: (path: string) => string,
 *   transport?: ReturnType<typeof createProjectBoundProductionDbTransport>,
 *   now?: string,
 * }} [input]
 */
export async function executePreparedControlledProductionRelease({
  prepared,
  plan,
  releasePacket,
  aliasMap,
  readCanonicalSql,
  transport,
  now = new Date().toISOString(),
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  const sql = assertPreparedAttempt({ prepared, plan, releasePacket, aliasMap, readCanonicalSql, now });

  try {
    await executeAtomicProductionApply({
      transport,
      command: {
        sql,
        releaseId: plan.releaseId,
        mainSha: plan.mainSha,
        planDigest: plan.planDigest,
        preparedAttemptDigest: prepared.preparationDigest,
      },
    });
    const after = await captureProductionLedger({ transport });
    verifyPostApplyLedger({ plan, liveLedgerRows: after, baselineLedgerRows: prepared.baselineLedgerRows });
    const confirmedJournal = advanceReleaseJournal(prepared.journal, {
      status: 'APPLIED_CONFIRMED', at: now, evidenceRef: 'readback:provider-ledger-applied',
    });
    const consumedReceipt = advanceApplyReceipt(prepared.receipt, 'CONSUMED', now);
    return {
      schemaVersion: 1,
      status: 'APPLY_NEEDS_SCHEMA_POSTCHECK',
      releaseId: plan.releaseId,
      planDigest: plan.planDigest,
      mainSha: plan.mainSha,
      journal: confirmedJournal,
      receipt: consumedReceipt,
      g6: 'DURABLE_ATTEMPT_THEN_SINGLE_USE_RECEIPT_PLUS_DB_LOCK_AND_POST_LOCK_RECHECK',
      nextRequiredGate: 'G7_SCHEMA_ACL_RLS_READBACK',
      databaseMutationAuthorized: false,
    };
  } catch (error) {
    const unknownJournal = advanceReleaseJournal(prepared.journal, {
      status: 'APPLY_UNKNOWN', at: now, evidenceRef: 'writer:mutable-or-readback-uncertain',
    });
    const unknownReceipt = advanceApplyReceipt(prepared.receipt, 'UNKNOWN', now);
    const wrapped = new Error(`APPLY_UNKNOWN: mutable request did not produce a verified post-state; readback is required before retry. ${error instanceof Error ? error.message : String(error)}`);
    wrapped.code = 'APPLY_UNKNOWN';
    wrapped.cause = error;
    wrapped.journal = unknownJournal;
    wrapped.receipt = unknownReceipt;
    throw wrapped;
  }
}
