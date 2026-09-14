import { describe, expect, it } from 'vitest';

import {
  buildMigrationDependencyPlan,
  ensureMigrationDependencyPlanCoverage,
  isMigrationLedgerVersion,
  normalizeSchemaProofControls,
  sameKeySet,
} from '../../scripts/agents/schema-truth-proof-policy.mjs';

describe('schema truth proof policy', () => {
  it('accepts only the two supported migration ledger version shapes', () => {
    expect(isMigrationLedgerVersion('0082')).toBe(true);
    expect(isMigrationLedgerVersion('20260907065034')).toBe(true);
    expect(isMigrationLedgerVersion('12345')).toBe(false);
    expect(isMigrationLedgerVersion('1234567')).toBe(false);
    expect(isMigrationLedgerVersion('202609070650345678901')).toBe(false);
  });

  it('compares catalog key fields as a set while keeping duplicate fields invalid', () => {
    expect(sameKeySet(['tenant_id', 'id'], ['id', 'tenant_id'])).toBe(true);
    expect(sameKeySet(['tenant_id', 'id'], ['tenant_id', 'slug'])).toBe(false);
    expect(() => sameKeySet(['tenant_id', 'id', 'id'], ['id', 'tenant_id'])).toThrow(/DUPLICATE_KEY_FIELD/);
  });

  it('builds a deterministic replay order from explicit migration dependencies', () => {
    expect(buildMigrationDependencyPlan({
      schemaVersion: 1,
      migrations: [
        { identity: '0003_add_bookings', dependsOn: ['0002_add_customers'] },
        { identity: '0001_initial_schema', dependsOn: [] },
        { identity: '0002_add_customers', dependsOn: ['0001_initial_schema'] },
      ],
    })).toEqual({
      schemaVersion: 1,
      status: 'PASS',
      migrations: [
        { identity: '0001_initial_schema', dependsOn: [] },
        { identity: '0002_add_customers', dependsOn: ['0001_initial_schema'] },
        { identity: '0003_add_bookings', dependsOn: ['0002_add_customers'] },
      ],
      replayOrder: ['0001_initial_schema', '0002_add_customers', '0003_add_bookings'],
    });
  });

  it('does not accept a dependency plan that omits a checked-in migration', () => {
    const plan = buildMigrationDependencyPlan({
      schemaVersion: 1,
      migrations: [{ identity: '0001_initial_schema', dependsOn: [] }],
    });
    expect(() => ensureMigrationDependencyPlanCoverage(plan, {
      files: [
        { path: 'supabase/migrations/0001_initial_schema.sql' },
        { path: 'supabase/migrations/0002_add_customers.sql' },
      ],
    })).toThrow(/MIGRATION_DEPENDENCY_PLAN_COVERAGE_MISMATCH/);
  });

  it.each([
    ['unknown dependency', [
      { identity: '0001_initial_schema', dependsOn: ['0009_missing'] },
    ], /UNKNOWN_MIGRATION_DEPENDENCY/],
    ['forward dependency', [
      { identity: '0001_initial_schema', dependsOn: ['0002_later'] },
      { identity: '0002_later', dependsOn: [] },
    ], /INVALID_MIGRATION_DEPENDENCY/],
    ['duplicate migration prefix', [
      { identity: '0001_initial_schema', dependsOn: [] },
      { identity: '0001_rewritten_schema', dependsOn: [] },
    ], /DUPLICATE_MIGRATION_PREFIX/],
  ])('fails closed on %s', (_name, migrations, error) => {
    expect(() => buildMigrationDependencyPlan({ schemaVersion: 1, migrations })).toThrow(error);
  });

  it('requires positive, negative, and mutation evidence to agree with the expected result', () => {
    expect(normalizeSchemaProofControls({
      schemaVersion: 1,
      positive: {
        subject: 'constraint:customers_tenant_id_id_key',
        found: true,
        evidenceRef: 'supabase:local/proof/positive',
      },
      negative: {
        subject: 'constraint:legacy_single_column_key',
        found: false,
        evidenceRef: 'supabase:local/proof/negative',
      },
      mutation: {
        subject: 'constraint:customers_tenant_id_id_key',
        baselineFound: true,
        mutatedFound: false,
        evidenceRef: 'supabase:local/proof/mutation',
      },
      keySetComparison: {
        observed: ['tenant_id', 'id'],
        expected: ['id', 'tenant_id'],
        equivalent: true,
      },
    })).toMatchObject({ schemaVersion: 1, status: 'PASS' });
  });

  it.each([
    ['positive control', { found: false }, /PROOF_POSITIVE_CONTROL_FAILED/],
    ['negative control', { found: true }, /PROOF_NEGATIVE_CONTROL_FAILED/],
  ])('rejects a failed %s', (_name, override, error) => {
    const value = {
      schemaVersion: 1,
      positive: { subject: 'object:present', found: true, evidenceRef: 'proof:positive' },
      negative: { subject: 'object:absent', found: false, evidenceRef: 'proof:negative' },
      mutation: { subject: 'object:mutated', baselineFound: true, mutatedFound: false, evidenceRef: 'proof:mutation' },
      keySetComparison: { observed: ['tenant_id', 'id'], expected: ['id', 'tenant_id'], equivalent: true },
      ...(_name === 'positive control' ? { positive: { subject: 'object:present', ...override, evidenceRef: 'proof:positive' } } : {}),
      ...(_name === 'negative control' ? { negative: { subject: 'object:absent', ...override, evidenceRef: 'proof:negative' } } : {}),
    };
    expect(() => normalizeSchemaProofControls(value)).toThrow(error);
  });

  it('rejects a mutation that did not change the observed result', () => {
    expect(() => normalizeSchemaProofControls({
      schemaVersion: 1,
      positive: { subject: 'object:present', found: true, evidenceRef: 'proof:positive' },
      negative: { subject: 'object:absent', found: false, evidenceRef: 'proof:negative' },
      mutation: { subject: 'object:mutated', baselineFound: true, mutatedFound: true, evidenceRef: 'proof:mutation' },
      keySetComparison: { observed: ['tenant_id', 'id'], expected: ['id', 'tenant_id'], equivalent: true },
    })).toThrow(/PROOF_MUTATION_CONTROL_FAILED/);
  });
});
