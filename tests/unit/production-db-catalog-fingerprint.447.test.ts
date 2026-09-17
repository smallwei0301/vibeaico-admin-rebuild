import { describe, expect, it } from 'vitest';

import {
  buildProductionDbCatalogFingerprintRecheckSql,
  normalizeProductionDbCatalogFingerprint,
  PRODUCTION_DB_CATALOG_FINGERPRINT_SQL,
} from '../../scripts/db/production-db-catalog-fingerprint.mjs';

describe('Issue #447 post-lock schema/ACL/RLS/writer-contract fingerprint', () => {
  const fingerprint = 'a'.repeat(64);

  it('normalizes only a real SHA-256 fingerprint', () => {
    expect(normalizeProductionDbCatalogFingerprint([{ catalog_fingerprint: fingerprint.toUpperCase() }])).toBe(fingerprint);
    expect(() => normalizeProductionDbCatalogFingerprint([])).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
    expect(() => normalizeProductionDbCatalogFingerprint([{ catalog_fingerprint: 'not-a-digest' }])).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
  });

  it('fingerprints schema, ownership, ACL, RLS, policies, routines, triggers and writer role state', () => {
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain("n.nspname in ('public', 'supabase_migrations')");
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relrowsecurity');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relforcerowsecurity');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('p.polroles');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_get_functiondef');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_get_triggerdef');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relowner');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relacl');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_auth_members');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('m.set_option');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('r.rolsuper');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('r.rolinherit');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_default_acl');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('aclexplode');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('production_migration_writer');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('production_migration_owner');
  });

  it('builds a fail-closed in-transaction recheck bound to the expected fingerprint', () => {
    const sql = buildProductionDbCatalogFingerprintRecheckSql(fingerprint);
    expect(sql).toContain(fingerprint);
    expect(sql).toContain('PRODUCTION_DB_CATALOG_CHANGED_AFTER_LOCK');
    expect(sql).toContain('pg_auth_members');
    expect(sql).toContain('pg_default_acl');
    expect(sql).toContain('raise exception');
    expect(() => buildProductionDbCatalogFingerprintRecheckSql('0'.repeat(63))).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
  });
});
