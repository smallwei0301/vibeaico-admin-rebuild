import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/0039_issue_41_group_formation_lifecycle.sql', 'utf8');
describe('#41 schema/RPC source contract', () => {
  it('uses 0039 after #37 and #40, and keeps single-order bounds distinct from group formation', () => {
    expect(migration).toContain('0039');
    expect(migration).toContain('0034–0037 #37');
    expect(migration).toContain('0038 #40');
    expect(migration).toContain('min_party_size');
    expect(migration).toContain('max_party_size');
    expect(migration).toContain('min_to_depart');
  });
  it('defines a locked tenant-scoped RPC and unique durable GROUP_FORMED event path for concurrent callbacks', () => {
    expect(migration).toContain('refresh_departure_formation_41(p_tenant uuid, p_departure uuid)');
    expect(migration).toContain('tenant_id=p_tenant for update');
    expect(migration).toContain("where id=d.id and formation_status='COLLECTING'");
    expect(migration).toContain("'tour-group-formed:'||d.id::text");
    expect(migration).toContain('notification_outbox/enqueue_notification_event');
  });
  it('snapshots deadline, routes deadline shortage to review, and makes tenant mismatch fail closed', () => {
    expect(migration).toContain('formation_deadline_at');
    expect(migration).toContain("formation_status='REVIEW_REQUIRED'");
    expect(migration).toContain("formation_status='AT_RISK'");
    expect(migration).toContain('TOUR_ORDER_TENANT_PARENT_MISMATCH');
  });

  it('keeps every SECURITY DEFINER formation helper private, then grants only server and cron RPCs to service_role', () => {
    for (const signature of [
      'snapshot_trip_departure_formation_41()',
      'guard_tour_order_formation_41()',
      'qualifying_tour_participants_41(uuid)',
      'refresh_departure_formation_41(uuid,uuid)',
      'refresh_tour_order_formation_41()',
      'review_expired_tour_formations_41(timestamptz)',
    ]) {
      expect(migration).toContain(`revoke execute on function public.${signature} from public, anon, authenticated;`);
    }
    for (const signature of [
      'qualifying_tour_participants_41(uuid)',
      'refresh_departure_formation_41(uuid,uuid)',
      'review_expired_tour_formations_41(timestamptz)',
    ]) expect(migration).toContain(`grant execute on function public.${signature} to service_role;`);
    expect(migration).not.toContain('grant execute on function public.guard_tour_order_formation_41() to service_role;');
    expect(migration).toContain('grant all on table tour_formation_decisions to service_role;');
  });
});
