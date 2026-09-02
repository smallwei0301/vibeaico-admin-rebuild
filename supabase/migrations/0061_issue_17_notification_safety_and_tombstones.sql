-- Issue #17 forward repair after 0059.
--
-- This migration keeps the applied 0053-0059 lineage immutable while closing
-- four retry boundaries: claim cardinality, notification outcome
-- classification, quota refund ownership, and idempotency after DELETE.

create table if not exists public.booking_addon_idempotency_receipts_17 (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  booking_id uuid not null references public.bookings(id) on delete cascade,
  idempotency_key text not null,
  addon_id uuid,
  service_id uuid,
  name text not null,
  price numeric not null check (price >= 0),
  quantity integer not null check (quantity >= 1),
  duration_minutes integer not null check (duration_minutes >= 0),
  staff_id uuid,
  performance_mode public.addon_performance_mode not null,
  performance_staff_id uuid,
  notification_requested boolean not null default false,
  receipt_state text not null default 'ACTIVE'
    check (receipt_state in ('ACTIVE', 'DELETED')),
  created_at timestamptz not null default now(),
  deleted_at timestamptz,
  primary key (tenant_id, booking_id, idempotency_key),
  check (
    idempotency_key ~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  )
);

-- The receipt is an internal ledger.  Authenticated REST callers must not be
-- able to alter or read it directly; the add/delete RPCs own its transitions.
alter table public.booking_addon_idempotency_receipts_17 enable row level security;
revoke all on table public.booking_addon_idempotency_receipts_17
  from public, anon, authenticated, service_role;

-- Reconcile keys created by 0056-0059 before this independent receipt existed.
-- The INSERT is idempotent and never rewrites an existing receipt snapshot.
insert into public.booking_addon_idempotency_receipts_17 (
  tenant_id, booking_id, idempotency_key, addon_id, service_id, name, price,
  quantity, duration_minutes, staff_id, performance_mode, performance_staff_id,
  notification_requested
)
select
  ba.tenant_id, ba.booking_id, ba.idempotency_key, ba.id, ba.service_id, ba.name, ba.price,
  ba.quantity, ba.duration_minutes, ba.staff_id, ba.performance_mode, ba.performance_staff_id,
  ba.notification_requested
from public.booking_addons as ba
where ba.idempotency_key is not null
on conflict (tenant_id, booking_id, idempotency_key) do nothing;

