import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  buildScopedG2Proof,
  deriveProviderLedgerIdentityView,
  validate0133CompositeForeignKeySource,
} from '../../scripts/agents/schema-scoped-g2-proof.mjs';
import { buildObserverSnapshotFromRaw } from '../../scripts/agents/schema-drift-watch.mjs';
import { EXPECTED_PROJECT_REFS } from '../../scripts/agents/schema-truth-evidence.mjs';

const MAIN = 'a'.repeat(40);
const SOURCE_0133 = readFileSync('supabase/migrations/0133_issue_680_booking_addons_composite_fk_expand.sql', 'utf8');
const functionAcl = (name: string, identityArguments: string) => ({
  schema: 'public', name, identityArguments, owner: 'postgres', securityDefiner: true,
  privileges: [{ grantee: 'service_role', privilege: 'EXECUTE', grantable: false }],
});
const raw = () => ({
  metadata: {
    counts: { columns: 12, constraints: 3, indexes: 0, views: 0, policies: 0, routines: 2, triggers: 0 },
    items: [
      ...['booking_addons', 'staff', 'bookings', 'services'].map((name) => ({ surface: 'columns', key: `public.${name}.id`, value: 'uuid|true|' })),
      { surface: 'columns', key: 'public.booking_addons.performance_staff_id', value: 'uuid|false|' },
      ...['performance_mode', 'tenant_id', 'idempotency_key', 'notification_requested', 'deleted_at', 'updated_at'].map((name) => ({ surface: 'columns', key: `public.booking_addons.${name}`, value: 'text|false|' })),
      { surface: 'columns', key: 'public.staff.tenant_id', value: 'uuid|true|' },
      { surface: 'constraints', key: 'public.booking_addons.booking_addons_performance_staff_id_fkey', value: 'f|FOREIGN KEY (performance_staff_id) REFERENCES staff(id) ON DELETE SET NULL' },
      { surface: 'constraints', key: 'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey', value: 'f|FOREIGN KEY (tenant_id, performance_staff_id) REFERENCES staff(tenant_id, id) ON DELETE NO ACTION' },
      { surface: 'constraints', key: 'public.staff.staff_tenant_id_id_key', value: 'u|UNIQUE (tenant_id, id)' },
      { surface: 'routines', key: 'public.create_booking_addon(p_tenant uuid, p_booking uuid, p_idempotency_key text, p_service_id uuid, p_name text, p_price numeric, p_quantity integer, p_duration_minutes integer, p_staff_id uuid, p_performance_mode text, p_performance_staff_id uuid, p_notification_requested boolean)', value: 'f|v|f||create' },
      { surface: 'routines', key: 'public.delete_booking_addon(p_tenant uuid, p_addon uuid)', value: 'f|v|f||delete' },
    ],
  },
  acl: {
    tables: ['booking_addons', 'staff', 'bookings', 'services'].map((name) => ({ schema: 'public', name, rowSecurity: true, forceRowSecurity: false, policyCount: 0, privileges: [] })),
    functions: [
      functionAcl('create_booking_addon', 'p_tenant uuid, p_booking uuid, p_idempotency_key text, p_service_id uuid, p_name text, p_price numeric, p_quantity integer, p_duration_minutes integer, p_staff_id uuid, p_performance_mode text, p_performance_staff_id uuid, p_notification_requested boolean'),
      functionAcl('delete_booking_addon', 'p_tenant uuid, p_addon uuid'),
    ],
  },
  ledger: [{ version: '20260930120000', name: '0133_issue_680_booking_addons_composite_fk_expand' }],
});
function snapshot(environment: 'LOCAL_EXPECTED' | 'TEST' | 'PRODUCTION', value = raw()) {
  return buildObserverSnapshotFromRaw({
    environment, projectRef: environment === 'LOCAL_EXPECTED' ? 'local-fresh' : EXPECTED_PROJECT_REFS[environment],
    observedAt: '2026-09-30T12:00:00Z', observedMainSha: MAIN,
    evidenceRef: environment === 'LOCAL_EXPECTED' ? 'local:fresh-install' : `supabase:${environment.toLowerCase()}/schema-observer`, raw: value,
  });
}
function proof(test = snapshot('TEST'), production = snapshot('PRODUCTION'), expected = snapshot('LOCAL_EXPECTED')) {
  return buildScopedG2Proof({ expectedSnapshot: expected, testSnapshot: test, productionSnapshot: production, currentMainSha: MAIN, now: Date.parse('2026-09-30T12:01:00Z'), migration0133Source: SOURCE_0133 });
}

