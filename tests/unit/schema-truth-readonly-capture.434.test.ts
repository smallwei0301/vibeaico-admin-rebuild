import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  READ_ONLY_QUERY_CONTRACTS,
  READ_ONLY_QUERY_PATH,
  buildMetadataEvidencePacket,
  captureEnvironmentEvidence,
  captureEnvironmentPair,
  executeReadOnlyContract,
  normalizeMigrationLedgerRows,
  normalizePublicMetadataSnapshot,
  resolveCaptureEnvironment,
} from '../../scripts/agents/schema-truth-readonly-capture.mjs';

const MAIN = 'a'.repeat(40);
const TOKEN = 'test-readonly-token-never-output';

function metadataRows(value = 'uuid|true|') {
  return [{
    snapshot: {
      counts: { columns: 1 },
      items: [{ surface: 'columns', key: 'public.example.id', value }],
    },
  }];
}

function aclRows() {
  return [{ snapshot: { tables: [], functions: [] } }];
}

function ledgerRows() {
  return [{ version: '0082', name: '0082_example' }];
}

function fakeFetchFactory({ productionMetadata = metadataRows() } = {}) {
  const requests: Array<{ url: string; init: RequestInit; contract: string }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (!init?.body) throw new Error('missing request body');
    const body = JSON.parse(String(init.body));
    const contract = Object.entries(READ_ONLY_QUERY_CONTRACTS)
      .find(([, query]) => query === body.query)?.[0];
    if (!contract) throw new Error('unexpected query');
    requests.push({ url, init, contract });
    const isProduction = url.includes('egehnijjpgijmccagxac');
    const rows = contract === 'metadata'
      ? (isProduction ? productionMetadata : metadataRows())
      : contract === 'acl'
        ? aclRows()
        : ledgerRows();
    return {
      ok: true,
      status: 201,
      text: async () => JSON.stringify(rows),
    } as Response;
  }) as typeof fetch;
  return { requests, fetchImpl };
}

