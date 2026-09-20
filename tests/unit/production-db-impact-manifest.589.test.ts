import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

import { buildProductionConsistencyEvidence } from '../../scripts/agents/production-db-consistency-evidence.mjs';
import { normalizeProductionDbImpactManifest } from '../../scripts/agents/production-db-impact-manifest.mjs';
import { buildObserverSnapshotFromRaw } from '../../scripts/agents/schema-drift-watch.mjs';

const root = process.cwd();
const planFiles = [
  '0110_issue_42_plan_duration_pricetype_yearround',
  '0111_issue_46_guide_request_accept',
  '0113_issue_23_promotion_page_view_events',
  '0115_issue_21_external_calendars',
  '0124_issue_18_owner_notify_legacy_shape',
  '0116_issue_18_owner_notify',
  '0117_issue_25b_support_chat_threads',
  '0118_issue_25c_platform_donations',
  '0119_issue_18_owner_notify_confirm_atomic',
  '0125_issue_17_booking_addons_legacy_enum',
  '0121_issue_17_booking_addons_hardening',
  '0123_issue_589_richmenu_asset_retirement',
  '0126_issue_402_keyword_reply_images_authz',
];
const plan = {
  mainSha: 'a'.repeat(40), planDigest: 'b'.repeat(64),
  migrations: planFiles.map((repoFile) => ({ repoFile, path: `supabase/migrations/${repoFile}.sql` })),
};
const manifest = JSON.parse(readFileSync(resolve(root, 'supabase/production-db-impact-manifest.json'), 'utf8'));

const roots: Record<string, string[]> = {
  '0110_issue_42_plan_duration_pricetype_yearround': ['public.trip_plans.duration_minutes', 'public.trip_plans.trip_plans_price_type_check'],
  '0111_issue_46_guide_request_accept': ['public.tour_orders.seats_reserved', 'public.accept_tour_request(p_tenant uuid, p_order uuid, p_hold_hours numeric)'],
  '0113_issue_23_promotion_page_view_events': ['public.page_view_events.visitor_hash', 'public.page_view_events.p_page_view_events_select'],
  '0115_issue_21_external_calendars': ['public.external_calendar_events.external_calendar_id', 'public.sync_replace_external_calendar_events(p_external_calendar_id uuid, p_tenant_id uuid, p_events jsonb)'],
  '0124_issue_18_owner_notify_legacy_shape': [],
  '0116_issue_18_owner_notify': ['public.owner_notify_recipients.notify_new_booking', 'public.owner_notify_recipients.u_owner_notify_recipients_primary'],
  '0117_issue_25b_support_chat_threads': ['public.support_chat_messages.sender_role', 'public.support_chat_threads.p_sct_u'],
  '0118_issue_25c_platform_donations': ['public.platform_donations.merchant_trade_no', 'public.platform_donations.trg_platform_donations_updated_at'],
  '0119_issue_18_owner_notify_confirm_atomic': ['public.confirm_owner_notify_bind(p_tenant_id uuid, p_request_id uuid, p_line_user_id text)'],
  '0125_issue_17_booking_addons_legacy_enum': [],
  '0121_issue_17_booking_addons_hardening': ['public.booking_addons.performance_mode', 'public.create_booking_addon(p_tenant uuid, p_booking uuid, p_idempotency_key text, p_service_id uuid, p_name text, p_price numeric, p_quantity integer, p_duration_minutes integer, p_staff_id uuid, p_performance_mode text, p_performance_staff_id uuid, p_notification_requested boolean)'],
  '0123_issue_589_richmenu_asset_retirement': ['public.richmenu_asset_retirements.image_url', 'public.tenant_settings.trg_prevent_retired_richmenu_asset'],
  '0126_issue_402_keyword_reply_images_authz': ['storage.objects.p_storage_write'],
};

const functionAclIdentities = [
  'public.create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone)',
  'public.accept_tour_request(p_tenant uuid, p_order uuid, p_hold_hours numeric)',
  'public.reject_tour_request(p_tenant uuid, p_order uuid, p_reason text)',
  'public.sync_replace_external_calendar_events(p_external_calendar_id uuid, p_tenant_id uuid, p_events jsonb)',
  'public.mark_external_calendar_sync_error(p_external_calendar_id uuid, p_tenant_id uuid, p_error text)',
  'public.owner_notify_max_recipients()',
  'public.confirm_owner_notify_bind(p_tenant_id uuid, p_request_id uuid, p_line_user_id text)',
  'public.create_booking_addon(p_tenant uuid, p_booking uuid, p_idempotency_key text, p_service_id uuid, p_name text, p_price numeric, p_quantity integer, p_duration_minutes integer, p_staff_id uuid, p_performance_mode text, p_performance_staff_id uuid, p_notification_requested boolean)',
  'public.delete_booking_addon(p_tenant uuid, p_addon uuid)',
  'public.richmenu_asset_references(p_line jsonb)',
  'public.prevent_retired_richmenu_asset()',
  'public.retire_richmenu_asset(p_tenant_id uuid, p_image_url text)',
].sort();

