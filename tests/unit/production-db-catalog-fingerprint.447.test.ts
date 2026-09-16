import { describe, expect, it } from 'vitest';

import {
  buildProductionDbCatalogFingerprintRecheckSql,
  normalizeProductionDbCatalogFingerprint,
  PRODUCTION_DB_CATALOG_FINGERPRINT_SQL,
} from '../../scripts/db/production-db-catalog-fingerprint.mjs';

describe('Issue #447 post-lock schema/ACL/RLS fingerprint', () => {
  const fingerprint = 'a'.repeat(64);

  it('normalizes only a real SHA-256 fingerprint', () => {
    expect(normalizeProductionDbCatalogFingerprint([{ catalog_fingerprint: fingerprint.toUpperCase() }])).toBe(fingerprint);
    expect(() => normalizeProductionDbCatalogFingerprint([])).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
    expect(() => normalizeProductionDbCatalogFingerprint([{ catalog_fingerprint: 'not-a-digest' }])).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
  });

  it('fingerprints schema, ownership, ACL, RLS, policies, routines and triggers', () => {
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain("n.nspname in ('public', 'supabase_migrations')");
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relrowsecurity');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relforcerowsecurity');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('p.polroles');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_get_functiondef');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('pg_get_triggerdef');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relowner');
    expect(PRODUCTION_DB_CATALOG_FINGERPRINT_SQL).toContain('c.relacl');
  });

  it('builds a fail-closed in-transaction recheck bound to the expected fingerprint', () => {
    const sql = buildProductionDbCatalogFingerprintRecheckSql(fingerprint);
    expect(sql).toContain(fingerprint);
    expect(sql).toContain('PRODUCTION_DB_CATALOG_CHANGED_AFTER_LOCK');
    expect(sql).toContain('raise exception');
    expect(() => buildProductionDbCatalogFingerprintRecheckSql('0'.repeat(63))).toThrow(/PRODUCTION_DB_CATALOG_FINGERPRINT_INVALID/);
  });
});