create or replace function public.add_booking_addon_17(
  p_tenant_id uuid,
  p_booking_id uuid,
  p_service_id uuid,
  p_name text,
  p_price numeric,
  p_quantity integer,
  p_duration_minutes integer,
  p_idempotency_key text,
  p_staff_id uuid default null,
  p_no_personal_credit boolean default false,
  p_notify boolean default false
) returns table (
  addon_id uuid,
  final_price numeric,
  duration_minutes integer,
  end_at timestamptz,
  created boolean,
  notified text
)
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_existing public.booking_addons%rowtype;
  v_receipt public.booking_addon_idempotency_receipts_17%rowtype;
  v_service public.services%rowtype;
  v_staff public.staff%rowtype;
  v_amount numeric;
  v_minutes integer;
  v_request_key text;
  v_performance_mode public.addon_performance_mode;
  v_performance_staff_id uuid;
  v_inserted integer;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;
  v_request_key := btrim(coalesce(p_idempotency_key, ''));
  if p_name is null or btrim(p_name) = '' or p_price < 0 or p_quantity < 1
     or p_duration_minutes < 0
     or v_request_key !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;

  -- One booking lock serializes add, delete and same-key replay.  It also
  -- makes the independent receipt transition linearizable with the resource.
  select * into v_booking from public.bookings as b
    where b.id = p_booking_id and b.tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;

  v_performance_mode := case
    when p_no_personal_credit then 'NONE'::public.addon_performance_mode
    when p_staff_id is not null then 'SPECIFIC_STAFF'::public.addon_performance_mode
    else 'PRIMARY'::public.addon_performance_mode end;
  v_performance_staff_id := case
    when p_no_personal_credit then null
    when p_staff_id is not null then p_staff_id
    else v_booking.staff_id end;

  -- A deleted resource still owns its request key.  Validate the original
  -- payload before retiring the retry, so a changed payload cannot repurpose it.
  select * into v_receipt
  from public.booking_addon_idempotency_receipts_17 as r
  where r.tenant_id = p_tenant_id and r.booking_id = p_booking_id
    and r.idempotency_key = v_request_key
  for update;
  if found then
    if v_receipt.service_id is distinct from p_service_id
       or v_receipt.name is distinct from btrim(p_name)
       or v_receipt.price is distinct from p_price
       or v_receipt.quantity is distinct from p_quantity
       or v_receipt.duration_minutes is distinct from p_duration_minutes
       or v_receipt.staff_id is distinct from p_staff_id
       or v_receipt.performance_mode is distinct from v_performance_mode
       or v_receipt.performance_staff_id is distinct from v_performance_staff_id
       or v_receipt.notification_requested is distinct from coalesce(p_notify, false) then
      raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT';
    end if;
    if v_receipt.receipt_state = 'DELETED' then
      raise exception 'BOOKING_ADDON_IDEMPOTENCY_RETIRED';
    end if;
    select * into v_existing from public.booking_addons as ba
      where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id
        and ba.idempotency_key = v_request_key
      for update;
    if not found then raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT'; end if;
    addon_id := v_existing.id;
    final_price := v_booking.final_price;
    duration_minutes := v_booking.duration_minutes;
    end_at := v_booking.end_at;
    created := false;
    notified := v_existing.notified;
    return next;
    return;
  end if;

  -- Reconcile a keyed add-on created before 0061.  The receipt is created
  -- before returning, so a later DELETE cannot release the key.
  select * into v_existing from public.booking_addons as ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id
      and ba.idempotency_key = v_request_key
    for update;
  if found then
    if v_existing.service_id is distinct from p_service_id
       or v_existing.name is distinct from btrim(p_name)
       or v_existing.price is distinct from p_price
       or v_existing.quantity is distinct from p_quantity
       or v_existing.duration_minutes is distinct from p_duration_minutes
       or v_existing.staff_id is distinct from p_staff_id
       or v_existing.performance_mode is distinct from v_performance_mode
       or v_existing.performance_staff_id is distinct from v_performance_staff_id
       or v_existing.notification_requested is distinct from coalesce(p_notify, false) then
      raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT';
    end if;
    insert into public.booking_addon_idempotency_receipts_17 (
      tenant_id, booking_id, idempotency_key, addon_id, service_id, name, price,
      quantity, duration_minutes, staff_id, performance_mode, performance_staff_id,
      notification_requested
    ) values (
      v_existing.tenant_id, v_existing.booking_id, v_existing.idempotency_key, v_existing.id,
      v_existing.service_id, v_existing.name, v_existing.price, v_existing.quantity,
      v_existing.duration_minutes, v_existing.staff_id, v_existing.performance_mode,
      v_existing.performance_staff_id, v_existing.notification_requested
    ) on conflict (tenant_id, booking_id, idempotency_key) do nothing;
    addon_id := v_existing.id;
    final_price := v_booking.final_price;
    duration_minutes := v_booking.duration_minutes;
    end_at := v_booking.end_at;
    created := false;
    notified := v_existing.notified;
    return next;
    return;
  end if;

  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;
  if p_service_id is not null then
    select * into v_service from public.services as s
      where s.id = p_service_id and s.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_SERVICE_NOT_FOUND'; end if;
  end if;
  if p_staff_id is not null then
    select * into v_staff from public.staff as st
      where st.id = p_staff_id and st.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_STAFF_NOT_FOUND'; end if;
  end if;
  if v_performance_mode = 'PRIMARY'::public.addon_performance_mode
     and v_performance_staff_id is not null then
    perform 1 from public.staff as st
      where st.id = v_performance_staff_id and st.tenant_id = p_tenant_id for key share;
    if not found then raise exception 'BOOKING_ADDON_PRIMARY_STAFF_NOT_FOUND'; end if;
  end if;

  v_amount := p_price * p_quantity;
  v_minutes := p_duration_minutes * p_quantity;
  insert into public.booking_addons (
    tenant_id, booking_id, service_id, name, price, quantity, duration_minutes, staff_id,
    applied_amount, applied_minutes, performance_mode, performance_staff_id,
    idempotency_key, notification_requested
  ) values (
    p_tenant_id, p_booking_id, p_service_id, btrim(p_name), p_price, p_quantity, p_duration_minutes, p_staff_id,
    v_amount, v_minutes, v_performance_mode, v_performance_staff_id,
    v_request_key, coalesce(p_notify, false)
  )
  on conflict (tenant_id, booking_id, idempotency_key)
    where (idempotency_key is not null) do nothing
  returning id into addon_id;
  get diagnostics v_inserted = row_count;

  if v_inserted = 0 then
    select * into v_existing from public.booking_addons as ba
      where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id
        and ba.idempotency_key = v_request_key
      for update;
    if not found then raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT'; end if;
    if v_existing.service_id is distinct from p_service_id
       or v_existing.name is distinct from btrim(p_name)
       or v_existing.price is distinct from p_price
       or v_existing.quantity is distinct from p_quantity
       or v_existing.duration_minutes is distinct from p_duration_minutes
       or v_existing.staff_id is distinct from p_staff_id
       or v_existing.performance_mode is distinct from v_performance_mode
       or v_existing.performance_staff_id is distinct from v_performance_staff_id
       or v_existing.notification_requested is distinct from coalesce(p_notify, false) then
      raise exception 'BOOKING_ADDON_IDEMPOTENCY_CONFLICT';
    end if;
    insert into public.booking_addon_idempotency_receipts_17 (
      tenant_id, booking_id, idempotency_key, addon_id, service_id, name, price,
      quantity, duration_minutes, staff_id, performance_mode, performance_staff_id,
      notification_requested
    ) values (
      v_existing.tenant_id, v_existing.booking_id, v_existing.idempotency_key, v_existing.id,
      v_existing.service_id, v_existing.name, v_existing.price, v_existing.quantity,
      v_existing.duration_minutes, v_existing.staff_id, v_existing.performance_mode,
      v_existing.performance_staff_id, v_existing.notification_requested
    ) on conflict (tenant_id, booking_id, idempotency_key) do nothing;
    addon_id := v_existing.id;
    final_price := v_booking.final_price;
    duration_minutes := v_booking.duration_minutes;
    end_at := v_booking.end_at;
    created := false;
    notified := v_existing.notified;
    return next;
    return;
  end if;

  -- Keep the key after the resource is deleted.  This insert is in the same
  -- transaction as the financial mutation and therefore cannot orphan a live
  -- add-on without its receipt.
  insert into public.booking_addon_idempotency_receipts_17 (
    tenant_id, booking_id, idempotency_key, addon_id, service_id, name, price,
    quantity, duration_minutes, staff_id, performance_mode, performance_staff_id,
    notification_requested
  ) values (
    p_tenant_id, p_booking_id, v_request_key, addon_id, p_service_id, btrim(p_name), p_price,
    p_quantity, p_duration_minutes, p_staff_id, v_performance_mode, v_performance_staff_id,
    coalesce(p_notify, false)
  );

  update public.bookings as b set
    final_price = b.final_price + v_amount,
    duration_minutes = b.duration_minutes + v_minutes,
    end_at = b.end_at + make_interval(mins => v_minutes)
  where b.id = p_booking_id and b.tenant_id = p_tenant_id
  returning b.final_price, b.duration_minutes, b.end_at
  into final_price, duration_minutes, end_at;
  created := true;
  notified := 'NONE';
  return next;