function report() {
  return {
    observedMainSha: plan.mainSha, status: 'MATCH', differenceCount: 0, differences: [],
    environments: { TEST: { observedAt: '2026-09-20T00:00:00Z' }, PRODUCTION: { observedAt: '2026-09-20T00:00:00Z' } },
    environmentStatuses: { TEST: 'MATCH', PRODUCTION: 'MATCH' }, exceptionSummary: { expired: 0, unmatched: 0 },
    safety: { authorizesDatabaseWrite: false },
  };
}

describe('#589 Stage 1 production impact manifest', () => {
  it('covers all 13 planned canonical migrations with declared final-impact roots', () => {
    const normalized = normalizeProductionDbImpactManifest(manifest);
    const byFile = new Map(normalized.entries.map((entry) => [entry.repoFile, entry]));
    expect(planFiles).toHaveLength(13);
    expect([...byFile.keys()]).toEqual(expect.arrayContaining(planFiles));
    expect(byFile.get('0105_issue_44_traveler_risk_policies')!.impacts.length).toBeGreaterThan(0);
    expect(byFile.get('0109_issue_41_schema_precondition_assertions')!.impacts.length).toBeGreaterThan(0);

    for (const migration of plan.migrations) {
      const entry = byFile.get(migration.repoFile)!;
      const objectKeys = new Set(entry.impacts.map((impact) => impact.objectKey));
      expect([...objectKeys]).toEqual(expect.arrayContaining(roots[migration.repoFile]));
      const sql = readFileSync(resolve(root, migration.path), 'utf8');
      for (const objectKey of roots[migration.repoFile]) {
        const name = objectKey.split('.').at(-1)!.split('(')[0];
        expect(sql).toContain(name);
      }
    }
  });

  it('uses the observer-emitted named function ACL identities and pins the planned root inventory', () => {
    const normalized = normalizeProductionDbImpactManifest(manifest);
    const inventory = normalized.entries.filter((entry) => planFiles.includes(entry.repoFile));
    const inventoryDigest = createHash('sha256').update(JSON.stringify(inventory)).digest('hex');
    expect(inventoryDigest).toBe('ceb7d9e9cac104d8ca093d1d293aca40dbf6c4711776f44768b9bf3922be7d80');

    const functionAclKeys = inventory.flatMap((entry) => entry.impacts)
      .filter((impact) => impact.surface === 'acl' && impact.objectKey.startsWith('function:'))
      .map((impact) => impact.objectKey).sort();
    expect(functionAclKeys).toEqual(functionAclIdentities.map((identity) => `function:${identity}`));

    const functions = functionAclIdentities.map((identity) => {
      const match = /^public\.([^()]+)\((.*)\)$/.exec(identity)!;
      return { schema: 'public', name: match[1], identityArguments: match[2], owner: 'postgres', securityDefiner: true, privileges: [] };
    });
    const snapshot = buildObserverSnapshotFromRaw({
      environment: 'LOCAL_EXPECTED', projectRef: 'local-fresh', observedAt: '2026-09-20T00:00:00Z',
      observedMainSha: plan.mainSha, evidenceRef: 'local:manifest-acl-fixture',
      raw: { metadata: { counts: {}, items: [] }, acl: { tables: [], functions }, ledger: [{ version: '0126', name: 'fixture' }] },
    });
    expect(snapshot.acl.items.map((item: any) => item.key)).toEqual(functionAclIdentities.map((identity) => `function:${identity}`));
  });

  it('keeps compatibility-only predecessors empty and fails closed if final owners overlap', () => {
    const normalized = normalizeProductionDbImpactManifest(manifest);
    const byFile = new Map(normalized.entries.map((entry) => [entry.repoFile, entry]));
    expect(byFile.get('0124_issue_18_owner_notify_legacy_shape')!.impacts).toEqual([]);
    expect(byFile.get('0125_issue_17_booking_addons_legacy_enum')!.impacts).toEqual([]);
    expect(byFile.get('0110_issue_42_plan_duration_pricetype_yearround')!.impacts.map((impact) => impact.objectKey))
      .not.toContain('public.create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone)');

    const duplicate = structuredClone(manifest);
    duplicate.entries.find((entry: any) => entry.repoFile === '0110_issue_42_plan_duration_pricetype_yearround').impacts.push({
      surface: 'routines', objectKey: 'public.create_tour_order(p_tenant uuid, p_order_no text, p_departure uuid, p_party_size integer, p_customer uuid, p_contact jsonb, p_source tour_order_source, p_payment_method uuid, p_note text, p_hold_expires timestamp with time zone)',
    });
    expect(() => buildProductionConsistencyEvidence({ report: report(), plan, impactManifest: duplicate, mainSha: plan.mainSha, planDigest: plan.planDigest }))
      .toThrow(/AMBIGUOUS_IMPACT_OWNERSHIP/);
  });
});
