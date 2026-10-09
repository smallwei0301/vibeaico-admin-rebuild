import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseDisposable0098PgTarget, parseDisposable0098PgArgs, buildDisposable0098PgClientOptions } from '../../scripts/test/production-db-test-baseline-0098-postgres.mjs';
import postgres from 'postgres';
import { parseProjectBoundTestDbReleaseUrl } from '../../scripts/db/validate-production-db-release-on-test.mjs';

const runId = '20261009abc123';
const local = `postgres://postgres:fake-local-password@127.0.0.1:55432/vibeai_843_${runId}`;
const admit = (url = local, run = runId, allowed = true) => parseDisposable0098PgTarget(url, run, allowed);

describe('disposable PostgreSQL 0098 fixture boundary #755', () => {
  it('requires an explicit grant, exact run-bound database, and a literal loopback target', () => {
    expect(admit()).toMatchObject({ database: `vibeai_843_${runId}`, host: '127.0.0.1', port: 55432 });
    expect(admit(local.replace('127.0.0.1', '[::1]'))).toMatchObject({ host: '::1' });
    expect(() => admit(local, runId, false)).toThrow(/DISPOSABLE_LOCAL_PG_OPT_IN_REQUIRED/);
    for (const value of ['', 'short', 'has-hyphen', 'x'.repeat(25)]) {
      expect(() => admit(local, value)).toThrow(/INVALID_DISPOSABLE_PG_RUN_ID/);
    }
  });

  it.each([
    local.replace('127.0.0.1', 'localhost'),
    local.replace('127.0.0.1', '127.1'),
    local.replace('127.0.0.1', '127.0.0.1.example.invalid'),
    local.replace('127.0.0.1', 'aws-1-ap-northeast-1.pooler.supabase.com'),
    local.replace(`vibeai_843_${runId}`, 'postgres'),
    local.replace(`vibeai_843_${runId}`, 'vibeai_843_other123'),
    local.replace('postgres:fake-', 'postgres.nmwhwngojosmagjuvxol:fake-'),
    local.replace('postgres:fake-', 'production_migration_writer:fake-'),
    `${local}?options=-csearch_path%3Dpublic`,
    `${local}?sslmode=disable`,
    `${local}#fragment`,
    local.replace(':55432', ':443'),
    local.replace('postgres://', 'https://'),
  ])('rejects unsafe targets without echoing the supplied URL', (url) => {
    expect(() => admit(url)).toThrow(/DISPOSABLE_PG_TARGET_NOT_ADMITTED/);
    try { admit(url); } catch (error) {
      expect((error as Error).message).not.toContain('fake-local-password');
      expect((error as Error).message).not.toContain(url);
    }
  });

  it('keeps canonical TEST parsing strict rather than disguising the local fixture as TEST', () => {
    expect(() => parseProjectBoundTestDbReleaseUrl(local)).toThrow(/TEST_RELEASE_URL/);
    expect(() => admit('postgres://postgres.egehnijjpgijmccagxac:fake@aws-1-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full')).toThrow(/DISPOSABLE_PG_TARGET_NOT_ADMITTED/);
  });

  it('passes admitted scalar fields to the driver instead of reparsing a multi-host raw URL', async () => {
    const hostile = `postgres://postgres:fake@attacker.example.invalid,unused@127.0.0.1:55432/vibeai_843_${runId}`;
    // postgres() construction is lazy: inspecting options makes no connection.
    for (const [url, host, password] of [[hostile, '127.0.0.1', 'fake@attacker.example.invalid,unused'],
      [local.replace('127.0.0.1', '[::1]'), '::1', 'fake-local-password'],
      [local.replace('fake-local-password', 'fake%40word%3Awith%2Fsymbols'), '127.0.0.1', 'fake@word:with/symbols']]) {
      const options = buildDisposable0098PgClientOptions(url, runId, true);
      // 3.4.9 parseOptions accepts arrays; Options narrows BaseOptions' array
      // types incorrectly. Keep the boundary local and verify actual options.
      const client = postgres(options as unknown as postgres.Options<{}>);
      try {
        expect(client.options.host).toEqual([host]);
        expect(client.options.port).toEqual([55432]);
        expect(client.options.database).toBe(`vibeai_843_${runId}`);
        expect(client.options.user).toBe('postgres');
        expect(client.options.pass).toBe(password);
        expect(JSON.stringify(options)).not.toContain('connectionString');
      } finally { await client.end(); }
    }
    expect(() => buildDisposable0098PgClientOptions(local.replace('fake-local-password', '%zz'), runId, true)).toThrow(/DISPOSABLE_PG_TARGET_NOT_ADMITTED/);
    const source = readFileSync('scripts/test/production-db-test-baseline-0098-postgres.mjs', 'utf8');
    expect(source).not.toContain('postgres(target.connectionString');
  });

  it('uses only its explicit fixture URL and rejects incomplete, duplicate or foreign CLI arguments', () => {
    const env = { BASELINE_0098_LOCAL_DATABASE_URL: local, TEST_DB_RELEASE_URL: 'unused-remote', SUPABASE_ACCESS_TOKEN: 'unused-token' };
    expect(parseDisposable0098PgArgs(['--allow-disposable-local-pg', '--run-id', runId], env)).toMatchObject({ runId, target: { database: `vibeai_843_${runId}` } });
    for (const args of [[], ['--run-id', runId], ['--allow-disposable-local-pg'],
      ['--allow-disposable-local-pg', '--run-id', runId, '--run-id', runId],
      ['--allow-disposable-local-pg', '--run-id', runId, '--sql', 'select 1']]) {
      expect(() => parseDisposable0098PgArgs(args, env)).toThrow();
    }
    expect(() => parseDisposable0098PgArgs(['--allow-disposable-local-pg', '--run-id', runId], { TEST_DB_RELEASE_URL: local })).toThrow(/DISPOSABLE_PG_TARGET_NOT_ADMITTED/);
  });

  it('remains a separately invoked fixture runner with no unit/globalSetup or remote credential routing', () => {
    const source = readFileSync('scripts/test/production-db-test-baseline-0098-postgres.mjs', 'utf8');
    expect(source).toContain('buildAtomic0098TestBaselineSql');
    expect(source).toContain('fileURLToPath(import.meta.url) === resolve(process.argv[1])');
    expect(source).not.toMatch(/TEST_DB_RELEASE_(?:TOKEN|URL)|SUPABASE_ACCESS_TOKEN|global-setup|vitest\.integration/);
    expect(readFileSync('package.json', 'utf8')).not.toContain('production-db-test-baseline-0098-postgres.mjs');
  });
});
