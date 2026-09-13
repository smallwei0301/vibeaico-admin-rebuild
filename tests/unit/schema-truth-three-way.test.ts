import { describe, expect, it } from 'vitest';

import {
  compareThreeWaySchemaTruth,
  normalizeEnvironmentSnapshot,
  normalizeRepoBuiltFixture,
} from '../../scripts/agents/schema-truth-three-way.mjs';

const MAIN = 'a'.repeat(40);

const emptySurfaces = (): Record<string, any[]> => ({
  columns: [], constraints: [], indexes: [], views: [], policies: [], routines: [], triggers: [],
});

const routine = (overrides: Record<string, unknown> = {}) => ({
  schema: 'public', key: 'public.bookings_total(uuid)', resultType: 'numeric',
  kind: 'function', securityDefiner: false, volatility: 'stable', ...overrides,
});

function repository(overrides: Record<string, unknown> = {}) {
  return {
    observedMainSha: MAIN,
    repoBuiltProfile: 'CANONICAL_ONLY',
    canonicalManifest: { identity: 'repo:canonical/0001-0084' },
    overlayManifests: [],
    surfaces: emptySurfaces(),
    ...overrides,
  };
}

function environment(environment: 'TEST' | 'PRODUCTION', overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    environment,
    projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedAt: '2026-09-07T12:00:00Z',
    observedMainSha: MAIN,
    evidenceRef: `supabase:${environment.toLowerCase()}/catalog`,
    surfaces: emptySurfaces(),
    ...overrides,
  };
}

