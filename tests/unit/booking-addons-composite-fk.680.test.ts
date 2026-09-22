import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';

import {
  assertDisposableTarget,
  buildCases,
  MIGRATION,
} from '../../scripts/test/verify-booking-addons-composite-fk-schema.mjs';

const safeEnv = {
  TEST_PROFILE: 'LOCAL_ISOLATED',
  LOCAL_PROJECT_ID: 'schema-proof-680',
  EXPECTED_HEAD: 'a'.repeat(40),
  TEST_SUPABASE_URL: 'http://127.0.0.1:54321',
};
const safeSql = '-- exact candidate migration';
const safeEvidence = {
  observedHead: safeEnv.EXPECTED_HEAD,
  remoteDatabaseUsed: false,
  candidateOverlayIncluded: false,
  canonicalApproved: false,
  files: [{ sourcePath: MIGRATION, sha256: crypto.createHash('sha256').update(safeSql).digest('hex') }],
};

describe('#680 booking_addons tenant-scoped performance staff FK expansion', () => {
  it('schema proof only accepts an exact disposable-local candidate', () => {
    expect(() => assertDisposableTarget(safeEnv, safeEvidence, safeSql)).not.toThrow();
    expect(() => assertDisposableTarget(
      { ...safeEnv, TEST_PROFILE: 'SHARED_CANONICAL' }, safeEvidence, safeSql,
    )).toThrow(/UNSAFE_BOOKING_ADDONS_FK_PROOF_IDENTITY/);
    expect(() => assertDisposableTarget(
      { ...safeEnv, TEST_SUPABASE_URL: 'https://example.supabase.co' }, safeEvidence, safeSql,
    )).toThrow(/UNSAFE_BOOKING_ADDONS_FK_PROOF_URL/);
    expect(() => assertDisposableTarget(
      safeEnv, { ...safeEvidence, remoteDatabaseUsed: true }, safeSql,
    )).toThrow(/UNVERIFIED_BOOKING_ADDONS_FK_PROOF_SOURCE/);
  });

  it('declares both historical start shapes plus the fail-closed cross-tenant counterexample', () => {
    const cases = buildCases('-- migration body');
    expect(cases.map((item) => item.name)).toEqual([
      'single-only-start-expands-to-both',
      'composite-only-start-expands-to-both',
      'cross-tenant-existing-data-fails-closed',
    ]);
    expect(cases[2].error).toBe('BOOKING_ADDONS_PERFORMANCE_STAFF_TENANT_MISMATCH');
    for (const item of cases.slice(0, 2)) {
      expect(item.sql).toContain('same-tenant proof');
      expect(item.sql).toContain('cross-tenant proof');
      expect(item.sql).toContain('BOOKING_ADDONS_FK_PROOF_IDENTITY_VALIDATION_OR_DELETE_ACTION');
    }
  });

  it('locks the canonical SQL to an additive BOTH contract, not an environment downgrade', () => {
    const sql = readFileSync(resolve(process.cwd(), MIGRATION), 'utf8');
    expect(sql).toContain('DO $booking_addons_perf_fk_expand$');
    expect(sql).toContain('booking_addons_tenant_id_performance_staff_id_fkey');
    expect(sql).toContain('FOREIGN KEY (tenant_id, performance_staff_id)');
    expect(sql).toContain('ON DELETE NO ACTION');
    expect(sql).toContain('booking_addons_performance_staff_id_fkey');
    expect(sql).toContain('FOREIGN KEY (performance_staff_id)');
    expect(sql).toContain('NOT VALID');
    expect(sql).toContain('VALIDATE CONSTRAINT');
    expect(sql).toContain('BOOKING_ADDONS_PERFORMANCE_STAFF_TENANT_MISMATCH');
    expect(sql).toContain('BOOKING_ADDONS_PERFORMANCE_STAFF_UNKNOWN_FK');
    expect(sql).toContain("fk.confdeltype = 'a' AND fk.confdelsetcols IS NULL");
    expect(sql).toContain("NOTIFY pgrst, 'reload schema';");
    expect(sql).toContain("pg_catalog.to_regclass('public.booking_addons')");
    expect(sql).not.toContain('PERFORM set_config');
    expect(sql).not.toContain('PERFORM pg_notify');
    expect(sql.toLowerCase()).not.toContain('delete from public.booking_addons');
    expect(sql.toLowerCase()).not.toContain('update public.booking_addons');
  });
});
