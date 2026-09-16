import { describe, expect, it, vi } from 'vitest';

import { createProjectBoundProductionDbTransport, parseProjectBoundProductionDbWriterUrl } from '../../scripts/db/production-db-postgres-transport.mjs';

const PROD_URL = 'postgresql://production_migration_writer:secret@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full';

describe('project-bound Production PostgreSQL writer transport #447', () => {
  it.each([
    ['', /MISSING_PRODUCTION_DB_WRITER_URL/],
    ['not-a-url', /MALFORMED_PRODUCTION_DB_WRITER_URL/],
    ['postgresql://writer:x@db.nmwhwngojosmagjuvxol.supabase.co:5432/postgres?sslmode=verify-full', /WRITER_URL_PROJECT_MISMATCH/],
    ['postgresql://postgres:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full', /SUPERUSER_WRITER_FORBIDDEN/],
    ['postgresql://post%67res:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full', /SUPERUSER_WRITER_FORBIDDEN/],
    ['postgresql://writer:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require', /WRITER_ROLE_MISMATCH|WRITER_URL_TLS_VERIFICATION_REQUIRED/],
    ['postgresql://production_migration_writer:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require', /WRITER_URL_TLS_VERIFICATION_REQUIRED/],
  ])('fails closed before mutation for invalid credential %s', (url, error) => {
    expect(() => parseProjectBoundProductionDbWriterUrl(url)).toThrow(error);
  });

  it('checks database and role before any ledger read or mutation', async () => {
    const unsafe = vi.fn(async (query: string) => query.startsWith('select current_database')
      ? [{ database_name: 'postgres', database_user: 'production_migration_writer' }]
      : [{ version: '1', name: '0001_base' }]);
    const end = vi.fn(async () => undefined);
    const transport = createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: () => Object.assign(unsafe, { unsafe, end }) as any });
    await expect(transport.captureLedger()).resolves.toEqual([{ version: '1', name: '0001_base' }]);
    expect(unsafe.mock.calls.map(([sql]) => sql)).toEqual([
      'select current_database() as database_name, current_user as database_user',
      'select version, name from supabase_migrations.schema_migrations order by version',
    ]);
  });

  it('rejects a credential whose connected role is not the URL role before mutation', async () => {
    const unsafe = vi.fn(async () => [{ database_name: 'postgres', database_user: 'test_writer' }]);
    const end = vi.fn(async () => undefined);
    const transport = createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: () => Object.assign(unsafe, { unsafe, end }) as any });
    await expect(transport.executePlanBoundTransaction({
      sql: "begin;\nset local lock_timeout = '5s';\nselect pg_try_advisory_xact_lock(1);\nselect * from supabase_migrations.schema_migrations;\ncommit;",
      releaseId: 'release-447', mainSha: 'a'.repeat(40), planDigest: 'b'.repeat(64), preparedAttemptDigest: 'c'.repeat(64),
    })).rejects.toThrow(/WRITER_DATABASE_IDENTITY_MISMATCH/);
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('requires certificate and hostname verification in the client configuration', () => {
    const sqlFactory = vi.fn(() => Object.assign(vi.fn(), { unsafe: vi.fn(), end: vi.fn() }));
    createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: sqlFactory as any });
    expect(sqlFactory).not.toHaveBeenCalled();
    expect(parseProjectBoundProductionDbWriterUrl(PROD_URL).connectionString).toContain('sslmode=verify-full');
  });
});
