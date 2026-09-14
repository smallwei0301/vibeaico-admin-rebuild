import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  buildMigrationManifestFromEntries,
  buildSchemaTruthReport,
  normalizeSnapshot,
  readMigrationManifest,
  renderMarkdown,
} from '../../scripts/agents/schema-truth-report.mjs';

const MAIN = 'a'.repeat(40);
const KINDS = ['columns', 'constraints', 'views', 'indexes', 'policies', 'routines', 'triggers'] as const;
type PublicObjectKind = (typeof KINDS)[number];
type PublicObjectStatus = 'MATCH' | 'ENVIRONMENT_DIFF';

const digest = (seed = '1') => ({ algorithm: 'MD5', value: seed.repeat(32).slice(0, 32) });
const objects = () => Object.fromEntries(
  KINDS.map((kind, index) => [kind, { count: index + 1, digest: digest(String(index + 1)) }]),
);

function publicObjectStatus(
  report: ReturnType<typeof buildSchemaTruthReport>,
  kind: PublicObjectKind,
): PublicObjectStatus {
  return (report.comparison.publicObjects as Record<PublicObjectKind, PublicObjectStatus>)[kind];
}

function snapshot(environment: 'TEST' | 'PRODUCTION', overrides: Record<string, unknown> = {}): any {
  return {
    schemaVersion: 1,
    environment,
    observedAt: '2026-09-04T06:40:00Z',
    projectRef: environment === 'TEST' ? 'nmwhwngojosmagjuvxol' : 'egehnijjpgijmccagxac',
    observedMainSha: MAIN,
    migrationLedger: environment === 'TEST'
      ? {
          state: 'PRESENT', count: 55, latestVersion: '20260904053659', latestName: 'customer_source',
          versionsDigest: digest('a'), evidenceRef: 'supabase:test/schema-fingerprint',
        }
      : {
          state: 'ABSENT', count: null, latestVersion: null, latestName: null,
          versionsDigest: null, evidenceRef: 'supabase:production/schema-fingerprint',
        },
    objects: objects(),
    observations: [],
    ...overrides,
  };
}

const manifest = () => buildMigrationManifestFromEntries([
  { path: '0075.sql', bytes: 'select 2;\n' },
  { path: 'nested\\0074.sql', bytes: 'select 1;\n' },
]);

