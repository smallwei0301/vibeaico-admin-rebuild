#!/usr/bin/env node

// Explicitly invoked real PostgreSQL fixture. Never part of npm test or the
// canonical TEST transport. Provision an empty, disposable run-bound database
// separately, under the caller's local-DB authorization, before invoking this.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { buildAtomic0098TestBaselineSql } from '../db/validate-production-db-release-on-test.mjs';

const MIGRATION = 'supabase/migrations/0098_reconcile_tour_orders_legacy_contact_columns.sql';
const LOCK = 'vibeaico-g3-test-release:nmwhwngojosmagjuvxol';
const RUN_ID = /^[a-z0-9]{8,24}$/;
const COLUMN_QUERY = `select pg_catalog.to_regclass('public.tour_orders') is not null as table_exists,
  coalesce((select jsonb_agg(jsonb_build_object('column_name', column_name, 'data_type', data_type,
    'is_nullable', is_nullable, 'column_default', column_default) order by column_name)
    from information_schema.columns where table_schema='public' and table_name='tour_orders'
    and column_name in ('customer_name', 'customer_phone')), '[]'::jsonb) as columns`;

/** @returns {never} */
function fail(code) { throw Object.assign(new Error(code), { code }); }

/** Pure target admission. No DNS, connection, secret lookup, or URL logging. */
export function parseDisposable0098PgTarget(connectionString, runId, explicitlyAllowed = false) {
  if (explicitlyAllowed !== true) fail('DISPOSABLE_LOCAL_PG_OPT_IN_REQUIRED');
  if (typeof runId !== 'string' || !RUN_ID.test(runId)) fail('INVALID_DISPOSABLE_PG_RUN_ID');
  let url;
  try { url = new URL(String(connectionString ?? '')); } catch { fail('DISPOSABLE_PG_TARGET_NOT_ADMITTED'); }
  const host = url.hostname === '[::1]' ? '::1' : url.hostname;
  const database = `vibeai_843_${runId}`;
  const port = Number(url.port);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)
    || !['127.0.0.1', '::1'].includes(host) || url.username !== 'postgres'
    || url.pathname !== `/${database}` || !url.password || !url.port
    || !Number.isInteger(port) || port < 1024 || port > 65535
    || url.search || url.hash) fail('DISPOSABLE_PG_TARGET_NOT_ADMITTED');
  let password;
  try { password = decodeURIComponent(url.password); } catch { fail('DISPOSABLE_PG_TARGET_NOT_ADMITTED'); }
  return { host, port, database, username: 'postgres', password, connectionString: String(connectionString) };
}

/**
 * postgres.js has a different URL parser (including comma-separated hosts).
 * Never let it reinterpret the raw URL that WHATWG URL admitted as loopback.
 */
