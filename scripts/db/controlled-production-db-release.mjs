import { createHash } from 'node:crypto';

import {
  advanceApplyReceipt,
  assertApplyReceiptAdmitted,
  assertConsumingApplyReceipt,
} from '../agents/production-db-apply-receipt.mjs';
import { PRODUCTION_DB_POLICY, evaluateReleasePreflight } from '../agents/production-db-release-preflight.mjs';
import { advanceReleaseJournal, assertReleaseJournalMatchesPlan, assertWriterAttemptAllowed } from '../agents/production-db-release-journal.mjs';
import { pendingProductionMigrations, verifyProductionDbReleasePlan } from '../agents/production-db-release-plan.mjs';

const API = 'https://api.supabase.com';
const WRITER_CREATED_BY = 'vibeaico-controlled-writer';
const LOCK_KEY = `vibeaico-production-db-writer:${PRODUCTION_DB_POLICY.productionProjectRef}`;

function fail(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  throw error;
}

function sha256(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function textArray(values) {
  return `ARRAY[${values.map(sqlLiteral).join(', ')}]::text[]`;
}

function normalizedLedgerNames(rows) {
  if (!Array.isArray(rows)) fail('INVALID_LEDGER_ROWS', 'live ledger rows must be an array');
  const names = rows.map((row) => String(row?.name ?? '').trim()).filter(Boolean).sort();
  if (new Set(names).size !== names.length) fail('DUPLICATE_LIVE_LEDGER_NAME', 'live Production ledger has duplicate migration names');
  return names;
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
      if (!name.trim()) fail('INVALID_LEDGER_ALIAS', 'ledger alias names must be non-empty');
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
  if (expected.join('\n') !== actual.join('\n')) {
    const expectedSet = new Set(expected);
    const actualSet = new Set(actual);
    const extraLive = actual.filter((name) => !expectedSet.has(name));
    const missingLive = expected.filter((name) => !actualSet.has(name));
    fail('LIVE_LEDGER_DRIFT', `extraLive=[${extraLive.join(', ')}], missingLive=[${missingLive.join(', ')}]`);
  }
  return { status: 'LIVE_LEDGER_VERIFIED', ledgerRowCount: actual.length, databaseMutationAuthorized: false };
}

function assertAtomicCompatibleSql(sql, repoFile) {
  const text = String(sql ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\r\n]*/g, ' ');
  if (/\b(create|reindex)\s+index\s+concurrently\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} uses CONCURRENTLY and cannot run in the atomic v1 writer`);
  }
  if (/\b(vacuum|cluster|alter\s+system|create\s+database|drop\s+database)\b/i.test(text)) {
    fail('TRANSACTION_UNSAFE_MIGRATION', `${repoFile} contains a command not admitted by the atomic v1 writer`);
  }
}

export function buildAtomicProductionApplySql({
  plan,
  aliasMap,
  liveLedgerRows,
  readCanonicalSql,
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  assertLiveLedgerMatchesAliasMap({ aliasMap, liveLedgerRows });
  const pending = pendingProductionMigrations(aliasMap);
  const planned = plan.migrations.map((entry) => entry.repoFile).sort();
  if (pending.join('\n') !== planned.join('\n')) fail('PENDING_SET_MISMATCH', 'live apply plan no longer equals canonical PENDING_APPLY set');

  const baselineNames = normalizedLedgerNames(liveLedgerRows);
  const statements = [
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    `do $lock$ begin if not pg_try_advisory_xact_lock(hashtextextended(${sqlLiteral(LOCK_KEY)}, 0)) then raise exception 'PRODUCTION_DB_WRITER_LOCK_BUSY'; end if; end $lock$;`,
    `do $baseline$ declare actual text[]; expected text[] := ${textArray(baselineNames)}; begin select coalesce(array_agg(name order by name), array[]::text[]) into actual from supabase_migrations.schema_migrations; if actual is distinct from expected then raise exception 'PRODUCTION_DB_LIVE_LEDGER_CHANGED_AFTER_LOCK'; end if; end $baseline$;`,
  ];

  for (const entry of plan.migrations) {
    const sql = String(readCanonicalSql(entry.path));
    assertAtomicCompatibleSql(sql, entry.repoFile);
    statements.push(`-- controlled migration ${entry.repoFile}\n${sql.trim()}${sql.trim().endsWith(';') ? '' : ';'}`);
    statements.push(
      `insert into supabase_migrations.schema_migrations(version, statements, name, created_by, idempotency_key) values (` +
      `${sqlLiteral(entry.ledgerVersion)}, null, ${sqlLiteral(entry.repoFile)}, ${sqlLiteral(WRITER_CREATED_BY)}, ` +
      `${sqlLiteral(`${plan.releaseId}:${entry.repoFile}`)});`,
    );
  }

  statements.push(
    `do $postledger$ declare missing text[]; begin select array_agg(x) into missing from unnest(${textArray(planned)}) x where not exists (select 1 from supabase_migrations.schema_migrations m where m.name=x); if missing is not null then raise exception 'PRODUCTION_DB_POST_LEDGER_MISSING:%', array_to_string(missing, ','); end if; end $postledger$;`,
    'commit;',
  );
  return statements.join('\n\n');
}

export async function captureProductionLedger({ token, fetchImpl = fetch } = {}) {
  if (!token) fail('MISSING_WRITER_TOKEN', 'Production DB writer token is required');
  const res = await fetchImpl(`${API}/v1/projects/${PRODUCTION_DB_POLICY.productionProjectRef}/database/query/read-only`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: 'select version, name from supabase_migrations.schema_migrations order by version' }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok || !Array.isArray(body)) fail('LIVE_LEDGER_READ_FAILED', `Production ledger read failed with HTTP ${res.status}`);
  return body;
}

export async function executeAtomicProductionApply({ sql, token, fetchImpl = fetch } = {}) {
  if (!token) fail('MISSING_WRITER_TOKEN', 'Production DB writer token is required');
  const res = await fetchImpl(`${API}/v1/projects/${PRODUCTION_DB_POLICY.productionProjectRef}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) fail('CONTROLLED_APPLY_FAILED', `atomic Production apply failed with HTTP ${res.status}: ${text.slice(0, 500)}`);
  return { status: 'APPLY_REQUEST_CONFIRMED', databaseMutationAuthorized: false };
}

