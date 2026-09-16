import { describe, expect, it, vi } from 'vitest';

import { createProjectBoundProductionDbTransport, parseProjectBoundProductionDbWriterUrl } from '../../scripts/db/production-db-postgres-transport.mjs';

const PROD_URL = 'postgresql://production_migration_writer:secret@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full';
const POOLER_URL = 'postgresql://production_migration_writer.egehnijjpgijmccagxac:secret@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';

describe('project-bound Production PostgreSQL writer transport #447', () => {
  it.each([
    ['', /MISSING_PRODUCTION_DB_WRITER_URL/],
    ['not-a-url', /MALFORMED_PRODUCTION_DB_WRITER_URL/],
    ['postgresql://writer:x@db.nmwhwngojosmagjuvxol.supabase.co:5432/postgres?sslmode=verify-full', /WRITER_URL_PROJECT_MISMATCH/],
    ['postgresql://postgres:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full', /ADMIN_WRITER_FORBIDDEN/],
    ['postgresql://post%67res:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=verify-full', /ADMIN_WRITER_FORBIDDEN/],
    ['postgresql://writer:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require', /WRITER_ROLE_MISMATCH|WRITER_URL_TLS_VERIFICATION_REQUIRED/],
    ['postgresql://production_migration_writer:x@db.egehnijjpgijmccagxac.supabase.co:5432/postgres?sslmode=require', /WRITER_URL_TLS_VERIFICATION_REQUIRED/],
    ['postgresql://production_migration_writer.egehnijjpgijmccagxac:x@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=verify-full', /WRITER_URL_SESSION_MODE_REQUIRED/],
    ['postgresql://postgres.egehnijjpgijmccagxac:x@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full', /ADMIN_WRITER_FORBIDDEN/],
  ])('fails closed before mutation for invalid credential %s', (url, error) => {
    expect(() => parseProjectBoundProductionDbWriterUrl(url)).toThrow(error);
  });

  it('accepts only a project-bound Supavisor SESSION identity when direct IPv6 is unavailable', () => {
    expect(parseProjectBoundProductionDbWriterUrl(POOLER_URL)).toMatchObject({
      projectRef: 'egehnijjpgijmccagxac',
      role: 'production_migration_writer',
      ownerRole: 'production_migration_owner',
      port: '5432',
      transportMode: 'SUPAVISOR_SESSION',
    });
  });

  it('checks database, current role and session role before any ledger read', async () => {
    const unsafe = vi.fn(async (query: string) => query.startsWith('select current_database')
      ? [{ database_name: 'postgres', database_user: 'production_migration_writer', session_user: 'production_migration_writer' }]
      : [{ version: '1', name: '0001_base' }]);
    const end = vi.fn(async () => undefined);
    const transport = createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: (() => Object.assign(unsafe, { unsafe, end })) as any });
    await expect(transport.captureLedger()).resolves.toEqual([{ version: '1', name: '0001_base' }]);
    expect(unsafe.mock.calls.map(([sql]) => sql)).toEqual([
      'select current_database() as database_name, current_user as database_user, session_user as session_user',
      'select version, name from supabase_migrations.schema_migrations order by version',
    ]);
  });

  it('rejects a credential whose connected role is not the dedicated writer before any ledger access', async () => {
    const unsafe = vi.fn(async () => [{ database_name: 'postgres', database_user: 'test_writer', session_user: 'test_writer' }]);
    const end = vi.fn(async () => undefined);
    const transport = createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: (() => Object.assign(unsafe, { unsafe, end })) as any });
    await expect(transport.captureLedger()).rejects.toThrow(/WRITER_DATABASE_IDENTITY_MISMATCH/);
    expect(unsafe).toHaveBeenCalledTimes(1);
  });

  it('does not expose a raw SQL mutable transport surface', () => {
    const unsafe = vi.fn();
    const end = vi.fn(async () => undefined);
    const transport = createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: (() => Object.assign(unsafe, { unsafe, end })) as any });
    expect('executePlanBoundTransaction' in transport).toBe(false);
    expect(Object.keys(transport)).toEqual(expect.arrayContaining(['captureLedger', 'captureCatalogFingerprint', 'captureCredentialCapabilities']));
  });

  it('requires certificate and hostname verification in the client configuration', () => {
    const sqlFactory = vi.fn(() => Object.assign(vi.fn(), { unsafe: vi.fn(), end: vi.fn() }));
    createProjectBoundProductionDbTransport({ connectionString: PROD_URL, sqlFactory: sqlFactory as any });
    expect(sqlFactory).not.toHaveBeenCalled();
    expect(parseProjectBoundProductionDbWriterUrl(PROD_URL).connectionString).toContain('sslmode=verify-full');
  });
});
