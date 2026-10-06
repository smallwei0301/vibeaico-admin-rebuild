import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import {
  assertTestReleaseTarget,
  buildAtomicTestReleaseValidationSql,
  buildTestReleasePlanFromCheckout,
  parseProjectBoundTestDbReleaseUrl,
  validateProductionDbReleasePlanOnTest,
} from '../../scripts/db/validate-production-db-release-on-test.mjs';
import {
  buildProductionDbReleasePlan,
  releasePlanDigestOf,
  splitSqlStatements,
  sha256,
} from '../../scripts/agents/production-db-release-plan.mjs';

const MAIN = 'a'.repeat(40);
const PROD = 'egehnijjpgijmccagxac';
const TEST = 'nmwhwngojosmagjuvxol';
const SQL = 'create table if not exists public.g3_release_guard(id bigint primary key);';
const REPO_FILE = '0999_g3_release_guard';
const PATH = `supabase/migrations/${REPO_FILE}.sql`;
const LEDGER_VERSION = '20260915081700';
const TEST_URL = 'postgresql://postgres.nmwhwngojosmagjuvxol:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';

function aliasMap() {
  return {
    schemaVersion: 1,
    entries: [
      {
        repoFile: REPO_FILE,
        classification: 'NOT_APPLIED',
        notAppliedReason: 'PENDING_APPLY',
        ledgerNames: [],
      },
    ],
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  const value: any = {
    schemaVersion: 1,
    releaseId: 'release-20260915-g3-test',
    repository: 'smallwei0301/vibeaico-admin-rebuild',
    productionProjectRef: PROD,
    mainSha: MAIN,
    plannedAt: '2026-09-15T00:17:00Z',
    riskTier: 'ADDITIVE',
    migrations: [
      {
        repoFile: REPO_FILE,
        path: PATH,
        sha256: sha256(Buffer.from(SQL)),
        riskTier: 'ADDITIVE',
        ledgerVersion: LEDGER_VERSION,
      },
    ],
  };
  Object.assign(value, overrides);
  value.planDigest = releasePlanDigestOf(value);
  return value;
}

const readCanonicalSql = (path: string) => {
  if (path !== PATH) throw new Error(`unexpected path ${path}`);
  return SQL;
};

function fakeGitRunner(command: string, args: string[]) {
  const gitArgs = args.slice(2);
  if (gitArgs[0] === 'fetch') return { status: 0, stdout: '', stderr: '' };
  if (gitArgs[0] === 'rev-parse' && (gitArgs[1] === 'HEAD' || gitArgs[1] === 'origin/main')) {
    return { status: 0, stdout: `${MAIN}\n`, stderr: '' };
  }
  return { status: 1, stdout: '', stderr: 'unexpected git invocation' };
}

// Transport success fixtures must be atomically admissible. A FULL_PENDING_SET
// from the real repository includes 0135's BEGIN/COMMIT wrapper and must fail.
const fixtureRoots: string[] = [];
afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function sourceFixture(sql = SQL) {
  const repoRoot = mkdtempSync(join(tmpdir(), 'g3-atomic-source-'));
  fixtureRoots.push(repoRoot);
  mkdirSync(join(repoRoot, 'supabase/migrations'), { recursive: true });
  writeFileSync(join(repoRoot, 'supabase/ledger-alias-map.json'), JSON.stringify(aliasMap()));
  writeFileSync(join(repoRoot, PATH), sql);
  return repoRoot;
}

function buildWithSql(sql: string, liveLedgerRows: any[] = []) {
  const source = () => sql;
  const releasePlan = buildProductionDbReleasePlan({
    releaseId: 'release-20261005-atomic-admission', mainSha: MAIN,
    plannedAt: '2026-10-05T00:00:00Z', aliasMap: aliasMap(), readCanonicalSql: source,
  });
  return buildAtomicTestReleaseValidationSql({
    plan: releasePlan, aliasMap: aliasMap(), liveLedgerRows, readCanonicalSql: source,
  });
}

describe('Production DB G3 exact-plan TEST validator #447', () => {
  it('rejects Production before any network request', async () => {
    const fetchSpy = vi.fn();
    await expect(validateProductionDbReleasePlanOnTest({
      plan: plan(),
      token: 'scoped-test-token',
      projectRef: PROD,
      sourceRunId: '123',
      sourceRunAttempt: 1,
      runner: fakeGitRunner as any,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    })).rejects.toThrow(/PRODUCTION_TARGET_FORBIDDEN/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects any non-canonical TEST project', () => {
    expect(() => assertTestReleaseTarget('other-project')).toThrow(/CANONICAL_TEST_TARGET_REQUIRED/);
    expect(assertTestReleaseTarget(TEST)).toBe(TEST);
  });

  it('accepts only the canonical TEST session connection and rejects a Production-shaped URL', () => {
    expect(parseProjectBoundTestDbReleaseUrl(TEST_URL)).toMatchObject({ projectRef: TEST, transportMode: 'SUPAVISOR_SESSION' });
    expect(() => parseProjectBoundTestDbReleaseUrl(TEST_URL.replace('nmwhwngojosmagjuvxol', PROD))).toThrow(/TEST_RELEASE_URL_PROJECT_MISMATCH/);
  });

  it('fails closed when the canonical migration bytes differ from the locked release plan', () => {
    const stale = plan();
    stale.migrations[0].sha256 = 'b'.repeat(64);
    stale.planDigest = releasePlanDigestOf(stale);
    expect(() => buildAtomicTestReleaseValidationSql({
      plan: stale,
      aliasMap: aliasMap(),
      liveLedgerRows: [],
      readCanonicalSql,
    })).toThrow(/MIGRATION_BYTES_MISMATCH/);
  });

  it('rejects a TEST ledger version collision before constructing an apply transaction', () => {
    expect(() => buildAtomicTestReleaseValidationSql({
      plan: plan(),
      aliasMap: aliasMap(),
      liveLedgerRows: [
        {
          version: LEDGER_VERSION,
          name: 'some_other_migration',
          created_by: 'someone-else',
          idempotency_key: 'other-key',
        },
      ],
      readCanonicalSql,
    })).toThrow(/TEST_LEDGER_VERSION_COLLISION/);
  });

  it('does not replay DDL for an already-present TEST migration or insert a duplicate ledger row', () => {
    const built = buildAtomicTestReleaseValidationSql({
      plan: plan(),
      aliasMap: aliasMap(),
      liveLedgerRows: [
        {
          version: '20260914060524',
          name: REPO_FILE,
          created_by: 'historical-test-apply',
          idempotency_key: null,
        },
      ],
      readCanonicalSql,
    });

    expect(built.decisions).toEqual([
      expect.objectContaining({ repoFile: REPO_FILE, existedBefore: true }),
    ]);
    expect(built.sql).toContain(`G3 replay verification ${REPO_FILE}`);
    expect(built.sql).not.toContain(SQL);
    expect(built.sql).not.toMatch(/insert into supabase_migrations\.schema_migrations/);
  });

  it('adds exactly one TEST ledger insert when the planned migration is not yet present', () => {
    const built = buildAtomicTestReleaseValidationSql({
      plan: plan(),
      aliasMap: aliasMap(),
      liveLedgerRows: [],
      readCanonicalSql,
    });
    expect(built.decisions).toEqual([
      expect.objectContaining({ repoFile: REPO_FILE, existedBefore: false }),
    ]);
    expect(built.sql.match(/insert into supabase_migrations\.schema_migrations/g)).toHaveLength(1);
    expect(built.sql).toContain(`g3:release-20260915-g3-test:${REPO_FILE}`);
  });

  it('uses a project-bound TEST connection for the two ledger reads and one atomic apply without calling the Management API', async () => {
    const repoRoot = sourceFixture();
    const actualPlan = buildTestReleasePlanFromCheckout({
      releaseId: 'release-20260915-g3-direct-url',
      mainSha: MAIN,
      plannedAt: '2026-09-15T00:17:00Z',
      repoRoot,
      runner: fakeGitRunner as any,
    });
    const calls: Array<{ sql: string; readOnly: boolean }> = [];
    let ledgerRead = 0;
    const directQuery = vi.fn(async ({ sql, readOnly }) => {
      calls.push({ sql, readOnly });
      if (readOnly) {
        ledgerRead += 1;
        return ledgerRead === 1
          ? []
          : actualPlan.migrations.map((migration: any) => ({
            version: migration.ledgerVersion,
            name: migration.repoFile,
            created_by: 'vibeaico-g3-test-validator',
            idempotency_key: `g3:${actualPlan.releaseId}:${migration.repoFile}`,
          }));
      }
      expect(sql).toContain('pg_try_advisory_xact_lock');
      return [];
    });
    const fetchSpy = vi.fn();

    const evidence = await validateProductionDbReleasePlanOnTest({
      plan: actualPlan,
      connectionString: TEST_URL,
      directQuery,
      projectRef: TEST,
      sourceRunId: '123',
      sourceRunAttempt: 1,
      repoRoot,
      runner: fakeGitRunner as any,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(calls.map((call) => call.readOnly)).toEqual([true, false, true]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ status: 'TEST_RELEASE_PLAN_VERIFIED', testMutationPerformed: true, productionMutationPerformed: false });
  });

  it('accepts a project-bound PostgreSQL URL through the existing TEST_DB_RELEASE_TOKEN secret interface', async () => {
    const repoRoot = sourceFixture();
    const actualPlan = buildTestReleasePlanFromCheckout({ releaseId: 'release-20260915-g3-token-url', mainSha: MAIN, plannedAt: '2026-09-15T00:17:00Z', repoRoot, runner: fakeGitRunner as any });
    let reads = 0;
    const directQuery = vi.fn(async ({ readOnly }) => {
      if (!readOnly) return [];
      reads += 1;
      return reads === 1 ? [] : actualPlan.migrations.map((migration: any) => ({ version: migration.ledgerVersion, name: migration.repoFile, created_by: 'vibeaico-g3-test-validator', idempotency_key: `g3:${actualPlan.releaseId}:${migration.repoFile}` }));
    });
    const evidence = await validateProductionDbReleasePlanOnTest({ plan: actualPlan, token: TEST_URL, directQuery, projectRef: TEST, sourceRunId: '123', sourceRunAttempt: 1, repoRoot, runner: fakeGitRunner as any, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(evidence.status).toBe('TEST_RELEASE_PLAN_VERIFIED');
    expect(directQuery).toHaveBeenCalledTimes(3);
  });
});


describe('G3 atomic SQL admission #755', () => {
  it.each([
    'BEGIN', 'BEGIN WORK', 'START TRANSACTION', 'COMMIT', 'COMMIT AND CHAIN',
    'ROLLBACK', 'ROLLBACK TO SAVEPOINT s', 'ABORT', 'END', 'END WORK',
    'SAVEPOINT s', 'RELEASE SAVEPOINT s', 'RELEASE s',
    'SET TRANSACTION READ ONLY', 'SET LOCAL TRANSACTION READ ONLY',
    'SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY',
  ])('rejects top-level transaction control: %s', (command) => {
    expect(() => buildWithSql(`${SQL} /* nested /* comment */ */ ${command};`))
      .toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
  });

  it.each([
    "SET LOCAL lock_timeout = '0'", "SET SESSION statement_timeout = '0'",
    'SET ROLE postgres', 'RESET ALL', 'DISCARD ALL',
  ])('rejects writer configuration overrides: %s', (command) => {
    expect(() => buildWithSql(`${SQL} ${command};`)).toThrow(/WRITER_CONFIGURATION_NOT_ADMITTED/);
  });

  it.each(['commit', 'rollback'])('rejects transaction control in a stored routine: %s', (command) => {
    expect(() => buildWithSql(`create function public.g3_bad() returns void language plpgsql as $body$ begin ${command}; end $body$;`))
      .toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
  });

  it('preserves earlier classifier rejection of immediate procedural transaction control', () => {
    expect(() => buildWithSql('do $body$ begin commit; end $body$;'))
      .toThrow(/UNSUPPORTED_AUTHZ_SQL_NOT_ADMITTED/);
    expect(() => buildWithSql("PREPARE TRANSACTION 'g3';"))
      .toThrow(/UNSUPPORTED_DYNAMIC_SQL_NOT_ADMITTED/);
  });

  it('admits procedural BEGIN/END and transaction words used only as literals or identifiers', () => {
    const sql = `${SQL}
      -- COMMIT; ROLLBACK;
      do $body$ begin raise notice 'BEGIN; COMMIT; ROLLBACK;'; end $body$;
      create function public.g3_safe() returns text language plpgsql as $body$
      begin return $text$COMMIT; ROLLBACK;$text$; end $body$;
      create table public.g3_quoted("commit" text default 'ROLLBACK; BEGIN;');`;
    const built = buildWithSql(sql);
    expect(built.sql).toContain(sql);
    expect(splitSqlStatements(built.sql).filter((statement: string) => /^(begin|commit)$/i.test(statement.trim())))
      .toEqual(['begin', 'commit']);
    expect(built.sql).toContain('pg_try_advisory_xact_lock');
    expect(built.sql.match(/insert into supabase_migrations\.schema_migrations/g)).toHaveLength(1);
  });

  it('retains no-DDL/no-insert replay verification for a safe existing ledger identity', () => {
    const built = buildWithSql(SQL, [{ name: REPO_FILE, version: '20260914060524' }]);
    expect(built.decisions[0].existedBefore).toBe(true);
    expect(built.sql).not.toContain(SQL);
    expect(built.sql).not.toContain('insert into supabase_migrations.schema_migrations');
  });

  it('refuses exact canonical 0135 bytes in the eight-migration closure', () => {
    const repoRoot = process.cwd();
    const source = (path: string) => readFileSync(resolve(repoRoot, path), 'utf8');
    const aliases = JSON.parse(source('supabase/ledger-alias-map.json'));
    const releasePlan = buildProductionDbReleasePlan({
      releaseId: 'release-20261005-0135-wrapper', mainSha: MAIN,
      plannedAt: '2026-10-05T00:00:00Z', migrationScope: 'ISSUE_46_0110_0136_CLOSURE',
      aliasMap: aliases, readCanonicalSql: source,
    });
    expect(releasePlan.migrations).toHaveLength(8);
    const wrapper = releasePlan.migrations.find((migration: any) => migration.repoFile.startsWith('0135_'));
    if (!wrapper) throw new Error('canonical closure must contain migration 0135');
    expect(splitSqlStatements(source(wrapper.path)).filter((statement: string) => /^(begin|commit)$/i.test(statement.trim())))
      .toEqual(['begin', 'commit']);
    // Synthetic constructor-only baseline, never live G2 / TEST evidence.
    const existing = releasePlan.migrations.slice(0, 6).map((migration: any) => ({ name: migration.repoFile, version: migration.ledgerVersion }));
    expect(() => buildAtomicTestReleaseValidationSql({ plan: releasePlan, aliasMap: aliases, liveLedgerRows: existing, readCanonicalSql: source }))
      .toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED: 0135_/);
  });

  it.each(['direct', 'management'])('never sends an unsafe migration to the %s mutation transport', async (transport) => {
    const repoRoot = sourceFixture(`BEGIN; ${SQL} COMMIT;`);
    const releasePlan = buildTestReleasePlanFromCheckout({
      releaseId: 'release-20261005-block-transport', mainSha: MAIN,
      plannedAt: '2026-10-05T00:00:00Z', repoRoot, runner: fakeGitRunner as any,
    });
    const directQuery = vi.fn(async () => []);
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => [] }));
    await expect(validateProductionDbReleasePlanOnTest({
      plan: releasePlan, repoRoot, projectRef: TEST, sourceRunId: '123', sourceRunAttempt: 1,
      runner: fakeGitRunner as any, directQuery, fetchImpl: fetchSpy as unknown as typeof fetch,
      ...(transport === 'direct' ? { connectionString: TEST_URL } : { token: 'scoped-test-token' }),
    })).rejects.toThrow(/TRANSACTION_CONTROL_NOT_ADMITTED/);
    if (transport === 'direct') {
      expect(directQuery).toHaveBeenCalledTimes(1);
      expect(directQuery).toHaveBeenCalledWith(expect.objectContaining({ readOnly: true }));
      expect(fetchSpy).not.toHaveBeenCalled();
    } else {
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(fetchSpy).toHaveBeenCalledWith(expect.stringMatching(/\/database\/query\/read-only$/), expect.any(Object));
      expect(directQuery).not.toHaveBeenCalled();
    }
  });
});