describe('schema truth three-way fixture contract', () => {
  it('emits all seven non-empty presence combinations across the fixed schema surfaces', () => {
    const repoSurfaces = emptySurfaces();
    repoSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    repoSurfaces.views = [{ schema: 'public', key: 'public.bookings_view', definition: 'security_invoker' }];
    repoSurfaces.policies = [{ schema: 'public', key: 'bookings.tenant_scope', definition: 'using tenant_id' }];
    repoSurfaces.triggers = [{ schema: 'public', key: 'bookings.audit_write', definition: 'after insert' }];
    const testSurfaces = emptySurfaces();
    testSurfaces.constraints = [{ schema: 'public', key: 'bookings.bookings_status_check', definition: 'status check' }];
    testSurfaces.views = [{ schema: 'public', key: 'public.bookings_view', definition: 'security_invoker' }];
    testSurfaces.routines = [routine()];
    testSurfaces.triggers = [{ schema: 'public', key: 'bookings.audit_write', definition: 'after insert' }];
    const productionSurfaces = emptySurfaces();
    productionSurfaces.indexes = [{ schema: 'public', key: 'bookings.bookings_tenant_idx', definition: 'btree tenant_id' }];
    productionSurfaces.policies = [{ schema: 'public', key: 'bookings.tenant_scope', definition: 'using tenant_id' }];
    productionSurfaces.routines = [routine()];
    productionSurfaces.triggers = [{ schema: 'public', key: 'bookings.audit_write', definition: 'after insert' }];

    const result: any = compareThreeWaySchemaTruth({
      repoFixture: repository({ surfaces: repoSurfaces }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
      currentMainSha: MAIN,
    });

    expect(Object.keys(result.surfaces)).toEqual([
      'columns', 'constraints', 'indexes', 'views', 'policies', 'routines', 'triggers',
    ]);
    expect(result.surfaces.columns.entries).toEqual([
      expect.objectContaining({ key: 'customers.id', presence: 'REPO_ONLY', definitionStatus: 'DEFINITION_NOT_COMPARABLE' }),
    ]);
    expect(result.surfaces.constraints.entries).toEqual([
      expect.objectContaining({ key: 'bookings.bookings_status_check', presence: 'TEST_ONLY', definitionStatus: 'DEFINITION_NOT_COMPARABLE' }),
    ]);
    expect(result.surfaces.indexes.entries).toEqual([
      expect.objectContaining({ key: 'bookings.bookings_tenant_idx', presence: 'PRODUCTION_ONLY', definitionStatus: 'DEFINITION_NOT_COMPARABLE' }),
    ]);
    expect(result.surfaces.views.entries).toEqual([
      expect.objectContaining({ key: 'public.bookings_view', presence: 'REPO_TEST' }),
    ]);
    expect(result.surfaces.policies.entries).toEqual([
      expect.objectContaining({ key: 'bookings.tenant_scope', presence: 'REPO_PRODUCTION' }),
    ]);
    expect(result.surfaces.routines.entries).toEqual([
      expect.objectContaining({ key: 'public.bookings_total(uuid)', presence: 'TEST_PRODUCTION' }),
    ]);
    expect(result.surfaces.triggers.entries).toEqual([
      expect.objectContaining({ key: 'bookings.audit_write', presence: 'ALL_THREE' }),
    ]);
    expect(result.limitations.routines).toBe('BODY_NOT_COMPARED');
    expect(result.limitations.columns).toBe('ORDINAL_NOT_COMPARED');
  });

  it('reports a same-key definition mismatch without reducing it to a one-sided difference', () => {
    const repoSurfaces = emptySurfaces();
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    repoSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    testSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid null' }];
    productionSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];

    const result: any = compareThreeWaySchemaTruth({
      repoFixture: repository({ surfaces: repoSurfaces }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
      currentMainSha: MAIN,
    });

    expect(result.surfaces.columns.entries).toEqual([
      expect.objectContaining({
        key: 'customers.id',
        presence: 'ALL_THREE',
        definitionStatus: 'SAME_KEY_DEFINITION_MISMATCH',
      }),
    ]);
  });

  it('ignores column ordinal position while retaining the canonical column definition', () => {
    const repoSurfaces = emptySurfaces();
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    repoSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null', ordinalPosition: 1 }];
    testSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null', ordinalPosition: 8 }];
    productionSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null', ordinalPosition: 4 }];

    const result: any = compareThreeWaySchemaTruth({
      repoFixture: repository({ surfaces: repoSurfaces }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
      currentMainSha: MAIN,
    });
    expect(result.surfaces.columns.entries).toEqual([
      expect.objectContaining({ presence: 'ALL_THREE', definitionStatus: 'DEFINITION_MATCH' }),
    ]);
  });

  it('validates overlay metadata independently from the canonical manifest and profile', () => {
    expect(normalizeRepoBuiltFixture(repository({
      repoBuiltProfile: 'OVERLAY_AUGMENTED',
      overlayManifests: [{ identity: 'repo:overlay/legacy-0019' }],
    }), MAIN)).toMatchObject({ repoBuiltProfile: 'OVERLAY_AUGMENTED' });
    expect(() => normalizeRepoBuiltFixture(repository({
      repoBuiltProfile: 'CANONICAL_ONLY',
      overlayManifests: [{ identity: 'repo:overlay/legacy-0019' }],
    }), MAIN)).toThrow(/INVALID_REPO_BUILT_PROFILE/);
    expect(normalizeRepoBuiltFixture(repository({
      repoBuiltProfile: 'NOT_RUN',
      canonicalManifest: { identity: 'repo:canonical/0001-0084' },
    }), MAIN)).toMatchObject({
      repoBuiltProfile: 'NOT_RUN',
      canonicalManifest: { identity: 'repo:canonical/0001-0084' },
    });
  });

  it('marks repository presence unverified when the REPO_BUILT profile was not run', () => {
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    testSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'uuid not null' }];
    productionSurfaces.columns = [{ schema: 'public', key: 'customers.id', definition: 'text not null' }];

    const result: any = compareThreeWaySchemaTruth({
      repoFixture: repository({ repoBuiltProfile: 'NOT_RUN' }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
      currentMainSha: MAIN,
    });

    expect(result.surfaces.columns.entries).toEqual([
      expect.objectContaining({
        key: 'customers.id',
        repoPresent: null,
        testPresent: true,
        productionPresent: true,
        presence: 'REPO_UNVERIFIED',
        definitionStatus: 'SAME_KEY_DEFINITION_MISMATCH',
      }),
    ]);
  });

  it('accepts long multiline schema definitions while rejecting NUL data', () => {
    const longDefinition = `${'x'.repeat(1300)}\nwith (security_invoker = true)`;
    const normalized: any = normalizeRepoBuiltFixture(repository({
      surfaces: {
        ...emptySurfaces(),
        views: [{ schema: 'public', key: 'public.bookings_view', definition: longDefinition }],
      },
    }), MAIN);
    expect(normalized.surfaces.views).toEqual([{ key: 'public.bookings_view', definition: longDefinition }]);
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: {
        ...emptySurfaces(),
        views: [{ schema: 'public', key: 'public.bookings_view', definition: 'select\0secret' }],
      },
    }), MAIN)).toThrow(/INVALID_SURFACE_DEFINITION/);
  });

  it('uses an UTF-8 byte limit instead of a JavaScript character limit', () => {
    const atLimit = 'é'.repeat(8192);
    const normalized: any = normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), views: [{ schema: 'public', key: 'public.bookings_view', definition: atLimit }] },
    }), MAIN);
    expect(normalized.surfaces.views[0].definition).toBe(atLimit);
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), views: [{ schema: 'public', key: 'public.bookings_view', definition: 'é'.repeat(8193) }] },
    }), MAIN)).toThrow(/INVALID_SURFACE_DEFINITION/);
  });

  it('accepts sanitized routine identity arguments with type modifiers', () => {
    const normalized: any = normalizeRepoBuiltFixture(repository({
      surfaces: {
        ...emptySurfaces(),
        routines: [routine({ key: 'public.total_for_period(numeric(10,2), timestamp with time zone)', resultType: 'numeric(10,2)' })],
      },
    }), MAIN);
    expect(normalized.surfaces.routines[0].key).toBe('public.total_for_period(numeric(10,2), timestamp with time zone)');
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: {
        ...emptySurfaces(),
        routines: [{ schema: 'public', key: 'public.total_for_period(uuid)', definition: 'begin return select total from bookings; end' }],
      },
    }), MAIN)).toThrow(/UNKNOWN_OR_MISSING_FIELD/);
    for (const resultType of ['', 'select total from bookings', 'drop table bookings', '(((']) {
      expect(() => normalizeRepoBuiltFixture(repository({
        surfaces: { ...emptySurfaces(), routines: [routine({ resultType })] },
      }), MAIN)).toThrow(/INVALID_RESULT_TYPE/);
    }
  });

  it('compares routine semantic metadata without accepting a body', () => {
    const testSurfaces = emptySurfaces();
    const productionSurfaces = emptySurfaces();
    testSurfaces.routines = [routine()];
    productionSurfaces.routines = [routine({ securityDefiner: true })];
    const result: any = compareThreeWaySchemaTruth({
      repoFixture: repository({ repoBuiltProfile: 'NOT_RUN' }),
      testSnapshot: environment('TEST', { surfaces: testSurfaces }),
      productionSnapshot: environment('PRODUCTION', { surfaces: productionSurfaces }),
      currentMainSha: MAIN,
    });
    expect(result.surfaces.routines.entries[0]).toMatchObject({
      definitionStatus: 'SAME_KEY_DEFINITION_MISMATCH', presence: 'REPO_UNVERIFIED',
    });
  });

  it('accepts observed SETOF and TABLE result metadata without accepting SQL', () => {
    for (const resultType of [
      'SETOF notification_deliveries',
      'SETOF public.notification_deliveries',
      'TABLE(addon_id uuid, final_price numeric, duration_minutes integer, end_at timestamp with time zone, created boolean, notified text)',
    ]) {
      expect(normalizeRepoBuiltFixture(repository({
        surfaces: { ...emptySurfaces(), routines: [routine({ resultType })] },
      }), MAIN)).toBeTruthy();
    }
    for (const resultType of ['setof select users', 'table(x select from)', 'from bookings', 'begin return']) {
      expect(() => normalizeRepoBuiltFixture(repository({
        surfaces: { ...emptySurfaces(), routines: [routine({ resultType })] },
      }), MAIN)).toThrow(/INVALID_RESULT_TYPE/);
    }
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), routines: [routine({ resultType: 'TABLE(ok integer, bad numeric(10,2)' })] },
    }), MAIN)).toThrow(/INVALID_RESULT_TYPE/);
  });

  it('parses canonical identity arguments and observed PostgreSQL scalar result types', () => {
    expect(normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), routines: [routine({ key: 'public.f(customer_id uuid, price numeric(10,2), when_at timestamp with time zone)', resultType: 'setof gbtreekey32' })] },
    }), MAIN)).toBeTruthy();
    for (const resultType of ['cstring', 'event_trigger', 'gbtreekey_var', 'gbtreekey16', 'gbtreekey2', 'gbtreekey32', 'gbtreekey4', 'gbtreekey8', 'internal', 'money', 'oid']) {
      expect(normalizeRepoBuiltFixture(repository({ surfaces: { ...emptySurfaces(), routines: [routine({ resultType })] }, }), MAIN)).toBeTruthy();
    }
    for (const key of ['public.f(select pg_sleep(10))', 'public.f(drop table users)', 'public.f((()', 'public.f("uuid)']) {
      expect(() => normalizeRepoBuiltFixture(repository({ surfaces: { ...emptySurfaces(), routines: [routine({ key })] }, }), MAIN)).toThrow(/INVALID_SURFACE_KEY/);
    }
    for (const key of ['public.f(pg_sleep(10))', 'public.f(with users)', 'public.f(execute now)', 'public.f(select)', 'public.f(foo select)', 'public.f(call dangerous)', 'public.f(truncate users)', 'public.f(copy users)', ' public.f(uuid)', 'public.f( uuid )']) {
      expect(() => normalizeRepoBuiltFixture(repository({ surfaces: { ...emptySurfaces(), routines: [routine({ key })] }, }), MAIN)).toThrow(/INVALID_SURFACE_KEY/);
    }
    const canonicalized: any = normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), routines: [routine({ key: 'public.f(uuid,text)' })] },
    }), MAIN);
    expect(canonicalized.surfaces.routines).toEqual([{ key: 'public.f(uuid, text)', definition: expect.any(String) }]);
  });

  it('uses UTC calendar validation for observedAt', () => {
    expect(normalizeEnvironmentSnapshot(environment('TEST', { observedAt: '2024-02-29T23:59:59Z' }), 'TEST', MAIN))
      .toMatchObject({ observedAt: '2024-02-29T23:59:59Z' });
    for (const observedAt of ['2026-02-30T12:00:00Z', '2025-02-29T12:00:00Z', '2026-01-01T24:00:00Z']) {
      expect(() => normalizeEnvironmentSnapshot(environment('TEST', { observedAt }), 'TEST', MAIN))
        .toThrow(/INVALID_OBSERVED_AT/);
    }
  });

  it('pins schema version and environment project identity before accepting fixture metadata', () => {
    expect(normalizeEnvironmentSnapshot(environment('TEST'), 'TEST', MAIN)).toMatchObject({
      schemaVersion: 1,
      projectRef: 'nmwhwngojosmagjuvxol',
    });
    expect(() => normalizeEnvironmentSnapshot(environment('TEST', { projectRef: 'egehnijjpgijmccagxac' }), 'TEST', MAIN))
      .toThrow(/PROJECT_REF_MISMATCH/);
    expect(() => normalizeEnvironmentSnapshot(environment('PRODUCTION', { projectRef: 'nmwhwngojosmagjuvxol' }), 'PRODUCTION', MAIN))
      .toThrow(/PROJECT_REF_MISMATCH/);
    expect(() => normalizeEnvironmentSnapshot(environment('TEST', { schemaVersion: 2 }), 'TEST', MAIN))
      .toThrow(/INVALID_SNAPSHOT/);
    const missingProject = environment('TEST');
    delete (missingProject as { projectRef?: string }).projectRef;
    expect(() => normalizeEnvironmentSnapshot(missingProject, 'TEST', MAIN)).toThrow(/UNKNOWN_OR_MISSING_FIELD/);
  });

  it('fails closed on unknown raw fields, duplicate keys, and stale evidence', () => {
    expect(() => normalizeRepoBuiltFixture(repository({ rawRows: [] }), MAIN)).toThrow(/UNKNOWN_OR_MISSING_FIELD/);
    expect(() => normalizeRepoBuiltFixture(repository({ observedMainSha: 'b'.repeat(40) }), MAIN)).toThrow(/STALE_MAIN_SHA/);
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), columns: [
        { schema: 'public', key: 'customers.id', definition: 'uuid' },
        { schema: 'public', key: 'customers.id', definition: 'uuid' },
      ] },
    }), MAIN)).toThrow(/DUPLICATE_SURFACE_KEY/);
    expect(() => normalizeRepoBuiltFixture(repository({
      surfaces: { ...emptySurfaces(), columns: [{ schema: 'audit', key: 'customers.id', definition: 'uuid' }] },
    }), MAIN)).toThrow(/INVALID_PUBLIC_SCHEMA/);
  });
});