describe('#698 scoped G2 proof', () => {
  it('verifies a fixed valid closure without write authority', () => {
    const result = proof();
    expect(result).toMatchObject({ status: 'SCOPED_CONSISTENCY_VERIFIED', scopedDifferences: [], safety: { authorizesDatabaseWrite: false } });
    expect(result.fullReportRef).toMatchObject({ type: 'EMBEDDED_FULL_REPORT', status: 'MATCH', observedMainSha: MAIN });
    expect(result.fixedScope.tables).toEqual(['booking_addons', 'staff', 'bookings', 'services']);
    expect(result.captures.TEST.captureDigest.value).toMatch(/^[0-9a-f]{64}$/);
    expect(result.source0133).toMatchObject({ status: 'VALID', singleDeleteAction: 'SET_NULL', compositeDeleteActions: ['NO_ACTION', 'SET_NULL_PERFORMANCE_STAFF_ID'] });
  });

  it('retains a global blocked report even when its difference is outside the fixed closure', () => {
    const changed = raw();
    changed.metadata.counts.columns = 13;
    changed.metadata.items.push({ surface: 'columns', key: 'public.unrelated.id', value: 'text|true|' });
    const result = proof(snapshot('TEST', changed));
    expect(result.status).toBe('GLOBAL_STATUS_NOT_VERIFIED');
    expect(result.fullReport.status).toBe('DRIFT_BLOCKED');
    expect(result.scopedDifferences).toEqual([]);
  });

  it('blocks a missing scoped FK or RPC ACL', () => {
    const missingFk = raw();
    missingFk.metadata.counts.constraints = 2;
    missingFk.metadata.items = missingFk.metadata.items.filter((item) => item.key !== 'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey');
    const missingAcl = raw();
    missingAcl.acl.functions = missingAcl.acl.functions.filter((item) => item.name !== 'delete_booking_addon');
    for (const changed of [missingFk, missingAcl]) {
      const result = proof(snapshot('TEST', changed));
      expect(result.status).toBe('SCOPED_DRIFT_BLOCKED');
      expect(result.scopedDifferences).toEqual(expect.arrayContaining([expect.objectContaining({ requiredCondition: 'G2_FIXED_SCOPE_EXACT_EXPECTED_FINGERPRINT' })]));
    }
  });

  it('blocks an unexpected scoped difference', () => {
    const changed = raw();
    changed.metadata.items[0].value = 'text|true|';
    const result = proof(snapshot('TEST', changed));
    expect(result.status).toBe('SCOPED_DRIFT_BLOCKED');
    expect(result.scopedDifferences[0]).toMatchObject({ objectKey: 'public.booking_addons.id' });
  });

  it('blocks identical incomplete snapshots instead of certifying a partial closure', () => {
    const incomplete = raw();
    incomplete.metadata.counts.constraints = 2;
    incomplete.metadata.items = incomplete.metadata.items.filter((item) => item.key !== 'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey');
    const result = proof(snapshot('TEST', incomplete), snapshot('PRODUCTION', incomplete), snapshot('LOCAL_EXPECTED', incomplete));
    expect(result.fullReport.status).toBe('MATCH');
    expect(result.status).toBe('SCOPED_DRIFT_BLOCKED');
    expect(result.scopedDifferences).toEqual(expect.arrayContaining([expect.objectContaining({ environment: 'expected', objectKey: 'public.booking_addons.booking_addons_tenant_id_performance_staff_id_fkey', requiredCondition: 'G2_REQUIRED_CLOSURE_PRESENT' })]));
  });

  it('blocks identical snapshots missing required routine metadata', () => {
    const incomplete = raw();
    incomplete.metadata.counts.routines = 0;
    incomplete.metadata.items = incomplete.metadata.items.filter((item) => item.surface !== 'routines');
    const result = proof(snapshot('TEST', incomplete), snapshot('PRODUCTION', incomplete), snapshot('LOCAL_EXPECTED', incomplete));
    expect(result.fullReport.status).toBe('MATCH');
    expect(result.status).toBe('SCOPED_DRIFT_BLOCKED');
    expect(result.scopedDifferences).toEqual(expect.arrayContaining([expect.objectContaining({ surface: 'routines', objectKey: 'public.delete_booking_addon(p_tenant uuid, p_addon uuid)', requiredCondition: 'G2_REQUIRED_CLOSURE_PRESENT' })]));
  });

  it('blocks identical snapshots missing a known booking_addons closure column', () => {
    const incomplete = raw();
    incomplete.metadata.counts.columns = 11;
    incomplete.metadata.items = incomplete.metadata.items.filter((item) => item.key !== 'public.booking_addons.performance_mode');
    const result = proof(snapshot('TEST', incomplete), snapshot('PRODUCTION', incomplete), snapshot('LOCAL_EXPECTED', incomplete));
    expect(result.fullReport.status).toBe('MATCH');
    expect(result.status).toBe('SCOPED_DRIFT_BLOCKED');
    expect(result.scopedDifferences).toEqual(expect.arrayContaining([expect.objectContaining({ objectKey: 'public.booking_addons.performance_mode', requiredCondition: 'G2_REQUIRED_CLOSURE_PRESENT' })]));
  });

  it('blocks stale snapshot evidence', () => {
    const result = buildScopedG2Proof({
      expectedSnapshot: snapshot('LOCAL_EXPECTED'), testSnapshot: snapshot('TEST'), productionSnapshot: snapshot('PRODUCTION'), currentMainSha: MAIN,
      now: Date.parse('2026-09-30T14:00:00Z'), migration0133Source: SOURCE_0133,
    });
    expect(result).toMatchObject({ status: 'EVIDENCE_UNAVAILABLE', fullReport: { status: 'EVIDENCE_UNAVAILABLE' } });
  });

  it('derives provider ledger names without changing the normalized source evidence', () => {
    const input = snapshot('TEST');
    const before = JSON.stringify(input.migrationLedger.identities);
    expect(deriveProviderLedgerIdentityView(input, MAIN)).toEqual([{ providerVersion: '20260930120000', providerName: '0133_issue_680_booking_addons_composite_fk_expand', sourceIdentity: '0133_issue_680_booking_addons_composite_fk_expand', mapping: 'DERIVED_FROM_PROVIDER_NAME' }]);
    expect(JSON.stringify(input.migrationLedger.identities)).toBe(before);
  });

  it('rejects a source that broadens the composite FK contract', () => {
    expect(validate0133CompositeForeignKeySource(SOURCE_0133.replace("fk.confdeltype = 'n'", "fk.confdeltype = 'c'"))).toMatchObject({ status: 'BLOCKED' });
  });

  it('rejects commented-out SQL as source evidence', () => {
    expect(validate0133CompositeForeignKeySource(`/* ${SOURCE_0133} */`)).toMatchObject({ status: 'BLOCKED' });
  });
});
