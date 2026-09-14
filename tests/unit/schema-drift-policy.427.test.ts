import { describe, expect, it } from 'vitest';

import { evaluateSchemaDriftPolicy } from '../../scripts/agents/schema-truth-guardrails.mjs';

const MAIN = 'a'.repeat(40);
const NOW = '2026-09-14T04:00:00Z';

function emptySurfaces(): Record<string, any[]> {
  return { columns: [], constraints: [], indexes: [], views: [], policies: [], routines: [], triggers: [] };
}

function repoFixture(overrides: Record<string, unknown> = {}) {
  return {
    observedMainSha: MAIN,
    repoBuiltProfile: 'CANONICAL_ONLY',
    canonicalManifest: { identity: 'repo:canonical/current-main' },
    overlayManifests: [],
    surfaces: emptySurfaces(),
    ...overrides,
  };
}

function environment(environmentName: 'TEST' | 'PRODUCTION', overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    environment: environmentName,
    projectRef: environmentName === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: '2026-09-14T03:50:00Z',
    observedMainSha: MAIN,
    evidenceRef: `supabase:${environmentName.toLowerCase()}/catalog`,
    surfaces: emptySurfaces(),
    ...overrides,
  };
}

function evaluate(overrides: Record<string, unknown> = {}) {
  return evaluateSchemaDriftPolicy({
    repoFixture: repoFixture(),
    testSnapshot: environment('TEST'),
    productionSnapshot: environment('PRODUCTION'),
    currentMainSha: MAIN,
    now: NOW,
    maxEvidenceAgeMinutes: 60,
    ...overrides,
  });
}

describe('Issue #427 schema drift policy', () => {
  it('returns MATCH only for fresh matching evidence', () => {
    expect(evaluate()).toMatchObject({ overall: 'MATCH', blocked: false, databaseMutationAuthorized: false });
  });

  it('distinguishes main-ahead-of-TEST rollout from drift', () => {
    const surfaces = emptySurfaces();
    surfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    const result = evaluate({ repoFixture: repoFixture({ surfaces }) });
    expect(result.overall).toBe('EXPECTED_PENDING_TEST');
    expect(result.blocked).toBe(false);
    expect(result.expectedPendingTest).toHaveLength(1);
  });

  it('distinguishes main-and-TEST-ahead-of-Production rollout from drift', () => {
    const surfaces = emptySurfaces();
    surfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    const result = evaluate({
      repoFixture: repoFixture({ surfaces }),
      testSnapshot: environment('TEST', { surfaces }),
    });
    expect(result.overall).toBe('EXPECTED_PENDING_PRODUCTION');
    expect(result.blocked).toBe(false);
    expect(result.expectedPendingProduction).toHaveLength(1);
  });

  it('blocks an object that exists only in shared TEST', () => {
    const surfaces = emptySurfaces();
    surfaces.constraints = [{ schema: 'public', key: 'bookings.test_only_check', definition: 'check (true)' }];
    const result = evaluate({ testSnapshot: environment('TEST', { surfaces }) });
    expect(result.overall).toBe('DRIFT_BLOCKED');
    expect(result.blocked).toBe(true);
    expect(result.unknownDrift[0]).toMatchObject({ presence: 'TEST_ONLY' });
  });

  it('blocks same-key definition mismatch', () => {
    const repoSurfaces = emptySurfaces();
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    repoSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    testSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid null' }];
    productionSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    const result = evaluate({
      repoFixture: repoFixture({ surfaces: repoSurfaces }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
    });
    expect(result.overall).toBe('DRIFT_BLOCKED');
    expect(result.unknownDrift[0]).toMatchObject({ definitionStatus: 'SAME_KEY_DEFINITION_MISMATCH' });
  });

  it('allows only an exact, unexpired, current-main-bound exception', () => {
    const surfaces = emptySurfaces();
    surfaces.indexes = [{ schema: 'public', key: 'bookings.temporary_idx', definition: 'btree (created_at)' }];
    const blocked = evaluate({ testSnapshot: environment('TEST', { surfaces }) });
    const drift = blocked.unknownDrift[0];
    const result = evaluate({
      testSnapshot: environment('TEST', { surfaces }),
      exceptions: [{
        surface: drift.surface,
        key: drift.key,
        entryDigest: drift.entryDigest,
        issue: '#427',
        owner: 'smallwei0301',
        reason: 'bounded reconciliation fixture',
        expiresAt: '2026-09-15T04:00:00Z',
        currentMainSha: MAIN,
      }],
    });
    expect(result.overall).toBe('INTENTIONAL_DIFFERENCE');
    expect(result.blocked).toBe(false);
    expect(result.intentionalDifferences).toHaveLength(1);
  });

  it('does not let an expired exception hide drift', () => {
    const surfaces = emptySurfaces();
    surfaces.indexes = [{ schema: 'public', key: 'bookings.temporary_idx', definition: 'btree (created_at)' }];
    const blocked = evaluate({ testSnapshot: environment('TEST', { surfaces }) });
    const drift = blocked.unknownDrift[0];
    const result = evaluate({
      testSnapshot: environment('TEST', { surfaces }),
      exceptions: [{
        surface: drift.surface,
        key: drift.key,
        entryDigest: drift.entryDigest,
        issue: '#427',
        owner: 'smallwei0301',
        reason: 'expired fixture',
        expiresAt: '2026-09-14T03:59:59Z',
        currentMainSha: MAIN,
      }],
    });
    expect(result.overall).toBe('DRIFT_BLOCKED');
    expect(result.expiredExceptions).toHaveLength(1);
  });

  it('reports stale evidence instead of a false MATCH', () => {
    const result = evaluate({
      productionSnapshot: environment('PRODUCTION', { observedAt: '2026-09-14T01:00:00Z' }),
    });
    expect(result.overall).toBe('EVIDENCE_STALE');
    expect(result.blocked).toBe(true);
  });

  it('reports incomplete evidence when repository truth was not built', () => {
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    testSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    productionSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    const result = evaluate({
      repoFixture: repoFixture({ repoBuiltProfile: 'NOT_RUN' }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
    });
    expect(result.overall).toBe('EVIDENCE_INCOMPLETE');
    expect(result.blocked).toBe(true);
  });
});
