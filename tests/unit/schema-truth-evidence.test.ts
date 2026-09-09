import { describe, expect, it } from 'vitest';

import {
  ACL_METADATA_SQL,
  MIGRATION_LEDGER_SQL,
  METADATA_QUERY_DIGEST,
  METADATA_QUERY_VERSION,
  PUBLIC_SCHEMA_METADATA_SQL,
  compareMetadataEvidence,
  normalizeMetadataEvidencePacket,
  sha256,
  stableStringify,
} from '../../scripts/agents/schema-truth-evidence.mjs';

const MAIN = 'a'.repeat(40);

const surfaces = () => Object.fromEntries([
  'columns', 'constraints', 'indexes', 'views', 'policies', 'routines', 'triggers',
].map((surface) => [surface, { count: 0, digest: { algorithm: 'SHA256', value: '0'.repeat(64) } }]));

const acl = () => ({
  tables: [{
    schema: 'public', name: 'catalog_position_counters', rowSecurity: true,
    forceRowSecurity: false, policyCount: 0,
    privileges: [
      { grantee: 'authenticated', privilege: 'SELECT', grantable: false },
      { grantee: 'service_role', privilege: 'SELECT', grantable: false },
    ],
  }],
  functions: [{
    schema: 'public', name: 'reserve_catalog_positions', identityArguments: 'p_tenant_id uuid, p_resource text',
    owner: 'postgres', securityDefiner: true,
    privileges: [{ grantee: 'authenticated', privilege: 'EXECUTE', grantable: false }],
  }],
});

const ledger = () => ({
  state: 'PRESENT',
  identities: [
    { version: '20260907065034', name: '0084_catalog_position_bridge' },
    { version: '20260907231738', name: '0086_keyword_reply_images_bucket' },
  ],
});

function packet(environment: 'TEST' | 'PRODUCTION', overrides: Record<string, unknown> = {}) {
  const base = {
    schemaVersion: 1,
    queryVersion: METADATA_QUERY_VERSION,
    queryDigest: METADATA_QUERY_DIGEST,
    environment,
    projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: '2026-09-08T00:00:00Z',
    observedMainSha: MAIN,
    evidenceRef: `supabase:${environment.toLowerCase()}/metadata`,
    migrationLedger: ledger(),
    surfaces: surfaces(),
    acl: acl(),
    rawDataIncluded: false,
  };
  const withoutDigest = { ...base, ...overrides };
  return {
    ...withoutDigest,
    captureDigest: {
      algorithm: 'SHA256',
      value: sha256(stableStringify({
        ...withoutDigest,
        migrationLedger: {
          ...withoutDigest.migrationLedger,
          digest: {
            algorithm: 'SHA256',
            value: sha256(stableStringify(withoutDigest.migrationLedger.identities)),
          },
        },
      })),
    },
  };
}

function finalize(value: Record<string, any>) {
  const { captureDigest: _captureDigest, ...withoutCaptureDigest } = value;
  const normalizedLedger = {
    ...withoutCaptureDigest.migrationLedger,
    digest: { algorithm: 'SHA256', value: sha256(stableStringify(withoutCaptureDigest.migrationLedger.identities)) },
  };
  const normalized = { ...withoutCaptureDigest, migrationLedger: normalizedLedger };
  return {
    ...normalized,
    captureDigest: { algorithm: 'SHA256', value: sha256(stableStringify(normalized)) },
  };
}

