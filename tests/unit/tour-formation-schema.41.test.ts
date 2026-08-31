import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migrationDirectory = 'supabase/migrations';
const issue41Migration = '0040_issue_41_group_formation_lifecycle.sql';
const issue41HardeningMigration = '0041_issue_41_group_formation_lifecycle_hardening.sql';
const issue41EpochRepairMigration = '0046_issue_41_formation_transition_revision.sql';
const tripPlanFoundationMigration = '0016_tour_domain_core.sql';
const departureOrderFoundationMigration = '0026_tour_departures_addons_orders.sql';
const notificationOutboxMigration = '0038_notification_outbox_delivery.sql';
const issue41BalancePolicyMigration = '0047_issue_41_balance_policy_snapshots.sql';
const issue41RuntimeContractMigration = '0048_issue_41_atomic_runtime_contracts.sql';
const issue41CancellationMigration = '0049_issue_41_atomic_order_cancellation.sql';
const issue41ReceiptGuardMigration = '0050_issue_41_receipt_replay_amount_guard.sql';
const issue41RefundBasisMigration = '0051_issue_41_midao_refund_basis.sql';
const issue41NoneQualificationMigration = '0052_issue_41_none_payment_qualification.sql';
const migration = readFileSync(`${migrationDirectory}/${issue41Migration}`, 'utf8');
const normalizedMigration = migration.replace(/\s+/g, ' ');
const hardeningMigration = readFileSync(`${migrationDirectory}/${issue41HardeningMigration}`, 'utf8');
const normalizedHardeningMigration = hardeningMigration.replace(/\s+/g, ' ');
const epochRepairMigration = readFileSync(`${migrationDirectory}/${issue41EpochRepairMigration}`, 'utf8');
const normalizedEpochRepairMigration = epochRepairMigration.replace(/\s+/g, ' ');