export function buildDisposable0098PgClientOptions(connectionString, runId, explicitlyAllowed = false) {
  const target = parseDisposable0098PgTarget(connectionString, runId, explicitlyAllowed);
  // Array options also avoid postgres.js splitting an IPv6 scalar on ':'.
  return { host: [target.host], port: [target.port], database: target.database,
    username: target.username, password: target.password, ssl: false,
    max: 1, prepare: false, connect_timeout: 5, idle_timeout: 5, onnotice: () => {} };
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env */
export function parseDisposable0098PgArgs(argv, env = process.env) {
  let allowed = false, runId, outputPath;
  for (let i = 0; i < argv.length; i += 1) {
    const argument = argv[i];
    if (argument === '--allow-disposable-local-pg' && !allowed) allowed = true;
    else if (argument === '--run-id' && runId === undefined && argv[i + 1]) runId = argv[++i];
    else if (argument === '--output' && outputPath === undefined && argv[i + 1]) outputPath = argv[++i];
    else fail('INVALID_DISPOSABLE_PG_ARGUMENTS');
  }
  return { runId, outputPath, explicitlyAllowed: allowed, target: parseDisposable0098PgTarget(env.BASELINE_0098_LOCAL_DATABASE_URL, runId, allowed) };
}

async function assertEmptyDatabase(client, database) {
  const [identity] = await client`select current_database() as database`;
  assert.equal(identity.database, database, 'DISPOSABLE_DATABASE_IDENTITY_MISMATCH');
  // Refuse an existing application database even if its name looks disposable.
  // Extension-owned objects are not fixture-owned and must also be absent.
  const [inventory] = await client`select
    (select count(*)::int from pg_namespace where nspname not in ('public', 'information_schema')
      and nspname not like 'pg_%') as schemas,
    (select count(*)::int from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname not like 'pg_%' and n.nspname <> 'information_schema') as relations,
    (select count(*)::int from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname not like 'pg_%' and n.nspname <> 'information_schema') as routines,
    (select count(*)::int from pg_type t join pg_namespace n on n.oid=t.typnamespace
      where n.nspname not like 'pg_%' and n.nspname <> 'information_schema') as types`;
  assert.deepEqual({ ...inventory }, { schemas: 0, relations: 0, routines: 0, types: 0 }, 'DISPOSABLE_DATABASE_NOT_EMPTY');
}

async function removeOwnedFixture(client) {
  // Ownership is established only after the whole target is proven empty.
  await client.unsafe('rollback');
  await client.unsafe(`drop table if exists public.tour_orders;
    drop schema if exists supabase_migrations cascade;
    drop function if exists public.fixture_0098_fault();`);
}

async function createFixture(client, shape = 'both') {
  const columns = {
    both: ', customer_name text not null, customer_phone text not null',
    neither: '',
    missing: ', customer_name text not null',
    wrong: ', customer_name text not null, customer_phone integer not null',
    encoded: ", customer_name text not null default $fixture$$baselinecolumns$'\\Unicode測試$fixture$, customer_phone text not null",
  }[shape];
  assert.notEqual(columns, undefined);
  await client.unsafe(`create schema supabase_migrations;
    create table supabase_migrations.schema_migrations(version text primary key, statements text[],
      name text not null, created_by text, idempotency_key text);
    create table public.tour_orders(id integer primary key, marker text not null${columns});`);
  const values = shape === 'neither' ? '' : shape === 'missing' ? ", 'fake name'" : shape === 'wrong' ? ", 'fake name', 123" : ", 'fake name', 'fake phone'";
  await client.unsafe(`insert into public.tour_orders values (1, 'fixture-only'${values});`);
  await client`insert into supabase_migrations.schema_migrations(version, name, created_by, idempotency_key)
    values ('0087', ${"legacy$postledger$'\\Unicode測試"}, ${"prefix$baselineledger$'\\Unicode測試"}, null)`;
}

async function snapshot(client) {
  const ledger = await client`select version, name, created_by, idempotency_key from supabase_migrations.schema_migrations order by version`;
  const [columns] = await client.unsafe(COLUMN_QUERY);
  const data = await client`select to_jsonb(t) as row from public.tour_orders t order by id`;
  const shape = await client`select column_name, data_type, is_nullable, column_default
    from information_schema.columns where table_schema='public' and table_name='tour_orders' order by column_name`;
  return { ledger: ledger.map((row) => ({ ...row })), columns: { ...columns }, data: data.map((row) => row.row), shape: shape.map((row) => ({ ...row })) };
}

function construct(sql, before) {
  return buildAtomic0098TestBaselineSql({ sql, liveLedgerRows: before.ledger, liveColumns: before.columns });
}

async function executeRejecting(client, statement, code) {
  let error;
  try { await client.unsafe(statement); } catch (caught) { error = caught; }
  // A multi-statement simple-query exception can leave the session aborted.
  // Rollback precedes readback, and also releases any transaction advisory lock.
  await client.unsafe('rollback');
  assert.ok(error, 'EXPECTED_POSTGRES_REJECTION');
  assert.ok(String(error.message).includes(code), `EXPECTED_${code}`);
}

/** Real PG only. No injected/mock transport and no live-TEST parser bypass. */
export async function runDisposable0098PgFixtures(options) {
  // Re-admit before constructing a client, even for programmatic callers.
  const target = parseDisposable0098PgTarget(options.target?.connectionString, options.runId, options.explicitlyAllowed);
  const startedAt = new Date().toISOString();
  const clientOptions = buildDisposable0098PgClientOptions(target.connectionString, options.runId, options.explicitlyAllowed);
  const clients = [postgres(clientOptions), postgres(clientOptions)];
  const connections = [];
  const results = [];
  let ownsFixture = false;
  let failure;
  let cleanupStatus = 'NOT_RUN';
  let currentCase = 'target-isolation';
  try {
    const sql = readFileSync(resolve(fileURLToPath(new URL('../../', import.meta.url)), MIGRATION), 'utf8');
    // Pin admission occurs before any connection or fixture mutation.
    construct(sql, { ledger: [], columns: { table_exists: true, columns: [] } });
    connections.push(await clients[0].reserve());
    connections.push(await clients[1].reserve());
    const [client, other] = connections;
    await assertEmptyDatabase(client, target.database);
    ownsFixture = true;
    const runCase = async (name, shape, test) => {
      currentCase = name;
      await createFixture(client, shape);
      try { await test(client, other, await snapshot(client), sql); }
      finally {
        await other.unsafe('rollback');
        await removeOwnedFixture(client);
        await assertEmptyDatabase(client, target.database);
      }
      results.push({ name, status: 'PASS' });
    };
    for (const shape of ['both', 'neither', 'encoded']) {
      await runCase(`canonical-${shape}-columns-and-encoded-metadata`, shape, async (db, _other, before, source) => {
        const built = construct(source, before);
        await db.unsafe(built.sql);
        const after = await snapshot(db);
        assert.deepEqual(after.columns, built.expectedColumns);
        assert.deepEqual(Object.fromEntries(after.ledger.map((row) => [row.version, row])), built.expectedLedger);
        assert.deepEqual(after.data, before.data, 'NO_DATA_REWRITE');
        assert.deepEqual(after.shape.filter((column) => !column.column_name.startsWith('customer_')),
          before.shape.filter((column) => !column.column_name.startsWith('customer_')), 'UNRELATED_COLUMNS_UNCHANGED');
        assert.equal(after.ledger.length, before.ledger.length + 1);
      });
    }
    for (const shape of ['missing', 'wrong']) {
      await runCase(`reject-${shape}-column-shape`, shape, async (db, _other, before, source) => {
        assert.throws(() => construct(source, before), /TEST_BASELINE_COLUMN_SHAPE_NOT_ADMITTED/);
        assert.deepEqual(await snapshot(db), before);
      });
    }
    const histories = [
      ['0098', 'another-name', null],
      ['20261009000000', '0098_reconcile_tour_orders_legacy_contact_columns', null],
      ['20261009000000', 'reconcile_tour_orders_legacy_contact_columns', null],
      ['20261009000000', 'another-name', 'test-baseline-0098:existing'],
    ];
    for (const [index, history] of histories.entries()) {
      await runCase(`reject-existing-history-${index + 1}`, 'both', async (db, _other, _before, source) => {
        await db`insert into supabase_migrations.schema_migrations(version, name, created_by, idempotency_key)
          values (${history[0]}, ${history[1]}, null, ${history[2]})`;
        const before = await snapshot(db);
        assert.throws(() => construct(source, before), /TEST_BASELINE_0098_HISTORY_PRESENT/);
        assert.deepEqual(await snapshot(db), before);
      });
    }
    for (const kind of ['ledger', 'columns']) {
      await runCase(`locked-${kind}-race`, 'both', async (db, second, before, source) => {
        const built = construct(source, before);
        if (kind === 'ledger') await second`update supabase_migrations.schema_migrations set created_by='raced' where version='0087'`;
        else await second.unsafe('alter table public.tour_orders alter column customer_name set default \'raced\'');
        const raced = await snapshot(db);
        await executeRejecting(db, built.sql, `TEST_BASELINE_${kind.toUpperCase()}_CHANGED_AFTER_LOCK`);
        assert.deepEqual(await snapshot(db), raced);
      });
    }
    const faults = [
      ['post-ddl-ledger-insert-failure', `alter table supabase_migrations.schema_migrations add constraint fixture_reject_0098 check (version <> '0098')`, 'fixture_reject_0098'],
      ['post-ledger-mismatch', `create function public.fixture_0098_fault() returns trigger language plpgsql as $fault$ begin new.created_by := 'corrupted'; return new; end $fault$;
        create trigger fixture_fault before insert on supabase_migrations.schema_migrations for each row execute function public.fixture_0098_fault()`, 'TEST_BASELINE_POST_LEDGER_MISMATCH'],
      ['post-columns-mismatch', `create function public.fixture_0098_fault() returns trigger language plpgsql as $fault$ begin
        alter table public.tour_orders alter column customer_name set not null; return new; end $fault$;
        create trigger fixture_fault after insert on supabase_migrations.schema_migrations for each row execute function public.fixture_0098_fault()`, 'TEST_BASELINE_POST_COLUMNS_MISMATCH'],
    ];
    for (const [name, fixtureSql, error] of faults) {
      await runCase(name, 'both', async (db, _other, before, source) => {
        await db.unsafe(fixtureSql);
        await executeRejecting(db, construct(source, before).sql, error);
        assert.deepEqual(await snapshot(db), before, 'FULL_TRANSACTION_ROLLBACK');
      });
    }
    await runCase('two-connection-shared-advisory-lock', 'both', async (db, second, before, source) => {
      const [firstPid] = await db`select pg_backend_pid() as pid`;
      const [secondPid] = await second`select pg_backend_pid() as pid`;
      assert.notEqual(firstPid.pid, secondPid.pid, 'INDEPENDENT_POSTGRES_CONNECTIONS_REQUIRED');
      await second.unsafe('begin');
      try {
        await second`select pg_advisory_xact_lock(hashtextextended(${LOCK}, 0))`;
        await executeRejecting(db, construct(source, before).sql, 'G3_TEST_RELEASE_LOCK_BUSY');
        assert.deepEqual(await snapshot(db), before);
      } finally { await second.unsafe('rollback'); }
      const built = construct(source, before);
      await db.unsafe(built.sql);
      const after = await snapshot(db);
      assert.deepEqual(after.columns, built.expectedColumns);
      assert.deepEqual(Object.fromEntries(after.ledger.map((row) => [row.version, row])), built.expectedLedger);
      assert.deepEqual(after.data, before.data);
    });
  } catch (error) { failure = error; }
  finally {
    try {
      for (const connection of connections) await connection.unsafe('rollback');
      if (ownsFixture) {
        await removeOwnedFixture(connections[0]);
        await assertEmptyDatabase(connections[0], target.database);
        cleanupStatus = 'ZERO_OWNED_RESIDUE_VERIFIED';
      }
    } catch { cleanupStatus = 'CLEANUP_FAILED'; failure = new Error('DISPOSABLE_PG_CLEANUP_FAILED'); }
    finally {
      for (const connection of connections) connection.release();
      for (const client of clients) {
        try { await client.end({ timeout: 5 }); }
        catch { cleanupStatus = 'CLEANUP_FAILED'; failure = new Error('DISPOSABLE_PG_CLEANUP_FAILED'); }
      }
    }
  }
  // Do not serialize provider error messages, SQL, URLs, passwords or fake data.
  const evidence = { schemaVersion: 1, status: failure ? 'DISPOSABLE_PG_FIXTURE_FAILED' : 'DISPOSABLE_PG_0098_VERIFIED',
    fixtureRunId: options.runId, targetKind: 'LITERAL_LOOPBACK_DISPOSABLE_DATABASE',
    startedAt, completedAt: new Date().toISOString(), cases: results, cleanupStatus,
    failedCase: failure ? currentCase : null,
    canonicalTestStatus: 'NOT_RUN', productionMutationPerformed: false, databaseMutationAuthorized: false };
  if (options.outputPath) writeFileSync(options.outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
  if (failure) fail(cleanupStatus === 'CLEANUP_FAILED' ? 'DISPOSABLE_PG_CLEANUP_FAILED' : 'DISPOSABLE_PG_FIXTURE_FAILED');
  return evidence;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const options = parseDisposable0098PgArgs(process.argv.slice(2));
    console.log(JSON.stringify(await runDisposable0098PgFixtures(options), null, 2));
  } catch (error) {
    const code = error?.code;
    console.error(typeof code === 'string' && /^(?:DISPOSABLE_|INVALID_DISPOSABLE_)/.test(code) ? code : 'DISPOSABLE_PG_FIXTURE_FAILED');
    process.exitCode = 1;
  }
}
