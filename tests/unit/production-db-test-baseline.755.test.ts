import { afterAll, describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildAtomic0098TestBaselineSql, validate0098TestBaselineFromCheckout } from '../../scripts/db/validate-production-db-release-on-test.mjs';

const FILE = '0098_reconcile_tour_orders_legacy_contact_columns';
const PATH = `supabase/migrations/${FILE}.sql`;
const SQL = readFileSync(PATH, 'utf8');
const TEST = 'nmwhwngojosmagjuvxol';
const empty = { table_exists: true, columns: [] };
const present = { table_exists: true, columns: ['customer_name', 'customer_phone'].map((column_name) =>
  ({ column_name, data_type: 'text', is_nullable: 'NO', column_default: null })) };
const row = (version = '0087', name = '0087_issue_8b_tour_orders') =>
  ({ version, name, created_by: null, idempotency_key: null });
const build = (liveLedgerRows: any[] = [], liveColumns: any = present, sql = SQL) =>
  buildAtomic0098TestBaselineSql({ sql, liveLedgerRows, liveColumns });

// Synthetic local Git origin exercises real admission, not a fake Git runner.
// This is unit-fixture evidence only, never proof of an upstream main checkout.
const fixture = mkdtempSync(join(tmpdir(), 'baseline-0098-unit-'));
const repoRoot = join(fixture, 'checkout');
const remote = join(fixture, 'origin.git');
mkdirSync(join(repoRoot, 'supabase/migrations'), { recursive: true });
writeFileSync(join(repoRoot, PATH), SQL);
const git = (...args: string[]) => execFileSync('git', ['-C', repoRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '--initial-branch=main');
git('config', 'user.name', 'Baseline Unit Fixture');
git('config', 'user.email', 'baseline-unit@example.invalid');
git('add', PATH);
git('commit', '-m', 'synthetic canonical-byte unit fixture');
execFileSync('git', ['clone', '--bare', repoRoot, remote], { stdio: 'ignore' });
git('remote', 'add', 'origin', remote);
git('fetch', 'origin', 'main');
const mainSha = git('rev-parse', 'HEAD');
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

function transport(options: { failApply?: boolean; afterLedger?: any[]; afterColumns?: any } = {}) {
  const calls: { readOnly: boolean; query: string }[] = [];
  const built = build([row()]);
  let applied = false;
  const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    expect(String(url)).toContain(`/projects/${TEST}/database/query`);
    const readOnly = String(url).endsWith('/read-only');
    const query = JSON.parse(String(init?.body)).query;
    calls.push({ readOnly, query });
    if (!readOnly) {
      if (options.failApply) throw new Error('simulated connection loss');
      applied = true;
      return new Response('[]', { status: 200 });
    }
    const rows = query.includes('to_regclass')
      ? [applied ? (options.afterColumns ?? built.expectedColumns) : present]
      : applied ? (options.afterLedger ?? Object.values(built.expectedLedger)) : [row()];
    return new Response(JSON.stringify(rows), { status: 200 });
  });
  return { calls, fetchImpl };
}
const input = { mainSha, repoRoot, token: 'synthetic-unit-token', sourceRunId: '1234', sourceRunAttempt: 1 };