describe('#41 schema migration ordering', () => {
  it('keeps every migration identifier unique and reserves 0040 for #41', () => {
    const migrationFiles = readdirSync(migrationDirectory)
      .filter((file) => file.endsWith('.sql'));
    const migrationIds = migrationFiles.map((file) => {
      const match = /^(\d+[a-z]*)_/.exec(file);
      expect(match, `${file} must start with a numeric migration identifier`).not.toBeNull();
      return match![1];
    });
    const issue41Files = migrationFiles
      .filter((file) => file.endsWith('_issue_41_group_formation_lifecycle.sql'));

    // A letter suffix is a forward repair to an already-applied numeric
    // migration (for example, #40's 0038a).  The whole identifier—not the
    // numeric portion alone—must be unique, while #41 owns plain 0040/0041.
    expect(new Set(migrationIds).size).toBe(migrationIds.length);
    expect(migrationFiles.filter((file) => file.startsWith('0040_'))).toEqual([issue41Migration]);
    expect(issue41Files).toEqual([issue41Migration]);
    expect(migrationFiles).toContain(issue41HardeningMigration);
    expect(migrationFiles).toContain(issue41EpochRepairMigration);
    expect(migrationFiles).toContain(tripPlanFoundationMigration);
    expect(migrationFiles).toContain(departureOrderFoundationMigration);
    expect(migrationFiles).toContain(notificationOutboxMigration);
    expect(migrationFiles).toContain(issue41BalancePolicyMigration);
    expect(migrationFiles).toContain(issue41RuntimeContractMigration);
    expect(migrationFiles).toContain(issue41CancellationMigration);
    expect(migrationFiles).toContain(issue41ReceiptGuardMigration);
    expect(migrationFiles).toContain(issue41RefundBasisMigration);
    expect(migrationFiles).toContain(issue41NoneQualificationMigration);
    expect(migrationFiles.indexOf(tripPlanFoundationMigration)).toBeLessThan(migrationFiles.indexOf(departureOrderFoundationMigration));
    expect(migrationFiles.indexOf(departureOrderFoundationMigration)).toBeLessThan(migrationFiles.indexOf(notificationOutboxMigration));
    expect(migrationFiles.indexOf(notificationOutboxMigration)).toBeLessThan(migrationFiles.indexOf(issue41Migration));
  });

  it('has a clean source graph for the #41 tables and notification event contract', () => {
    const planFoundation = readFileSync(`${migrationDirectory}/${tripPlanFoundationMigration}`, 'utf8');
    const departureFoundation = readFileSync(`${migrationDirectory}/${departureOrderFoundationMigration}`, 'utf8');
    const outboxFoundation = readFileSync(`${migrationDirectory}/${notificationOutboxMigration}`, 'utf8');

    expect(planFoundation).toContain('create table trips');
    expect(planFoundation).toContain('create table trip_plans');
    expect(departureFoundation).toContain('create table trip_departures');
    expect(departureFoundation).toContain('create table tour_orders');
    expect(outboxFoundation).toContain('create table notification_outbox');
    expect(outboxFoundation).toMatch(/create or replace function public\.enqueue_notification_event\(/);
  });

  it('backfills non-scheduled legacy plans as PRIVATE and prevents underpaid statuses', () => {
    expect(normalizedMigration).toContain("when booking_type in ('INSTANT', 'REQUEST') then 'PRIVATE'");
    expect(normalizedMigration).toMatch(/payment_status <> 'PARTIAL' or \(paid_amount > 0 and paid_amount >= upfront_required_amount\)/);
    expect(normalizedMigration).toMatch(/payment_status <> 'PAID' or paid_amount = total_amount/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_FIXED' then o\.payment_status in \('PARTIAL', 'PAID'\) and o\.paid_amount >= o\.upfront_required_amount/);
    expect(normalizedMigration).toMatch(/when 'FULL' then o\.payment_status = 'PAID' and o\.paid_amount >= o\.total_amount/);
  });

  it('keeps an accepted risk baseline and rejects a non-manager actor', () => {
    expect(normalizedMigration).toContain('formation_risk_accepted_participants');
    expect(normalizedMigration).toMatch(/v_participants < v_dep\.formation_risk_accepted_participants/);
    expect(normalizedMigration).toMatch(/formation_risk_accepted_participants = v_participants/);
    expect(normalizedMigration.match(/formation_risk_accepted_participants = v_participants/g)).toHaveLength(2);
    expect(normalizedMigration).toMatch(/from public\.tenant_users where tenant_id = p_tenant and user_id = p_actor_user and role in \('OWNER', 'MANAGER'\)/);
    expect(normalizedMigration).toContain('FORMATION_ACTOR_FORBIDDEN');
  });

  it('derives order snapshots from the same-tenant Plan and enforces future private modes', () => {
    expect(normalizedMigration).toMatch(/new\.deposit_mode_snapshot := v_plan\.deposit_mode/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_FIXED' then v_plan\.deposit_value/);
    expect(normalizedMigration).toMatch(/when 'DEPOSIT_PERCENT' then pg_catalog\.round\(new\.total_amount \* v_plan\.deposit_value \/ 100, 2\)/);
    expect(normalizedMigration).toMatch(/create trigger t_trip_plans_participation_mode_41 before insert or update of booking_type, participation_mode/);
    expect(normalizedMigration).toMatch(/if new\.booking_type in \('INSTANT', 'REQUEST'\) then new\.participation_mode := 'PRIVATE'/);
  });

  it('refreshes formation whenever an order field that changes qualification, headcount, or departure changes', () => {
    expect(normalizedMigration).toMatch(
      /create trigger t_tour_orders_refresh_formation after insert or update of status, payment_status, paid_amount, refunded_amount, party_size, departure_id on tour_orders/,
    );
    expect(normalizedMigration).toMatch(/old\.departure_id is distinct from new\.departure_id/);
    expect(normalizedMigration).toMatch(/refresh_departure_formation\(old\.departure_id\)/);
    expect(normalizedMigration).toMatch(/refresh_departure_formation\(new\.departure_id\)/);
  });

  it('hardens fresh and already-applied #41 definer functions without exposing internal RPCs', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).not.toContain('set search_path = public, pg_temp');
      expect(source.match(/security definer set search_path = ''/g)).toHaveLength(9);
      expect(source).toMatch(/create or replace function public\.enqueue_formation_notification_41\(/);
      expect(source).toMatch(/pg_catalog\.to_regprocedure\( 'public\.enqueue_notification_event\(uuid,text,text,text,text,jsonb\)' \)/);
      expect(source).toContain("raise exception 'NOTIFICATION_OUTBOX_UNAVAILABLE'");
      expect(source).not.toMatch(/perform public\.enqueue_notification_event\(/);
      expect(source).toMatch(/revoke execute on function public\.enqueue_formation_notification_41\(pg_catalog\.uuid, pg_catalog\.text, pg_catalog\.text, pg_catalog\.text, pg_catalog\.text, pg_catalog\.jsonb\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/revoke execute on function public\.qualifying_tour_participants\(pg_catalog\.uuid\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/revoke execute on function public\.refresh_departure_formation\(pg_catalog\.uuid\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/revoke execute on function public\.refresh_tour_order_formation_trigger\(\) from public, anon, authenticated, service_role/);
      expect(source).toMatch(/grant execute on function public\.review_expired_tour_formations\(pg_catalog\.timestamptz\) to service_role/);
      expect(source).toMatch(/grant execute on function public\.decide_tour_formation\(pg_catalog\.uuid, pg_catalog\.uuid, pg_catalog\.text, pg_catalog\.uuid, pg_catalog\.timestamptz, pg_catalog\.text\) to service_role/);
    }
  });

  it('uses pg_catalog.int4 rather than the unavailable pg_catalog.integer alias', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).toContain('returns pg_catalog.int4');
      expect(source).toContain('::pg_catalog.int4');
      expect(source).not.toContain('pg_catalog.integer');
    }
  });

  it('does not schema-qualify SQL special forms', () => {
    for (const source of [normalizedMigration, normalizedHardeningMigration]) {
      expect(source).not.toContain('pg_catalog.coalesce');
      expect(source).not.toContain('pg_catalog.nullif');
    }
  });

  it('repairs lifecycle idempotency with a persisted transition epoch without rewriting 0040/0041', () => {
    expect(normalizedEpochRepairMigration).toMatch(
      /add column if not exists formation_transition_revision pg_catalog\.int8 not null default 0/,
    );
    expect(normalizedEpochRepairMigration).toMatch(
      /before update of formation_status on public\.trip_departures/,
    );
    expect(normalizedEpochRepairMigration).toMatch(
      /new\.formation_transition_revision := old\.formation_transition_revision \+ 1/,
    );
    expect(normalizedEpochRepairMigration).toMatch(
      /v_key := p_idempotency_key \|\| ':r' \|\| v_revision::pg_catalog\.text/,
    );
    expect(normalizedEpochRepairMigration).toMatch(
      /'formationTransitionRevision', v_revision/,
    );
    expect(normalizedEpochRepairMigration).toMatch(
      /pg_catalog\.to_regprocedure\( 'public\.enqueue_notification_event\(uuid,text,text,text,text,jsonb\)' \)/,
    );
    expect(normalizedEpochRepairMigration).toContain("raise exception 'NOTIFICATION_OUTBOX_UNAVAILABLE'");
    expect(normalizedEpochRepairMigration).toMatch(
      /revoke execute on function public\.bump_formation_transition_revision_41\(\) from public, anon, authenticated, service_role/,
    );
    expect(normalizedEpochRepairMigration).toContain('v_revision pg_catalog.int8');
    expect(normalizedEpochRepairMigration).not.toContain('pg_catalog.bigint');
  });

  it('snapshots configurable balance and cancellation policy without inventing refund amounts', () => {
    const balancePolicy = readFileSync(`${migrationDirectory}/${issue41BalancePolicyMigration}`, 'utf8')
      .replace(/\s+/g, ' ');

    expect(balancePolicy).toMatch(/balance_due_hours integer default 48/);
    expect(balancePolicy).toMatch(/balance_due_hours_snapshot integer default 48/);
    expect(balancePolicy).toContain("balance_collection_mode in ('DEADLINE', 'ON_SITE')");
    expect(balancePolicy).toContain('balance_due_at timestamptz');
    expect(balancePolicy).toContain('cancellation_policy_snapshot jsonb');
    expect(balancePolicy).toMatch(/create or replace function public\.enforce_tour_order_lineage_41\(\)/);
    expect(balancePolicy).toMatch(/from public\.trip_departures .*for key share/);
    expect(balancePolicy).toMatch(/from public\.trip_plans .*for key share/);
    expect(balancePolicy).toContain('TOUR_ORDER_LINEAGE_INVALID');
    expect(balancePolicy).toContain("'minimumDaysBeforeDeparture', 8");
    expect(balancePolicy).toContain("'minimumDaysBeforeDeparture', 4");
    expect(balancePolicy).toContain("'minimumDaysBeforeDeparture', 0");
    expect(balancePolicy).not.toMatch(/refund_percent|refundPercentage/i);
    expect(balancePolicy).toMatch(/update public\.tour_orders as o set balance_due = greatest\(o\.total_amount - o\.paid_amount, 0\)/);
    const refundBasis = readFileSync(`${migrationDirectory}/${issue41RefundBasisMigration}`, 'utf8');
    expect(refundBasis).toContain('ACTUAL_NONREFUNDABLE_COST');
    expect(refundBasis).not.toMatch(/refund_percent|refundPercentage/i);
  });

  it('keeps bank payment atomic, idempotent, and makes unavailable runtime dependencies fail closed', () => {
    const runtime = readFileSync(`${migrationDirectory}/${issue41RuntimeContractMigration}`, 'utf8')
      .replace(/\s+/g, ' ');
    const cancellation = readFileSync(`${migrationDirectory}/${issue41CancellationMigration}`, 'utf8')
      .replace(/\s+/g, ' ');
    const bankRoute = readFileSync('src/app/api/tour-orders/[id]/confirm-payment/route.ts', 'utf8');
    const cancelRoute = readFileSync('src/app/api/tour-orders/[id]/cancel/route.ts', 'utf8');
    const providerRoute = readFileSync('src/app/api/tour-orders/[id]/provider-success/route.ts', 'utf8');
    const completionRoute = readFileSync('src/app/api/tour-orders/[id]/complete/route.ts', 'utf8');
    const decisionRoute = readFileSync('src/app/api/trip-departures/[id]/formation-decision/route.ts', 'utf8');
    const reviewCron = readFileSync('src/app/api/cron/tour-formation-review/route.ts', 'utf8');

    expect(runtime).toMatch(/unique \(tenant_id, channel, receipt_reference\)/);
    expect(runtime).toMatch(/for update;.*for key share;.*for update;/);
    expect(runtime).toContain('TOUR_ORDER_LINEAGE_INVALID');
    expect(runtime).toContain('where id = p_order and tenant_id = p_tenant');
    expect(runtime).toContain('hold_expires_at = case when v_order.deposit_mode_snapshot = \'NONE\'');
    expect(runtime).toContain('PAYMENT_AMOUNT_EXCEEDS_TOTAL');
    expect(runtime).toContain('TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37');
    expect(runtime).toMatch(/grant execute on function public\.record_tour_order_payment_41\([\s\S]*?\) to service_role/);
    expect(bankRoute).toContain("p_channel: 'BANK_MANUAL'");
    expect(bankRoute).toContain('receiptReference');
    expect(cancellation).toMatch(/for update;.*for key share;.*for update;/);
    expect(cancellation).toContain("when paid_amount > refunded_amount then 'REFUND_PENDING'");
    expect(cancellation).toContain('TOUR_ORDER_COMPLETED_NOT_CANCELLABLE');
    expect(cancellation).toContain('TOUR_ORDER_ALREADY_CANCELLED');
    expect(cancellation).not.toMatch(/refund_percent|refundPercentage/i);
    expect(cancelRoute).toContain("rpc('cancel_tour_order_41'");
    expect(providerRoute).toContain('PAYMENT_PROVIDER_BLOCKED_BY_DEPENDENCY_9');
    expect(completionRoute).toContain('TOUR_COMPLETION_BLOCKED_BY_DEPENDENCY_37');
    expect(completionRoute).toContain('TOUR_COMPLETION_CONTRACT_NOT_WIRED');
    expect(decisionRoute).toContain("rpc('decide_tour_formation'");
    expect(decisionRoute).toContain("requireTenant('MANAGER')");
    expect(reviewCron).toContain("rpc('review_expired_tour_formations'");
    expect(reviewCron).toContain('CRON_SECRET');
    const receiptGuard = readFileSync(`${migrationDirectory}/${issue41ReceiptGuardMigration}`, 'utf8');
    expect(receiptGuard).toContain('v_existing_amount is distinct from p_amount');
    const noneQualification = readFileSync(`${migrationDirectory}/${issue41NoneQualificationMigration}`, 'utf8');
    expect(noneQualification).toContain("new.deposit_mode_snapshot = 'NONE'");
    expect(noneQualification).toContain("new.status := 'CONFIRMED'");
    expect(noneQualification).toContain("new.hold_expires_at := null");
  });

  it('wires real-mode order actions to services while keeping mock mutations explicit', () => {
    const page = readFileSync('src/app/tenant/tour-orders/page.tsx', 'utf8');

    expect(page).toContain("import { USE_MOCK } from '@/config/env'");
    expect(page).toContain('if (USE_MOCK)');
    expect(page).toContain('await confirmTourOrderPayment(order.id, { amount, receiptReference: receiptReference.trim() })');
    expect(page).toContain('await completeTourOrder(order.id)');
    expect(page).toContain('await cancelTourOrder(order.id, cancelReason.trim() || undefined)');
    expect(page).toContain('if (!USE_MOCK) await load()');
    expect(page).toContain('paymentReceiptRequired');
    expect(page).toContain('manualCreateBlocked');
  });

  it('exposes a tenant-scoped real list and an atomic manual-create API contract', () => {
    const listRoute = readFileSync('src/app/api/tour-orders/route.ts', 'utf8');
    const manualRoute = readFileSync('src/app/api/tour-orders/manual/route.ts', 'utf8');

    expect(listRoute).toContain("requireTenant()");
    expect(listRoute).toContain(".eq('tenant_id', t.tenantId)");
    expect(listRoute).toContain("'PARTIAL'");
    expect(manualRoute).toContain("requireTenant('MANAGER')");
    expect(manualRoute).toContain("rpc('create_tour_order'");
    expect(manualRoute).not.toContain(".insert(");
  });
});
