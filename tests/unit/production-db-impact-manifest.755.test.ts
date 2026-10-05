import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { selectedProductionMigrations } from '../../scripts/agents/production-db-release-plan.mjs';

// #755/#46: G2 source check must accept the bounded ISSUE_46_0110_0136_CLOSURE scope
// without weakening MISSING / AMBIGUOUS fail-closed rules (#589 final-owner rule).
const root = process.cwd();
const scope = 'ISSUE_46_0110_0136_CLOSURE';
const targets = ['0110_issue_42_plan_duration_pricetype_yearround', '0111_issue_46_guide_request_accept', '0115_issue_21_external_calendars',
  '0128_issue_42_plan_seasonal_pricing', '0130_issue_46_refund_policy_snapshot', '0132_issue_42_seasonal_price_resolution',
  '0135_issue_46_guide_interval_availability', '0136_issue_755_create_tour_order_invoker'];
const prerequisites = ['0001_extensions_and_functions', '0002_enums', '0003_tenants_and_accounts', '0004_core_business_tables',
  '0005_line_marketing_other', '0066_issue_8_tour_domain_core', '0067_issue_8_tour_integrity', '0068_issue_8_tour_rest_dml_acl',
  '0074_block_times_recurrence_fields', '0087_issue_8b_tour_orders', '0088_issue_8b_tour_order_rpc_acl', '0089_trip_display_fields',
  '0092_trip_departure_staff', '0107_issue_41_formation_state_model'];
const aliasMap = {
  schemaVersion: 1,
  entries: [
    ...prerequisites.map((repoFile) => ({ repoFile, classification: 'EXACT', ledgerNames: [repoFile] })),
    ...targets.map((repoFile) => ({ repoFile, classification: 'NOT_APPLIED', notAppliedReason: 'PENDING_APPLY', ledgerNames: [] })),
    { repoFile: '0099_drop_legacy_create_tour_order_overload', classification: 'ALIAS', ledgerNames: ['drop_legacy_create_tour_order_overload'] },
  ],
};
const CTO = 'public.create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone)';
const FP = 'f'.repeat(64);
const MAIN = 'a'.repeat(40);
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/production-db-impact-manifest.json'), 'utf8'));

const selection = selectedProductionMigrations(aliasMap, scope);
const plan = {
  mainSha: MAIN, planDigest: 'b'.repeat(64),
  migrations: selection.migrations.map((repoFile: string) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })),
};
const pendingKeys: [string, string][] = [
  ['routines', CTO], ['acl', `function:${CTO}`], ['acl', 'table:public.trip_plan_seasons'],
  ['columns', 'public.trip_plan_seasons.price_override'], ['constraints', 'public.trip_plan_seasons.trip_plan_seasons_tenant_plan_fkey'],
  ['indexes', 'public.trip_plan_seasons.trip_plan_seasons_tenant_plan_sort_idx'], ['policies', 'public.trip_plan_seasons.p_trip_plan_seasons_select'],
  ['triggers', 'public.trip_plan_seasons.t_trip_plan_seasons_u'], ['columns', 'public.tour_orders.refund_policy_snapshot'],
  ['constraints', 'public.tour_orders.tour_orders_refund_policy_snapshot_check'],
];
function report() {
  const differences = pendingKeys.map(([surface, objectKey]) => ({
    environment: 'PRODUCTION', surface, objectKey, expectedFingerprint: FP, observedFingerprint: null, classification: 'EXPECTED_PENDING_PRODUCTION',
  }));
  return {
    observedMainSha: MAIN, status: 'EXPECTED_PENDING_PRODUCTION', differenceCount: differences.length, differences,
    environments: { TEST: { observedAt: '2026-10-05T00:00:00Z' }, PRODUCTION: { observedAt: '2026-10-05T00:00:00Z' } },
    environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'EXPECTED_PENDING_PRODUCTION' }, exceptionSummary: { expired: 0, unmatched: 0 },
    safety: { authorizesDatabaseWrite: false },
  };
}
const run = (impactManifest: unknown) => buildProductionConsistencyEvidence({ report: report(), plan, impactManifest, mainSha: MAIN, planDigest: plan.planDigest });
const entry = (m: any, prefix: string) => m.entries.find((e: any) => e.repoFile.startsWith(prefix));

describe('#755/#46 G2 source check accepts ISSUE_46_0110_0136_CLOSURE', () => {
  it('selects the eight reviewed migrations in order', () => {
    expect(selection.migrations).toEqual(targets);
  });

  it('passes with no MISSING/AMBIGUOUS and a matching pending-diff fixture', () => {
    const evidence = run(manifest);
    expect(evidence.status).toBe('CONSISTENCY_VERIFIED');
    expect(evidence.plannedProductionDifferenceCount).toBe(pendingKeys.length);
  });

  it('create_tour_order routine and ACL are owned only by final owner 0136 across the whole closure', () => {
    const owners = (key: string) => manifest.entries
      .filter((e: any) => targets.includes(e.repoFile) && e.impacts.some((i: any) => `${i.surface}:${i.objectKey}` === key))
      .map((e: any) => e.repoFile);
    expect(owners(`routines:${CTO}`)).toEqual([targets[7]]);
    expect(owners(`acl:function:${CTO}`)).toEqual([targets[7]]);
    expect(owners('acl:table:public.trip_plan_seasons')).toEqual([targets[7]]);
  });

  it('0132 is a compatibility-only predecessor with no impacts', () => {
    expect(entry(manifest, '0132').impacts).toEqual([]);
  });

  it('re-adding the routine key to 0111 or the ACL key to 0110 still fails closed as AMBIGUOUS_IMPACT_OWNERSHIP', () => {
    const a: any = structuredClone(manifest);
    entry(a, '0111').impacts.push({ surface: 'routines', objectKey: CTO });
    expect(() => run(a)).toThrow(/AMBIGUOUS_IMPACT_OWNERSHIP/);
    const b: any = structuredClone(manifest);
    entry(b, '0110').impacts.push({ surface: 'acl', objectKey: `function:${CTO}` });
    expect(() => run(b)).toThrow(/AMBIGUOUS_IMPACT_OWNERSHIP/);
  });

  it('removing the 0128, 0130 or 0132 entry still fails closed as MISSING_IMPACT_MANIFEST_ENTRY', () => {
    for (const prefix of ['0128', '0130', '0132']) {
      const m: any = structuredClone(manifest);
      m.entries = m.entries.filter((e: any) => !e.repoFile.startsWith(prefix));
      expect(() => run(m)).toThrow(/MISSING_IMPACT_MANIFEST_ENTRY/);
    }
  });

  it('a pending difference whose owning impact is dropped from 0128 is UNPLANNED (column impact is load-bearing)', () => {
    const m: any = structuredClone(manifest);
    const e = entry(m, '0128');
    e.impacts = e.impacts.filter((i: any) => i.objectKey !== 'public.trip_plan_seasons.price_override');
    expect(() => run(m)).toThrow(/UNPLANNED_PRODUCTION_DIFF/);
  });
});