export function verifyPostApplyLedger({ plan, liveLedgerRows } = {}) {
  const names = new Set(normalizedLedgerNames(liveLedgerRows));
  const missing = plan.migrations.map((entry) => entry.repoFile).filter((name) => !names.has(name));
  if (missing.length) fail('POST_APPLY_LEDGER_MISMATCH', `missing=[${missing.join(', ')}]`);
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
 * before calling executePreparedControlledProductionRelease().
 */
export async function prepareControlledProductionReleaseAttempt({
  plan,
  releasePacket,
  journal,
  receipt,
  aliasMap,
  readCanonicalSql,
  token,
  fetchImpl = fetch,
  now = new Date().toISOString(),
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  assertReleaseJournalMatchesPlan(journal, plan);
  assertWriterAttemptAllowed(journal);
  assertApplyReceiptAdmitted(receipt, plan, PRODUCTION_DB_POLICY.productionProjectRef, { now });
  assertReleasePacketMatchesPlan(releasePacket, plan, now);

  const before = await captureProductionLedger({ token, fetchImpl });
  buildAtomicProductionApplySql({ plan, aliasMap, liveLedgerRows: before, readCanonicalSql });

  const prepared = {
    schemaVersion: 1,
    status: 'CONTROLLED_APPLY_PREPARED',
    releaseId: plan.releaseId,
    planDigest: plan.planDigest,
    mainSha: plan.mainSha,
    preparedAt: now,
    baselineLedgerRows: sanitizedLedgerRows(before),
    journal: advanceReleaseJournal(journal, {
      status: 'APPLYING', at: now, evidenceRef: 'writer:prepared-before-mutable',
    }),
    receipt: advanceApplyReceipt(receipt, 'CONSUMING', now),
  };
  return {
    ...prepared,
    preparationDigest: sha256(preparationCore(prepared)),
    nextRequiredStep: 'DURABLY_PERSIST_ATTEMPT_ENVELOPE_BEFORE_MUTABLE_REQUEST',
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
  if (sha256(preparationCore(prepared)) !== prepared.preparationDigest) {
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
 */
export async function executePreparedControlledProductionRelease({
  prepared,
  plan,
  releasePacket,
  aliasMap,
  readCanonicalSql,
  token,
  fetchImpl = fetch,
  now = new Date().toISOString(),
} = {}) {
  verifyProductionDbReleasePlan({ plan, aliasMap, readCanonicalSql });
  const sql = assertPreparedAttempt({ prepared, plan, releasePacket, aliasMap, readCanonicalSql, now });

  try {
    await executeAtomicProductionApply({ sql, token, fetchImpl });
    const after = await captureProductionLedger({ token, fetchImpl });
    verifyPostApplyLedger({ plan, liveLedgerRows: after });
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
    wrapped.journal = unknownJournal;
    wrapped.receipt = unknownReceipt;
    throw wrapped;
  }
}
