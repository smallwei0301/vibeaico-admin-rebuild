import { describe, expect, it, vi } from 'vitest';

import {
  READ_ONLY_SNAPSHOT_SQL,
  captureEnvironmentSnapshot,
  parseProjectBoundSchemaObserverUrl,
} from '../../scripts/agents/schema-drift-watch.mjs';

const MAIN = 'a'.repeat(40);
const TEST_URL = 'postgresql://schema_observer.nmwhwngojosmagjuvxol:password@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const TEST_URL_WITH_UNENCODED_AT = 'postgresql://schema_observer.nmwhwngojosmagjuvxol:@localTestPassword123@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const PROD_URL = 'postgresql://schema_observer.egehnijjpgijmccagxac:password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=verify-full';
const raw = {
  metadata: { counts: { columns: 1, constraints: 0, indexes: 0, views: 0, policies: 0, routines: 0, triggers: 0 }, items: [{ surface: 'columns', key: 'public.tours.id', value: 'uuid|false|' }] },
  acl: { tables: [], functions: [] },
  ledger: [{ version: '0105', name: '0105_previous_migration' }],
};

describe('schema observer direct PostgreSQL transport #589', () => {
  it('binds each observer URL to its exact environment and non-admin role', () => {
    expect(parseProjectBoundSchemaObserverUrl(TEST_URL, 'TEST')).toMatchObject({
      environment: 'TEST', projectRef: 'nmwhwngojosmagjuvxol', role: 'schema_observer', transportMode: 'SUPAVISOR_SESSION',
    });
    expect(parseProjectBoundSchemaObserverUrl(PROD_URL, 'PRODUCTION')).toMatchObject({
      environment: 'PRODUCTION', projectRef: 'egehnijjpgijmccagxac', role: 'schema_observer', transportMode: 'SUPAVISOR_SESSION',
    });
    expect(() => parseProjectBoundSchemaObserverUrl(PROD_URL, 'TEST')).toThrow(/SCHEMA_OBSERVER_URL_PROJECT_MISMATCH/);
    expect(() => parseProjectBoundSchemaObserverUrl(TEST_URL.replace('schema_observer.', 'postgres.'), 'TEST')).toThrow(/SCHEMA_OBSERVER_ROLE_MISMATCH/);
  });

  it('canonicalizes an unencoded at-sign in the password before opening the pooler connection', () => {
    expect(parseProjectBoundSchemaObserverUrl(TEST_URL_WITH_UNENCODED_AT, 'TEST').connectionString)
      .toBe(TEST_URL_WITH_UNENCODED_AT.replace(':@localTestPassword123@', ':%40localTestPassword123@'));
  });

  it('captures the same sanitized packet through one read-only direct query without calling the Management API', async () => {
    const directQuery = vi.fn(async ({ connectionString, query, readOnly }) => {
      expect(connectionString).toBe(TEST_URL);
      expect(query).toBe(READ_ONLY_SNAPSHOT_SQL);
      expect(readOnly).toBe(true);
      return raw;
    });
    const fetchImpl = vi.fn();

    const captured = await captureEnvironmentSnapshot({
      environment: 'TEST',
      currentMainSha: MAIN,
      connectionString: TEST_URL,
      directQuery,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    expect(captured).toMatchObject({ status: 'CAPTURED', environment: 'TEST', rawDataIncluded: false });
    expect(directQuery).toHaveBeenCalledTimes(1);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('passes the canonicalized direct URL to the read-only query transport', async () => {
    const directQuery = vi.fn(async ({ connectionString }) => {
      expect(connectionString).toBe(TEST_URL_WITH_UNENCODED_AT.replace(':@localTestPassword123@', ':%40localTestPassword123@'));
      return raw;
    });

    const captured = await captureEnvironmentSnapshot({
      environment: 'TEST',
      currentMainSha: MAIN,
      token: JSON.stringify({ TEST: TEST_URL_WITH_UNENCODED_AT, PRODUCTION: PROD_URL }),
      directQuery,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });

    expect(captured.status).toBe('CAPTURED');
  });

  it('accepts an environment-bound URL map through the existing secret interface', async () => {
    const directQuery = vi.fn(async ({ connectionString }) => {
      expect(connectionString).toBe(PROD_URL);
      return raw;
    });
    const captured = await captureEnvironmentSnapshot({
      environment: 'PRODUCTION',
      currentMainSha: MAIN,
      token: JSON.stringify({ TEST: TEST_URL, PRODUCTION: PROD_URL }),
      directQuery,
      fetchImpl: vi.fn() as unknown as typeof fetch,
    });
    expect(captured.status).toBe('CAPTURED');
  });

  it('fails closed on a malformed direct credential map instead of falling back to a Management API call', async () => {
    const fetchImpl = vi.fn();
    const captured = await captureEnvironmentSnapshot({
      environment: 'TEST',
      currentMainSha: MAIN,
      token: JSON.stringify({ TEST: TEST_URL }),
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(captured).toMatchObject({ status: 'EVIDENCE_UNAVAILABLE', reason: 'MALFORMED_SCHEMA_OBSERVER_CREDENTIAL' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
