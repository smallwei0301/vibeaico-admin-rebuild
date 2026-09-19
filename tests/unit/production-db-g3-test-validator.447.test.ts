import { describe, expect, it, vi } from 'vitest';

import {
  assertTestReleaseTarget,
  buildAtomicTestReleaseValidationSql,
  buildTestReleasePlanFromCheckout,
  parseProjectBoundTestDbReleaseUrl,
  validateProductionDbReleasePlanOnTest,
} from '../../scripts/db/validate-production-db-release-on-test.mjs';
import {
  releasePlanDigestOf,
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
    const actualPlan = buildTestReleasePlanFromCheckout({
      releaseId: 'release-20260915-g3-direct-url',
      mainSha: MAIN,
      plannedAt: '2026-09-15T00:17:00Z',
      repoRoot: process.cwd(),
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
      runner: fakeGitRunner as any,
      fetchImpl: fetchSpy as unknown as typeof fetch,
    });

    expect(calls.map((call) => call.readOnly)).toEqual([true, false, true]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(evidence).toMatchObject({ status: 'TEST_RELEASE_PLAN_VERIFIED', testMutationPerformed: true, productionMutationPerformed: false });
  });

  it('accepts a project-bound PostgreSQL URL through the existing TEST_DB_RELEASE_TOKEN secret interface', async () => {
    const actualPlan = buildTestReleasePlanFromCheckout({ releaseId: 'release-20260915-g3-token-url', mainSha: MAIN, plannedAt: '2026-09-15T00:17:00Z', repoRoot: process.cwd(), runner: fakeGitRunner as any });
    let reads = 0;
    const directQuery = vi.fn(async ({ readOnly }) => {
      if (!readOnly) return [];
      reads += 1;
      return reads === 1 ? [] : actualPlan.migrations.map((migration: any) => ({ version: migration.ledgerVersion, name: migration.repoFile, created_by: 'vibeaico-g3-test-validator', idempotency_key: `g3:${actualPlan.releaseId}:${migration.repoFile}` }));
    });
    const evidence = await validateProductionDbReleasePlanOnTest({ plan: actualPlan, token: TEST_URL, directQuery, projectRef: TEST, sourceRunId: '123', sourceRunAttempt: 1, runner: fakeGitRunner as any, fetchImpl: vi.fn() as unknown as typeof fetch });
    expect(evidence.status).toBe('TEST_RELEASE_PLAN_VERIFIED');
    expect(directQuery).toHaveBeenCalledTimes(3);
  });
});