end $$;

create or replace function public.delete_booking_addon_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (final_price numeric, duration_minutes integer, end_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_addon public.booking_addons%rowtype;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;
  select * into v_booking from public.bookings as b
    where b.id = p_booking_id and b.tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;
  select * into v_addon from public.booking_addons as ba
    where ba.id = p_addon_id and ba.booking_id = p_booking_id and ba.tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  if v_addon.applied_amount is null or v_addon.applied_amount < 0
     or v_addon.applied_minutes is null or v_addon.applied_minutes < 0 then
    raise exception 'BOOKING_ADDON_SNAPSHOT_CONFLICT';
  end if;
  if v_booking.duration_minutes < v_addon.applied_minutes
     or v_booking.end_at - make_interval(mins => v_addon.applied_minutes) <= v_booking.start_at then
    raise exception 'BOOKING_ADDON_DURATION_CONFLICT';
  end if;

  if v_addon.idempotency_key is not null then
    insert into public.booking_addon_idempotency_receipts_17 (
      tenant_id, booking_id, idempotency_key, addon_id, service_id, name, price,
      quantity, duration_minutes, staff_id, performance_mode, performance_staff_id,
      notification_requested, receipt_state, deleted_at
    ) values (
      v_addon.tenant_id, v_addon.booking_id, v_addon.idempotency_key, v_addon.id,
      v_addon.service_id, v_addon.name, v_addon.price, v_addon.quantity, v_addon.duration_minutes,
      v_addon.staff_id, v_addon.performance_mode, v_addon.performance_staff_id,
      v_addon.notification_requested, 'DELETED', now()
    ) on conflict (tenant_id, booking_id, idempotency_key) do update set
      addon_id = null,
      receipt_state = 'DELETED',
      deleted_at = coalesce(
        public.booking_addon_idempotency_receipts_17.deleted_at, excluded.deleted_at
      );
  end if;

  delete from public.booking_addons as ba
  where ba.id = p_addon_id and ba.tenant_id = p_tenant_id;
  update public.bookings as b set
    final_price = greatest(b.final_price - v_addon.applied_amount, 0),
    duration_minutes = b.duration_minutes - v_addon.applied_minutes,
    end_at = b.end_at - make_interval(mins => v_addon.applied_minutes)
  where b.id = p_booking_id and b.tenant_id = p_tenant_id
  returning b.final_price, b.duration_minutes, b.end_at
  into final_price, duration_minutes, end_at;
  return next;
end $$;

-- Claim before calling LINE.  Every branch returns exactly one row.  In
-- particular, RETURN NEXT alone is not terminal in PL/pgSQL.
create or replace function public.claim_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (claimed boolean, notified text)
language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
  v_claim_notified text;
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  update public.booking_addons as ba
  set notified = 'PENDING'
  where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id
    and ba.notified = 'NONE'
  returning ba.notified into v_claim_notified;
  if found then
    claimed := true;
    notified := v_claim_notified;
    return next;
    return;
  end if;

  select ba.notified into v_current from public.booking_addons as ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  claimed := false;
  notified := v_current;
  return next;
  return;
end $$;

create or replace function public.mark_booking_addon_notification_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid, p_notified text
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_current text;
begin
  if auth.role() <> 'service_role' then raise exception 'BOOKING_ADDON_FORBIDDEN'; end if;
  if p_notified not in ('LINE','NO_LINE','NOT_CONFIGURED','QUOTA_EXCEEDED','FAILED') then
    raise exception 'BOOKING_ADDON_INVALID';
  end if;
  update public.booking_addons as ba set notified = p_notified
  where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id
    and ba.notified = 'PENDING';
  if found then return; end if;

  select ba.notified into v_current from public.booking_addons as ba
    where ba.tenant_id = p_tenant_id and ba.booking_id = p_booking_id and ba.id = p_addon_id;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;
  if v_current = p_notified then return; end if;
  raise exception 'BOOKING_ADDON_NOTIFICATION_CONFLICT';
end $$;

-- A confirmed provider rejection means LINE did not accept the message.  The
-- reservation can be returned atomically; unknown refund state remains a
-- pending notification rather than being reported as a settled failure.
create or replace function public.refund_push_quota_17(
  p_tenant_id uuid, p_month text, p_count integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_used integer;
begin
  if p_count < 1 then return false; end if;
  update public.push_quota_usage as q
  set used = q.used - p_count
  where q.tenant_id = p_tenant_id and q.month = p_month and q.used >= p_count
  returning q.used into v_used;
  return found;
end $$;

revoke all on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  from public, anon, service_role;
grant execute on function public.add_booking_addon_17(uuid,uuid,uuid,text,numeric,integer,integer,text,uuid,boolean,boolean)
  to authenticated;
revoke all on function public.delete_booking_addon_17(uuid,uuid,uuid)
  from public, anon, service_role;
grant execute on function public.delete_booking_addon_17(uuid,uuid,uuid)
  to authenticated;
revoke all on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_booking_addon_notification_17(uuid,uuid,uuid)
  to service_role;
revoke all on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  from public, anon, authenticated;
grant execute on function public.mark_booking_addon_notification_17(uuid,uuid,uuid,text)
  to service_role;
revoke all on function public.refund_push_quota_17(uuid,text,integer)
  from public, anon, authenticated;
grant execute on function public.refund_push_quota_17(uuid,text,integer)
  to service_role;