describe('Issue #434 read-only schema evidence capture', () => {
  it('pins capture targets to canonical TEST and Production only', () => {
    expect(resolveCaptureEnvironment('test')).toBe('TEST');
    expect(resolveCaptureEnvironment('PRODUCTION')).toBe('PRODUCTION');
    expect(() => resolveCaptureEnvironment('other-project-ref')).toThrow(/INVALID_CAPTURE_ENVIRONMENT/);
  });

  it('uses only the Supabase read-only database query endpoint', async () => {
    const { requests, fetchImpl } = fakeFetchFactory();
    await captureEnvironmentEvidence({
      environment: 'TEST', currentMainSha: MAIN, token: TOKEN, fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(requests).toHaveLength(3);
    expect(requests.every((request) => request.url.endsWith(READ_ONLY_QUERY_PATH))).toBe(true);
    expect(requests.every((request) => !/\/database\/query$/.test(request.url))).toBe(true);
    expect(requests.every((request) => request.url.includes('nmwhwngojosmagjuvxol'))).toBe(true);
  });

  it('sends exactly the three checked-in SQL contracts and no caller-provided SQL', async () => {
    const { requests, fetchImpl } = fakeFetchFactory();
    await captureEnvironmentEvidence({
      environment: 'TEST', currentMainSha: MAIN, token: TOKEN, fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(requests.map((request) => request.contract)).toEqual(['metadata', 'acl', 'ledger']);
    expect(requests.map((request) => JSON.parse(String(request.init.body)).query)).toEqual([
      READ_ONLY_QUERY_CONTRACTS.metadata,
      READ_ONLY_QUERY_CONTRACTS.acl,
      READ_ONLY_QUERY_CONTRACTS.ledger,
    ]);
  });

  it('never places the token in the request body or evidence output', async () => {
    const { requests, fetchImpl } = fakeFetchFactory();
    const packet = await captureEnvironmentEvidence({
      environment: 'TEST', currentMainSha: MAIN, token: TOKEN, fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(requests.every((request) => !String(request.init.body).includes(TOKEN))).toBe(true);
    expect(requests.every((request) => (request.init.headers as Record<string, string>).Authorization === `Bearer ${TOKEN}`)).toBe(true);
    expect(JSON.stringify(packet)).not.toContain(TOKEN);
    expect(packet.rawDataIncluded).toBe(false);
  });

  it('emits a self-validating packet bound to the current main and query digest', async () => {
    const { fetchImpl } = fakeFetchFactory();
    const packet = await captureEnvironmentEvidence({
      environment: 'TEST', currentMainSha: MAIN, token: TOKEN, fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(packet).toMatchObject({
      environment: 'TEST',
      projectRef: 'nmwhwngojosmagjuvxol',
      observedMainSha: MAIN,
      rawDataIncluded: false,
      migrationLedger: { state: 'PRESENT' },
      surfaces: { columns: { count: 1 } },
      acl: { tables: [], functions: [] },
    });
    expect(packet.captureDigest.value).toMatch(/^[0-9a-f]{64}$/);
    expect(packet.queryDigest.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it('compares canonical TEST and Production with the existing evidence comparator', async () => {
    const match = fakeFetchFactory();
    const same = await captureEnvironmentPair({
      currentMainSha: MAIN, token: TOKEN, fetchImpl: match.fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(same.comparison.overall).toBe('MATCH');

    const drift = fakeFetchFactory({ productionMetadata: metadataRows('text|true|') });
    const different = await captureEnvironmentPair({
      currentMainSha: MAIN, token: TOKEN, fetchImpl: drift.fetchImpl, observedAt: '2026-09-14T04:30:00Z',
    });
    expect(different.comparison.overall).toBe('DRIFT_OBSERVED');
    expect(different.comparison.publicObjects.columns).toBe('ENVIRONMENT_DIFF');
  });

  it('rejects unknown metadata surfaces and count mismatches', () => {
    expect(() => normalizePublicMetadataSnapshot({
      counts: { columns: 1, mystery: 0 },
      items: [{ surface: 'columns', key: 'public.example.id', value: 'uuid|true|' }],
    })).toThrow(/UNKNOWN_METADATA_SURFACE/);
    expect(() => normalizePublicMetadataSnapshot({
      counts: { columns: 2 },
      items: [{ surface: 'columns', key: 'public.example.id', value: 'uuid|true|' }],
    })).toThrow(/METADATA_COUNT_MISMATCH/);
  });

  it('rejects duplicate metadata identities instead of hiding them in a digest', () => {
    expect(() => normalizePublicMetadataSnapshot({
      counts: { columns: 2 },
      items: [
        { surface: 'columns', key: 'public.example.id', value: 'uuid|true|' },
        { surface: 'columns', key: 'public.example.id', value: 'text|true|' },
      ],
    })).toThrow(/DUPLICATE_METADATA_ITEM/);
  });

  it('fails closed on network, HTTP, and unparseable responses', async () => {
    await expect(executeReadOnlyContract({
      environment: 'TEST', contract: 'metadata', token: TOKEN,
      fetchImpl: async () => { throw new Error('network'); },
    })).rejects.toThrow(/READONLY_QUERY_NETWORK_FAILURE/);

    await expect(executeReadOnlyContract({
      environment: 'TEST', contract: 'metadata', token: TOKEN,
      fetchImpl: async () => ({ ok: false, status: 403, text: async () => 'forbidden' }) as any,
    })).rejects.toThrow(/READONLY_QUERY_HTTP_FAILURE/);

    await expect(executeReadOnlyContract({
      environment: 'TEST', contract: 'metadata', token: TOKEN,
      fetchImpl: async () => ({ ok: true, status: 201, text: async () => 'not-json' }) as any,
    })).rejects.toThrow(/UNPARSEABLE_READONLY_RESPONSE/);
  });

  it('fails closed when the API returns an unexpected response shape', async () => {
    await expect(executeReadOnlyContract({
      environment: 'TEST', contract: 'metadata', token: TOKEN,
      fetchImpl: async () => ({ ok: true, status: 201, text: async () => JSON.stringify({ rows: [] }) }) as any,
    })).rejects.toThrow(/INVALID_READONLY_RESPONSE/);
  });

  it('rejects arbitrary contract names before issuing a request', async () => {
    let called = false;
    await expect(executeReadOnlyContract({
      environment: 'TEST', contract: 'select * from customers' as any, token: TOKEN,
      fetchImpl: async () => { called = true; throw new Error('should not run'); },
    })).rejects.toThrow(/UNKNOWN_READONLY_CONTRACT/);
    expect(called).toBe(false);
  });

  it('rejects numeric migration versions instead of guessing lost leading zeros', () => {
    expect(() => normalizeMigrationLedgerRows([{ version: 82, name: '0082_example' } as any]))
      .toThrow(/must preserve exact string identities/);
  });

  it('contains no write-query endpoint and no scheduled-workflow side effect in the source change', () => {
    const source = readFileSync(resolve(process.cwd(), 'scripts/agents/schema-truth-readonly-capture.mjs'), 'utf8');
    expect(source).toContain('/database/query/read-only');
    expect(source).not.toMatch(/\/database\/query[\"'`]/);
    expect(source).not.toContain('workflow_dispatch');
    expect(source).not.toContain('schedule:');
  });
});