describe('schema truth evidence contract', () => {
  it('pins the exact metadata query contract and excludes application-row SQL', () => {
    expect(METADATA_QUERY_VERSION).toBe('public-schema-metadata-v1');
    expect(METADATA_QUERY_DIGEST).toEqual({ algorithm: 'SHA256', value: expect.stringMatching(/^[0-9a-f]{64}$/) });
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('FROM pg_attribute');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('p.polcmd::text');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('pg_get_viewdef(c.oid, true)');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('c.reloptions');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('t.tgenabled::text');
    expect(ACL_METADATA_SQL).toContain('aclexplode');
    expect(ACL_METADATA_SQL).toContain('is_grantable');
    expect(ACL_METADATA_SQL).toContain("'privilege', acl.privilege_type");
    expect(ACL_METADATA_SQL).toContain("acl.privilege_type = 'EXECUTE'");
    expect(ACL_METADATA_SQL).toContain("c.relkind IN ('r', 'p', 'v', 'm', 'f')");
    expect(ACL_METADATA_SQL).toContain("'[]'::json");
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('ORDER BY role_name COLLATE "C"');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain('p.polpermissive');
    expect(PUBLIC_SCHEMA_METADATA_SQL).toContain("THEN 'public'");
    expect(ACL_METADATA_SQL).not.toContain("'tableSecurity'");
    expect(MIGRATION_LEDGER_SQL).toContain('supabase_migrations.schema_migrations');
    expect(PUBLIC_SCHEMA_METADATA_SQL).not.toMatch(/FROM\s+(?:public\.)?(?:customers|bookings|tenants)\s/i);
  });

  it('requires complete migration identities and a matching digest', () => {
    const value = finalize(packet('TEST'));
    expect(normalizeMetadataEvidencePacket(value, MAIN).migrationLedger.identities).toHaveLength(2);
    const good = finalize(packet('TEST'));
    const bad = {
      ...good,
      migrationLedger: {
        ...good.migrationLedger,
        identities: [{ version: '20260907065034', name: 'wrong' }],
      },
    };
    expect(() => normalizeMetadataEvidencePacket(bad, MAIN)).toThrow(/LEDGER_DIGEST_MISMATCH/);
  });

  it('preserves ACL privilege and grantable differences as drift', () => {
    const test = finalize(packet('TEST'));
    const production = finalize(packet('PRODUCTION', {
      acl: {
        ...acl(),
        tables: [{ ...acl().tables[0], privileges: [
          { grantee: 'anon', privilege: 'TRUNCATE', grantable: false },
          { grantee: 'authenticated', privilege: 'SELECT', grantable: false },
          { grantee: 'service_role', privilege: 'SELECT', grantable: false },
        ] }],
      },
    }));
    expect(compareMetadataEvidence({ testPacket: test, productionPacket: production, currentMainSha: MAIN })).toMatchObject({
      overall: 'DRIFT_OBSERVED', acl: 'ENVIRONMENT_DIFF', migrationLedger: 'MATCH',
    });
  });

  it('preserves case-sensitive ACL role identity as drift', () => {
    const test = finalize(packet('TEST', {
      acl: {
        ...acl(),
        tables: [{ ...acl().tables[0], privileges: [
          { grantee: 'Authenticated', privilege: 'SELECT', grantable: false },
        ] }],
      },
    }));
    const production = finalize(packet('PRODUCTION'));
    expect(compareMetadataEvidence({ testPacket: test, productionPacket: production, currentMainSha: MAIN })).toMatchObject({
      overall: 'DRIFT_OBSERVED', acl: 'ENVIRONMENT_DIFF',
    });
  });

  it('fails closed on ACL role whitespace instead of collapsing identity', () => {
    const test = finalize(packet('TEST', {
      acl: {
        ...acl(),
        tables: [{ ...acl().tables[0], privileges: [
          { grantee: ' authenticated', privilege: 'SELECT', grantable: false },
        ] }],
      },
    }));
    const production = finalize(packet('PRODUCTION'));
    expect(() => compareMetadataEvidence({ testPacket: test, productionPacket: production, currentMainSha: MAIN }))
      .toThrow(/INVALID_ACL_ROLE/);
  });

  it('accepts PostgreSQL 17 table privileges and explicit public grants', () => {
    const value = finalize(packet('TEST', {
      acl: {
        ...acl(),
        tables: [{ ...acl().tables[0], privileges: [
          { grantee: 'authenticated', privilege: 'MAINTAIN', grantable: false },
          { grantee: 'public', privilege: 'SELECT', grantable: false },
        ] }],
      },
    }));
    expect(normalizeMetadataEvidencePacket(value, MAIN).acl.tables[0].privileges).toEqual([
      { grantee: 'authenticated', privilege: 'MAINTAIN', grantable: false },
      { grantee: 'public', privilege: 'SELECT', grantable: false },
    ]);
  });

  it('fails closed when the two packet slots are swapped or duplicated', () => {
    const test = finalize(packet('TEST'));
    expect(() => compareMetadataEvidence({ testPacket: test, productionPacket: test, currentMainSha: MAIN }))
      .toThrow(/ENVIRONMENT_PAIR_MISMATCH/);
  });

  it('fails closed on stale main, raw data, and unknown fields', () => {
    const value = finalize(packet('TEST'));
    expect(() => normalizeMetadataEvidencePacket(value, 'b'.repeat(40))).toThrow(/STALE_MAIN_SHA/);
    expect(() => normalizeMetadataEvidencePacket(finalize({ ...value, rawDataIncluded: true }), MAIN)).toThrow(/RAW_DATA_FORBIDDEN/);
    expect(() => normalizeMetadataEvidencePacket(finalize({ ...value, rawRows: [] }), MAIN)).toThrow(/UNKNOWN_OR_MISSING_FIELD/);
  });

  it('requires capture digest to be reproducible from normalized evidence', () => {
    const value = finalize(packet('TEST'));
    expect(normalizeMetadataEvidencePacket(value, MAIN).captureDigest.value).toBe(value.captureDigest.value);
    const tampered = { ...value, captureDigest: { algorithm: 'SHA256', value: 'f'.repeat(64) } };
    expect(() => normalizeMetadataEvidencePacket(tampered, MAIN)).toThrow(/CAPTURE_DIGEST_MISMATCH/);
  });
});