describe('schema truth report', () => {
  it('keeps ledger absence separate from object fingerprint differences', () => {
    const production = snapshot('PRODUCTION');
    production.objects.columns = { count: 506, digest: digest('f') };
    const test = snapshot('TEST', {
      observations: [{
        type: 'OUT_OF_LEDGER',
        subject: 'public.block_times.title/recurrence/day_of_week/full_day/auto',
        evidenceRef: 'repo:migrations/0074',
      }],
    });
    const report = buildSchemaTruthReport({
      testSnapshot: test,
      productionSnapshot: production,
      migrationManifest: manifest(),
      currentMainSha: MAIN,
    });

    expect(report.comparison.overall).toBe('DRIFT_OBSERVED');
    expect(report.comparison.migrationLedger).toBe('LEDGER_ABSENT');
    expect(publicObjectStatus(report, 'columns')).toBe('ENVIRONMENT_DIFF');
    expect(publicObjectStatus(report, 'views')).toBe('MATCH');
    expect(report.comparison.explicitOutOfLedger).toEqual([
      expect.objectContaining({ environment: 'TEST', type: 'OUT_OF_LEDGER' }),
    ]);
    expect(report.safety.productionMutationAuthorized).toBe(false);
  });

  it('is byte-identical for the same snapshots and migration bytes', () => {
    const first = buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'), productionSnapshot: snapshot('PRODUCTION'),
      migrationManifest: manifest(), currentMainSha: MAIN,
    });
    const second = buildSchemaTruthReport({
      testSnapshot: structuredClone(snapshot('TEST')), productionSnapshot: structuredClone(snapshot('PRODUCTION')),
      migrationManifest: buildMigrationManifestFromEntries([
        { path: 'nested/0074.sql', bytes: 'select 1;\n' },
        { path: '0075.sql', bytes: 'select 2;\n' },
      ]), currentMainSha: MAIN,
    });
    expect(`${JSON.stringify(first, null, 2)}\n`).toBe(`${JSON.stringify(second, null, 2)}\n`);
    expect(renderMarkdown(first)).toBe(renderMarkdown(second));
  });

  it('changes the repo manifest when a filename or file byte changes', () => {
    const base = manifest();
    const renamed = buildMigrationManifestFromEntries([
      { path: '0075-renamed.sql', bytes: 'select 2;\n' },
      { path: 'nested/0074.sql', bytes: 'select 1;\n' },
    ]);
    const edited = buildMigrationManifestFromEntries([
      { path: '0075.sql', bytes: 'select 3;\n' },
      { path: 'nested/0074.sql', bytes: 'select 1;\n' },
    ]);
    expect(renamed.manifestDigest).not.toBe(base.manifestDigest);
    expect(edited.manifestDigest).not.toBe(base.manifestDigest);
  });

  it('rejects a migration-root symlink before reading files outside the repository', () => {
    if (process.platform === 'win32') return;
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'schema-truth-'));
    const repository = path.join(temporary, 'repo');
    const external = path.join(temporary, 'external-migrations');
    try {
      fs.mkdirSync(path.join(repository, 'supabase'), { recursive: true });
      fs.mkdirSync(external, { recursive: true });
      fs.writeFileSync(path.join(external, '0001_outside.sql'), 'select 1;\n', 'utf8');
      fs.symlinkSync(external, path.join(repository, 'supabase', 'migrations'), 'dir');
      expect(() => readMigrationManifest(repository)).toThrow(/MIGRATION_SYMLINK_REJECTED/);
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  });

  it('reports unavailable evidence without pretending the ledger is absent', () => {
    const production = snapshot('PRODUCTION', {
      migrationLedger: {
        state: 'UNAVAILABLE', count: null, latestVersion: null, latestName: null,
        versionsDigest: null, evidenceRef: 'supabase:production/query-unavailable',
      },
    });
    const report = buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'), productionSnapshot: production,
      migrationManifest: manifest(), currentMainSha: MAIN,
    });
    expect(report.comparison.migrationLedger).toBe('LEDGER_UNAVAILABLE');
    expect(report.comparison.overall).toBe('EVIDENCE_INCOMPLETE');
  });

  it('accepts four-digit ledger versions without dropping leading zeros', () => {
    const value = snapshot('TEST', {
      migrationLedger: {
        state: 'PRESENT', count: 1, latestVersion: '0082', latestName: '0082_legacy_baseline',
        versionsDigest: digest('b'), evidenceRef: 'supabase:test/schema-fingerprint',
      },
    });
    expect(normalizeSnapshot(value, 'TEST', MAIN).migrationLedger.latestVersion).toBe('0082');
  });

  it('records an explicit migration dependency plan instead of implying replay safety', () => {
    const report = buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'),
      productionSnapshot: snapshot('PRODUCTION'),
      migrationManifest: buildMigrationManifestFromEntries([
        { path: '0001_initial_schema.sql', bytes: 'select 1;\n' },
        { path: '0002_add_customers.sql', bytes: 'select 2;\n' },
      ]),
      migrationDependencyPlan: {
        schemaVersion: 1,
        migrations: [
          { identity: '0002_add_customers', dependsOn: ['0001_initial_schema'] },
          { identity: '0001_initial_schema', dependsOn: [] },
        ],
      },
      currentMainSha: MAIN,
    });
    expect(report.migrationDependencyPlan).toMatchObject({
      status: 'PASS',
      replayOrder: ['0001_initial_schema', '0002_add_customers'],
    });
    expect(renderMarkdown(report)).toContain('Migration replay dependency plan');
    expect(renderMarkdown(report)).toContain('0001_initial_schema → 0002_add_customers');
  });

  it('records proof controls and rejects a broken positive control', () => {
    const controls = {
      schemaVersion: 1,
      positive: { subject: 'constraint:known_present', found: true, evidenceRef: 'proof:positive' },
      negative: { subject: 'constraint:known_absent', found: false, evidenceRef: 'proof:negative' },
      mutation: { subject: 'constraint:known_present', baselineFound: true, mutatedFound: false, evidenceRef: 'proof:mutation' },
      keySetComparison: { observed: ['tenant_id', 'id'], expected: ['id', 'tenant_id'], equivalent: true },
    };
    const report = buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'),
      productionSnapshot: snapshot('PRODUCTION'),
      migrationManifest: manifest(),
      proofControls: controls,
      currentMainSha: MAIN,
    });
    expect(report.proofControls).toMatchObject({ schemaVersion: 1, status: 'PASS' });
    expect(renderMarkdown(report)).toContain('Schema proof controls');

    expect(() => buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'),
      productionSnapshot: snapshot('PRODUCTION'),
      migrationManifest: manifest(),
      proofControls: { ...controls, positive: { ...controls.positive, found: false } },
      currentMainSha: MAIN,
    })).toThrow(/PROOF_POSITIVE_CONTROL_FAILED/);
  });

  it.each([
    ['negative count', () => {
      const value = snapshot('TEST');
      value.objects.columns.count = -1;
      return value;
    }, /INVALID_COUNT/],
    ['malformed digest', () => {
      const value = snapshot('TEST');
      value.objects.columns.digest.value = 'not-a-digest';
      return value;
    }, /INVALID_DIGEST/],
    ['wrong environment', () => snapshot('PRODUCTION'), /ENVIRONMENT_MISMATCH/],
    ['wrong project ref', () => snapshot('TEST', { projectRef: 'egehnijjpgijmccagxac' }), /PROJECT_REF_MISMATCH/],
    ['stale main', () => snapshot('TEST', { observedMainSha: 'b'.repeat(40) }), /STALE_MAIN_SHA/],
    ['unknown raw data field', () => snapshot('TEST', { rawRows: [] }), /UNKNOWN_OR_MISSING_FIELD/],
  ])('fails closed on %s', (_name, makeValue, error) => {
    expect(() => normalizeSnapshot(makeValue(), 'TEST', MAIN)).toThrow(error as RegExp);
  });

  it('does not infer OUT_OF_LEDGER from different fingerprints alone', () => {
    const production = snapshot('PRODUCTION');
    production.objects.routines = { count: 11, digest: digest('e') };
    const report = buildSchemaTruthReport({
      testSnapshot: snapshot('TEST'), productionSnapshot: production,
      migrationManifest: manifest(), currentMainSha: MAIN,
    });
    expect(publicObjectStatus(report, 'routines')).toBe('ENVIRONMENT_DIFF');
    expect(report.comparison.explicitOutOfLedger).toEqual([]);
  });
});
