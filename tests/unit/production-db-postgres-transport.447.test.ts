import { describe, expect, it, vi } from 'vitest';

import { createProjectBoundProductionDbTransport, parseProjectBoundProductionDbWriterUrl } from '../../scripts/db/production-db-postgres-transport.mjs';

const PROD_URL = 'postgresql://production_migration_writer:secret@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require';

describe('project-bound Production PostgreSQL writer transport #447', () => {
  it.each([
    ['', /MISSING_PRODUCTION_DB_WRITER_URL/],
    ['not-a-url', /MALFORMED_PRODUCTION_DB_WRITER_URL/],
    ['postgresql://writer:x@db.nmwhwngojosmagjuvxol.supabase.co:5432/postgres?sslmode=require', /WRITER_URL_PROJECT_MISMATCH/],
    ['postgresql://postgres:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require', /SUPERUSER_WRITER_FORBIDDEN/],
    ['postgresql://writer:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres', /WRITER_URL_TLS_REQUIRED/],
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
    await expect(transport.executeAtomic('begin; select 1; commit;')).rejects.toThrow(/WRITER_DATABASE_IDENTITY_MISMATCH/);
    expect(unsafe).toHaveBeenCalledTimes(1);
  });
});
