-- 0043 — #40 forward-only notification security alignment
--
-- Prefixes 0040 and 0041 are already owned by #41 formation migrations.
-- Keep the #40 0038/0038a baseline immutable; this is the only place for
-- subsequent notification schema, trigger, and RPC changes.

-- The original index cannot distinguish a NULL platform scope and does not
-- include tenant_id. Refuse to silently collapse any historic NULL-scope
-- duplicates before replacing it with the tenant-aware conflict target.
do $$
begin
  if exists (
    select 1
    from public.notification_outbox
    where tenant_id is null
    group by event_name, aggregate_type, aggregate_id, idempotency_key
    having count(*) > 1
  ) then
    raise exception 'notification_outbox has duplicate platform idempotency keys; remediate before 0043';
  end if;
end;
$$;

drop index if exists public.notification_outbox_idempotency;
create unique index notification_outbox_tenant_idempotency
  on public.notification_outbox (tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key) nulls not distinct;

-- Recreate the generic internal primitive against the replacement index. A
-- tenant's idempotency namespace is isolated; NULL is one platform namespace.
create or replace function public.enqueue_notification_event(
  p_tenant_id uuid,
  p_event_name text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
begin
  insert into public.notification_outbox (
    tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    p_tenant_id, p_event_name, p_aggregate_type, p_aggregate_id, p_idempotency_key,
    coalesce(p_payload, '{}'::pg_catalog.jsonb)
  ) on conflict (tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into event_id;
  return event_id;
end;
$$;

alter table public.notification_deliveries
  add column if not exists reclaimable boolean not null default true;

create index if not exists telegram_bind_codes_tenant_id_idx
  on public.telegram_bind_codes (tenant_id);

-- 0042 replaced these trigger functions after the v2 empty-search-path
-- baseline. Reapply the hardening here without rewriting that applied file.
create or replace function public.bump_booking_notification_revision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.start_at is distinct from old.start_at
     or new.staff_id is distinct from old.staff_id then
    new.notification_revision := old.notification_revision + 1;
  end if;
  return new;
end;
$$;

create or replace function public.enqueue_booking_notification_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CREATED', 'BOOKING', new.id::text,
      'booking-created:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'CANCELLED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CANCELLED', 'BOOKING', new.id::text,
      'booking-cancelled:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_CANCELLED', 'BOOKING', new.id::text,
      'booking-line-cancelled:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'CONFIRMED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_CONFIRMED', 'BOOKING', new.id::text,
      'booking-line-confirmed:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'COMPLETED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_COMPLETED', 'BOOKING', new.id::text,
      'booking-line-completed:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'NO_SHOW' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_NO_SHOW', 'BOOKING', new.id::text,
      'booking-line-no-show:' || new.id::text, pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is not distinct from old.status and (
    new.start_at is distinct from old.start_at or new.staff_id is distinct from old.staff_id
  ) then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_MODIFIED', 'BOOKING', new.id::text,
      'booking-line-modified:' || new.id::text || ':v' || new.notification_revision::text,
      pg_catalog.jsonb_build_object('bookingId', new.id::text)
    );
  end if;
  return new;
end;
$$;

revoke execute on function public.bump_booking_notification_revision() from public, anon, authenticated;
revoke execute on function public.bump_booking_notification_revision() from service_role;
revoke execute on function public.enqueue_booking_notification_event() from public, anon, authenticated;
revoke execute on function public.enqueue_booking_notification_event() from service_role;

-- Interactive auth Email remains low-latency, but its audit row contains only
-- an app-side recipient hash. It must never be reclaimed without a destination.
create or replace function public.enqueue_auth_verification_delivery(
  p_recipient_ref text,
  p_idempotency_key text
) returns public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
        delivery public.notification_deliveries%rowtype;
begin
  insert into public.notification_outbox (
    tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    null, 'AUTH_VERIFICATION_EMAIL', 'AUTH_VERIFICATION', p_recipient_ref,
    p_idempotency_key, '{}'::pg_catalog.jsonb
  ) on conflict (tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into event_id;

  insert into public.notification_deliveries (
    outbox_id, tenant_id, recipient_type, recipient_ref, channel, destination_ref,
    status, reclaimable, processing_started_at
  ) values (
    event_id, null, 'TRAVELER', p_recipient_ref, 'EMAIL', 'AUTH_VERIFICATION_EMAIL',
    'PROCESSING', false, pg_catalog.now()
  ) on conflict (outbox_id, recipient_type, recipient_ref, channel)
  do update set status = public.notification_deliveries.status
  returning * into delivery;
  return delivery;
end;
$$;

create or replace function public.claim_notification_deliveries(p_limit integer default 20)
returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  return query
  with candidates as (
    select d.id
    from public.notification_deliveries d
    where (d.status in ('PENDING', 'RETRY') and d.next_attempt_at <= pg_catalog.now())
       or (d.status = 'PROCESSING' and d.reclaimable
           and d.processing_started_at < pg_catalog.now() - interval '10 minutes')
    order by d.next_attempt_at, d.created_at
    for update skip locked
    limit p_limit
  )
  update public.notification_deliveries d
  set status = 'PROCESSING', claim_token = pg_catalog.gen_random_uuid(),
      processing_started_at = pg_catalog.now(), last_attempt_at = pg_catalog.now()
  from candidates
  where d.id = candidates.id
  returning d.*;
end;
$$;

-- The browser may choose only among its own manager memberships. The subject
-- is always auth.uid(), not a client-supplied id, and only a code hash is kept.
create or replace function public.issue_tenant_telegram_bind_code(
  p_tenant_id uuid,
  p_code_hash bytea
) returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or not exists (
    select 1 from public.tenant_users tu
    where tu.tenant_id = p_tenant_id
      and tu.user_id = auth.uid()
      and tu.role in ('MANAGER', 'OWNER')
  ) then
    raise exception 'tenant manager required' using errcode = '42501';
  end if;

  insert into public.telegram_bind_codes (
    tenant_id, subject_type, subject_ref, code_hash, expires_at
  ) values (
    p_tenant_id, 'TENANT_USER', auth.uid()::text, p_code_hash,
    pg_catalog.now() + interval '15 minutes'
  );
end;
$$;

revoke execute on function public.enqueue_auth_verification_delivery(text, text) from public, anon, authenticated;
grant execute on function public.enqueue_auth_verification_delivery(text, text) to service_role;
revoke execute on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_deliveries(integer) to service_role;
revoke execute on function public.issue_tenant_telegram_bind_code(uuid, bytea) from public, anon, service_role;
grant execute on function public.issue_tenant_telegram_bind_code(uuid, bytea) to authenticated;

-- Cron is the only service-side caller. It can enqueue exactly one reminder
-- for a booking it proves belongs to the supplied tenant; it cannot choose an
-- arbitrary event name, aggregate, or payload through the generic primitive.
create or replace function public.enqueue_booking_line_reminder(
  p_tenant_id uuid,
  p_booking_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare event_id uuid;
begin
  if not exists (
    select 1 from public.bookings b
    where b.id = p_booking_id and b.tenant_id = p_tenant_id
  ) then
    raise exception 'booking is not in tenant' using errcode = '42501';
  end if;

  insert into public.notification_outbox (
    tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    p_tenant_id, 'BOOKING_LINE_REMINDER', 'BOOKING', p_booking_id::text,
    'booking-line-reminder:' || p_booking_id::text,
    pg_catalog.jsonb_build_object('bookingId', p_booking_id::text)
  ) on conflict (tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into event_id;
  return event_id;
end;
$$;

revoke execute on function public.enqueue_booking_line_reminder(uuid, uuid) from public, anon, authenticated;
grant execute on function public.enqueue_booking_line_reminder(uuid, uuid) to service_role;