describe('closed canonical 0098 TEST baseline #755', () => {
  it('keeps exact source inside one shared lock/transaction with ledger and shape checks before commit', () => {
    const built = build();
    expect(built.sql.match(/^begin;$/gm)).toHaveLength(1);
    expect(built.sql.match(/^commit;$/gm)).toHaveLength(1);
    expect(built.sql).toContain(SQL);
    expect(built.sql).toContain(`vibeaico-g3-test-release:${TEST}`);
    expect(built.sql.indexOf('TEST_BASELINE_COLUMNS_CHANGED_AFTER_LOCK')).toBeLessThan(built.sql.indexOf(SQL));
    expect(built.sql.indexOf(SQL)).toBeLessThan(built.sql.indexOf('insert into supabase_migrations'));
    expect(built.sql.indexOf('TEST_BASELINE_POST_COLUMNS_MISMATCH')).toBeLessThan(built.sql.lastIndexOf('commit;'));
    expect(built.sql.match(/insert into supabase_migrations/g)).toHaveLength(1);
    expect(built.ledger).toMatchObject({ version: '0098', name: FILE, created_by: 'vibeaico-test-baseline-0098' });
    expect(build([], empty).expectedColumns).toEqual(empty);
  });

  it('rejects changed SQL, existing/alias/conflicting history and malformed column shapes', () => {
    expect(() => build([], present, `${SQL}\n`)).toThrow(/SOURCE_PIN_MISMATCH/);
    for (const history of [row('0098', 'other'), row('20261009000000', FILE),
      row('20261009000000', 'reconcile_tour_orders_legacy_contact_columns'),
      { ...row(), idempotency_key: 'test-baseline-0098:old' }]) {
      expect(() => build([history])).toThrow(/0098_HISTORY_PRESENT/);
    }
    expect(() => build([row(), row()])).toThrow(/INVALID_TEST_BASELINE_LEDGER/);
    expect(() => build([{ version: '0087', name: 'bad' }])).toThrow(/INVALID_TEST_BASELINE_LEDGER/);
    for (const state of [{ ...empty, table_exists: false }, { ...present, columns: present.columns.slice(0, 1) },
      { ...present, columns: present.columns.map((column) => ({ ...column, data_type: 'integer' })) }]) {
      expect(() => build([], state)).toThrow(/COLUMN_SHAPE_NOT_ADMITTED/);
    }
  });

  it('keeps dollar tags, quotes and backslashes inside encoded metadata, never DO boundaries', () => {
    const history = { ...row(), name: 'legacy$postledger$suffix', created_by: "prefix$baselineledger$'\\suffix" };
    const columns = { ...present, columns: present.columns.map((column) =>
      ({ ...column, column_default: "'$baselinecolumns$\\''::text" })) };
    const built = build([history], columns);
    for (const tag of ['baselineledger', 'baselinecolumns', 'postledger', 'postcolumns']) {
      expect(built.sql.split(`$${tag}$`)).toHaveLength(3);
    }
    const decoded = [...built.sql.matchAll(/pg_catalog.decode\('([0-9a-f]+)', 'hex'\)/g)]
      .map((match) => JSON.parse(Buffer.from(match[1], 'hex').toString('utf8')));
    expect(decoded).toEqual([{ '0087': history }, columns, built.expectedLedger, built.expectedColumns]);
  });

  it('rejects wrong project, stale main and changed worktree before network', async () => {
    const fetchImpl = vi.fn();
    for (const projectRef of ['egehnijjpgijmccagxac', 'unknown']) {
      await expect(validate0098TestBaselineFromCheckout({ ...input, projectRef, fetchImpl })).rejects.toThrow(/TARGET/);
    }
    await expect(validate0098TestBaselineFromCheckout({ ...input, mainSha: 'a'.repeat(40), fetchImpl })).rejects.toThrow(/CHECKOUT_MISMATCH/);
    writeFileSync(join(repoRoot, PATH), `${SQL}\n`);
    try {
      await expect(validate0098TestBaselineFromCheckout({ ...input, fetchImpl })).rejects.toThrow(/WORKTREE_MIGRATION_DIFFERS_FROM_MAIN/);
    } finally { writeFileSync(join(repoRoot, PATH), SQL); }
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('requires actual post-ledger provenance and unchanged/repaired shape, without Production-plan evidence', async () => {
    const mock = transport();
    const evidence = await validate0098TestBaselineFromCheckout({ ...input, fetchImpl: mock.fetchImpl });
    expect(mock.calls.map((call) => call.readOnly)).toEqual([true, true, false, true, true]);
    expect(evidence).toMatchObject({ status: 'TEST_BASELINE_0098_VERIFIED', testProjectRef: TEST,
      mainSha, sourceRunId: '1234', testMutationPerformed: true, productionMutationPerformed: false,
      databaseMutationAuthorized: false, migration: { repoFile: FILE, ledger: { version: '0098' } } });
    expect(evidence).not.toHaveProperty('planDigest');
    expect(evidence).not.toHaveProperty('releaseId');
    expect(evidence.columnFingerprints.before).not.toBe(evidence.columnFingerprints.after);
    for (const afterLedger of [[], [row('0098', FILE)], [...Object.values(build([row()]).expectedLedger), row('9999', 'unexpected')]]) {
      const bad = transport({ afterLedger });
      await expect(validate0098TestBaselineFromCheckout({ ...input, fetchImpl: bad.fetchImpl })).rejects.toThrow(/POSTCHECK_UNKNOWN/);
      expect(bad.calls.filter((call) => !call.readOnly)).toHaveLength(1);
    }
    const changed = transport({ afterColumns: empty });
    await expect(validate0098TestBaselineFromCheckout({ ...input, fetchImpl: changed.fetchImpl })).rejects.toThrow(/POSTCHECK_UNKNOWN/);
  });

  it('leaves a lost mutable outcome unknown and never retries', async () => {
    const mock = transport({ failApply: true });
    await expect(validate0098TestBaselineFromCheckout({ ...input, fetchImpl: mock.fetchImpl })).rejects.toThrow(/APPLY_UNKNOWN/);
    expect(mock.calls.map((call) => call.readOnly)).toEqual([true, true, false]);
  });
});
