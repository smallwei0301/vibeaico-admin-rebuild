import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (file: string) => fs.readFileSync(path.join(root, file), 'utf8');

describe('Issue #17 booking add-on source contracts', () => {
  const migration = read('supabase/migrations/0053_issue_17_booking_addons.sql');
  const hardening = read('supabase/migrations/0054_issue_17_booking_addons_hardening.sql');
  const rollback = read('supabase/migrations/0055_issue_17_booking_addon_price_rollback.sql');
  const idempotency = read('supabase/migrations/0056_issue_17_booking_addon_idempotency.sql');
  const retryRepair = read('supabase/migrations/0057_issue_17_notification_claim_idempotency_race.sql');
  const rowCountRepair = read('supabase/migrations/0058_issue_17_idempotency_insert_row_count.sql');
  const returnRepair = read('supabase/migrations/0059_issue_17_idempotency_return_guards.sql');
  const safetyRepair = read('supabase/migrations/0061_issue_17_notification_safety_and_tombstones.sql');
  const page = read('src/app/tenant/bookings/page.tsx');
  const api = read('src/app/api/bookings/[id]/addons/route.ts');
  const line = read('src/server/line.ts');

  it('uses a current-main forward migration and atomic RPCs, never route CAS compensation', () => {
    expect(migration).toContain('add_booking_addon_17');
    expect(migration).toContain('delete_booking_addon_17');
    expect(migration).toContain('mark_booking_addon_notification_17');
    expect(migration).toContain('for update');
    expect(migration).toContain('security definer');
    expect(migration).toContain('final_price = final_price + v_amount');
    expect(migration).toContain('final_price = final_price - v_addon.applied_amount');
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0053_issue_17_booking_addons.sql'))).toBe(true);
  });

  it('keeps the 0055 current-price rollback and non-negative floor correction', () => {
    expect(rollback).toContain('create or replace function public.delete_booking_addon_17');
    expect(rollback).toContain('Preserve any later price adjustment/discount');
    expect(rollback).toContain(
      'final_price = greatest(public.bookings.final_price - v_addon.applied_amount, 0)',
    );
    expect(rollback).toContain('grant execute on function public.delete_booking_addon_17');
  });

  it('locks down direct writes and validates tenant lineage plus explicit C+ attribution', () => {
    expect(migration).toContain('enable row level security');
    expect(migration).toContain("create policy p_booking_addons_s on booking_addons for select");
    expect(migration).toContain("tenant_role_at_least(p_tenant_id, 'MANAGER')");
    expect(migration).toContain("'PRIMARY', 'SPECIFIC_STAFF', 'NONE'");
    expect(migration).toContain('foreign key (tenant_id, performance_staff_id)');
    expect(migration).toContain('drop constraint if exists booking_addons_performance_staff_fkey');
    expect(migration).toContain('on delete set null (performance_staff_id)');
    expect(migration).toContain("conrelid = 'public.staff'::regclass");
    expect(migration).toContain('regexp_replace(pg_get_indexdef(indexrelid)');
    expect(migration).toContain('never drop/recreate or weaken staff uniqueness');
    expect(migration).toContain('p_price < 0');
    expect(migration).toContain("price numeric not null check (price >= 0)");
    expect(migration).toContain("'NONE'::addon_performance_mode");
    expect(migration).toContain("'SPECIFIC_STAFF'::addon_performance_mode");
    expect(migration).toContain('BOOKING_ADDON_DURATION_CONFLICT');
    expect(migration).toContain('BOOKING_ADDON_SNAPSHOT_CONFLICT');
    expect(migration).toContain('v_addon.applied_amount < 0');
    expect(migration).toContain('v_addon.applied_minutes < 0');
    expect(migration).toContain('add column if not exists updated_at timestamptz not null default now()');
    expect(migration).toContain('booking_addons_applied_amount_nonnegative');
    expect(migration).toContain('booking_addons_applied_minutes_nonnegative');
    expect(migration).toContain('v_booking.duration_minutes < v_addon.applied_minutes');
    expect(migration).not.toContain('greatest(0, final_price - v_addon.applied_amount)');
    expect(migration).toContain("drop policy if exists p_booking_addons_u");
    expect(migration).not.toContain('create policy p_booking_addons_u');
  });

  it('uses truthful receipt outcomes instead of delay-based false success', () => {
    expect(api).toContain('notify: z.boolean().default(false)');
    expect(api).toContain('idempotencyKey: z.string().uuid()');
    expect(api).toContain('notifyBookingAddonReceipt');
    expect(api).toContain("rpc('claim_booking_addon_notification_17'");
    expect(api).toContain("rpc('mark_booking_addon_notification_17'");
    expect(api).toContain('const admin = createAdminSupabase()');
    expect(api).toContain('notificationPending: true');
    expect(api).toContain('throwMarkerFailure');
    expect(api).toContain("notified === 'QUOTA_EXCEEDED'");
    expect(api).toContain('{ persisted: true }');
    expect(api).toContain("error?.code === '23P01'");
    expect(api).toContain('加購後時段與既有預約重疊，資料未變更');
    expect(api).toContain('加購已新增，但本月推播額度已用完');
    expect(api).not.toContain(".update({ notified })");
    expect(migration).toContain("p_notified not in ('NONE','LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED')");
    expect(migration).toContain('from public, anon, authenticated');
    expect(migration).toContain('to service_role');
    expect(migration).toContain("if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;");
    expect(read('src/lib/types.ts')).toContain("'PRIMARY' | 'SPECIFIC_STAFF' | 'NONE'");
    expect(read('src/lib/types.ts')).toContain("'NONE' | 'PENDING' | 'LINE' | 'NO_LINE' | 'NOT_CONFIGURED' | 'QUOTA_EXCEEDED' | 'FAILED'");
    expect(api).toContain("price: z.number().finite().min(0)");
    expect(page).not.toContain('setTimeout(r, 400)');
    expect(page).toContain('createBookingAddon(booking.id');
    expect(page).toContain('deleteBookingAddon(booking.id, addon.id)');
    expect(page).toContain('onAdded={(result) =>');
    expect(page).toContain('onPersistedQuotaExceeded');
    expect(page).toContain("(e.data as { persisted?: boolean } | undefined)?.persisted");
    const recoveryStart = page.indexOf('onPersistedQuotaExceeded={() =>');
    const quotaRecovery = page.slice(recoveryStart, page.indexOf('}}', recoveryStart) + 2);
    expect(recoveryStart).toBeGreaterThan(-1);
    expect(quotaRecovery).toContain('setAddonTarget(null);');
    expect(quotaRecovery).toContain('setDetailTarget(null);');
    expect(quotaRecovery).toContain('setAddonRevision((revision) => revision + 1);');
    expect(quotaRecovery).toContain('void load();');
    expect(page).toContain('finalPrice: result.finalPrice');
    expect(page).toContain('durationMinutes: result.durationMinutes');
    expect(page).toContain('endAt: result.endAt');
    expect(read('src/services/bookings.ts')).toContain('Object.assign(booking, { finalPrice, durationMinutes, endAt })');
  });

  it('hardens the forward RPC and quota boundary without reopening direct table DML', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0054_issue_17_booking_addons_hardening.sql'))).toBe(true);
    expect(hardening).toContain('revoke all on table public.booking_addons from public, anon, authenticated');
    expect(hardening).toContain('grant select on table public.booking_addons to authenticated');
    expect(hardening).toContain('grant select, insert, update, delete on table public.booking_addons to service_role');
    expect(hardening).toContain('for select to authenticated');
    expect(hardening.match(/security definer set search_path = ''/g)).toHaveLength(4);
    expect(hardening).toContain('from public, anon, service_role');
    expect(hardening).toContain('grant execute on function public.add_booking_addon_17');
    expect(hardening).toContain('grant execute on function public.delete_booking_addon_17');
    expect(hardening).toContain('grant execute on function public.mark_booking_addon_notification_17');
    expect(hardening).toContain('grant execute on function public.consume_push_quota_17');
    expect(hardening).toContain('on conflict (tenant_id, month) do update');
    expect(hardening).toContain('where public.push_quota_usage.used + excluded.used <= p_quota');
    expect(line).toContain("rpc('consume_push_quota_17'");
    expect(line).toContain("if (data !== true) return { state: 'EXHAUSTED' }");
    expect(line).toContain('quota reservation failed');
    expect(line).not.toContain("from('push_quota_usage').select('used')");
  });

  it('binds retries to one booking mutation and fails closed on notification ambiguity', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0056_issue_17_booking_addon_idempotency.sql'))).toBe(true);
    expect(idempotency).toContain('add column if not exists idempotency_key text');
    expect(idempotency).toContain('notification_requested boolean not null default false');
    expect(idempotency).toContain('booking_addons_idempotency_key_uq');
    expect(idempotency).toContain('BOOKING_ADDON_IDEMPOTENCY_CONFLICT');
    expect(idempotency).toContain('p_idempotency_key text');
    expect(idempotency).toContain('p_notify boolean default false');
    expect(idempotency).toContain("set notified = 'PENDING'");
    expect(idempotency).toContain('claim_booking_addon_notification_17');
    expect(idempotency).toContain("and notified = 'PENDING'");
    expect(idempotency).toContain('BOOKING_ADDON_NOTIFICATION_CONFLICT');
    expect(idempotency).toContain('to authenticated');
    expect(idempotency).toContain('to service_role');
    expect(read('src/lib/types.ts')).toContain("'NONE' | 'PENDING' | 'LINE'");
    expect(read('src/services/bookings.ts')).toContain('idempotencyKey: string');
    expect(page).toContain('setIdempotencyKey(crypto.randomUUID());');
    expect(page).toContain('onPersistedNotificationPending');
  });

  it('keeps the 0056 contract immutable while repairing the claim ambiguity and unique-key race forward-only', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0057_issue_17_notification_claim_idempotency_race.sql'))).toBe(true);
    expect(retryRepair).toContain('on conflict (tenant_id, booking_id, idempotency_key)');
    expect(retryRepair).toContain('where (idempotency_key is not null) do nothing');
    expect(retryRepair).toContain('returning ba.notified into v_claim_notified');
    expect(retryRepair).toContain('notified := v_claim_notified');
    expect(retryRepair).not.toContain('public.booking_addons.notified into claimed, notified');
    expect(retryRepair).toContain("grant execute on function public.claim_booking_addon_notification_17");
    expect(retryRepair).toContain("grant execute on function public.add_booking_addon_17");
  });
  it('classifies an idempotency no-op from ROW_COUNT before changing booking totals', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0058_issue_17_idempotency_insert_row_count.sql'))).toBe(true);
    expect(rowCountRepair).toContain('get diagnostics v_inserted = row_count');
    expect(rowCountRepair).toContain('if v_inserted = 0 then');
    expect(rowCountRepair).toContain('on conflict (tenant_id, booking_id, idempotency_key)');
    expect(rowCountRepair).not.toContain('if not found then\\n    select * into v_existing');
    expect(rowCountRepair).toContain("grant execute on function public.add_booking_addon_17");
  });

  it('terminates replay branches after returning the existing row', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0059_issue_17_idempotency_return_guards.sql'))).toBe(true);
    expect(returnRepair.match(/return next;\n    return;/g)).toHaveLength(2);
    expect(returnRepair).toContain('grant execute on function public.add_booking_addon_17');
  });

  it('keeps claim cardinality exact and retains idempotency after add-on deletion', () => {
    expect(fs.existsSync(path.join(root, 'supabase/migrations/0061_issue_17_notification_safety_and_tombstones.sql'))).toBe(true);
    expect(safetyRepair).toContain('booking_addon_idempotency_receipts_17');
    expect(safetyRepair).toContain("receipt_state in ('ACTIVE', 'DELETED')");
    expect(safetyRepair).toContain("raise exception 'BOOKING_ADDON_IDEMPOTENCY_RETIRED'");
    expect(safetyRepair).toContain("receipt_state = 'DELETED'");
    const claimStart = safetyRepair.indexOf('create or replace function public.claim_booking_addon_notification_17');
    expect(claimStart).toBeGreaterThan(-1);
    const claim = safetyRepair.slice(claimStart, safetyRepair.indexOf('create or replace function public.mark_booking_addon_notification_17'));
    expect(claim.match(/return next;/g)).toHaveLength(2);
    expect(claim.match(/^\s+return;$/gm)).toHaveLength(2);
    expect(safetyRepair).toContain('refund_push_quota_17');
    expect(safetyRepair).toContain('grant execute on function public.refund_push_quota_17');
  });

  it('uses typed notification outcomes and refunds quota only for confirmed provider rejection', () => {
    const notify = read('src/server/booking-addon-notify.ts');
    const line = read('src/server/line.ts');
    const route = read('src/app/api/bookings/[id]/addons/route.ts');
    expect(notify).toContain("'CONFIRMED_PROVIDER_REJECTION'");
    expect(notify).toContain("'DB_UNAVAILABLE'");
    expect(notify).toContain("'PROVIDER_AMBIGUOUS'");
    expect(notify).toContain("return result('PENDING'");
    expect(notify).toContain('refundPushQuotaForBookingAddon');
    expect(notify).toContain('isConfirmedProviderRejection');
    expect(notify).toContain("return result('FAILED'");
    expect(line).toContain('reservePushQuotaForBookingAddon');
    expect(line).toContain("rpc('refund_push_quota_17'");
    expect(route).toContain('claimRowOrPending');
    expect(route).toContain('value.length !== 1');
    expect(route).toContain('notification.outcome');
  });
});
