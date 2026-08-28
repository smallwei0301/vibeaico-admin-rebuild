-- 0037 — #40 Reliable notification delivery (17-NOTIFICATION-DELIVERY.md)
--
-- This migration is source-only until an explicitly authorised TEST rollout.
-- It stores no provider secret, payment credential, or full delivery payload.
-- Notification events are written by the booking trigger in the same database
-- transaction as the business write; dispatch happens only after commit.

create table notification_outbox (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid references tenants(id) on delete cascade,
  event_name       text not null check (event_name ~ '^[A-Z][A-Z0-9_]{2,95}$'),
  aggregate_type   text not null check (aggregate_type ~ '^[A-Z][A-Z0-9_]{2,63}$'),
  aggregate_id     text not null,
  idempotency_key  text not null,
  payload          jsonb not null default '{}'::jsonb,
  status           text not null default 'OPEN' check (status in ('OPEN', 'COMPLETE', 'DEAD')),
  created_at       timestamptz not null default now(),
  completed_at     timestamptz
);
create unique index notification_outbox_idempotency
  on notification_outbox (event_name, aggregate_type, aggregate_id, idempotency_key);
create index notification_outbox_open_idx
  on notification_outbox (created_at)
  where status = 'OPEN';

create table notification_deliveries (
  id                  uuid primary key default gen_random_uuid(),
  outbox_id           uuid not null references notification_outbox(id) on delete cascade,
  tenant_id           uuid references tenants(id) on delete cascade,
  recipient_type      text not null check (recipient_type in ('TRAVELER', 'GUIDE', 'TENANT_OWNER', 'STAFF', 'PLATFORM_OWNER')),
  recipient_ref       text not null,
  channel             text not null check (channel in ('EMAIL', 'TELEGRAM', 'LINE')),
  -- Logical destination only (for example TENANT_SETTINGS_BASIC_EMAIL), never a provider secret.
  destination_ref     text not null,
  status              text not null default 'PENDING'
                      check (status in ('PENDING', 'PROCESSING', 'ACCEPTED', 'DELIVERED', 'RETRY', 'DEAD', 'SKIPPED')),
  attempt_count       integer not null default 0 check (attempt_count >= 0 and attempt_count <= 5),
  next_attempt_at     timestamptz not null default now(),
  claim_token         uuid,
  processing_started_at timestamptz,
  provider_message_id text,
  last_error_code     text,
  last_error_message  text,
  last_attempt_at     timestamptz,
  accepted_at         timestamptz,
  delivered_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (outbox_id, recipient_type, recipient_ref, channel)
);
create trigger t_notification_deliveries_u before update on notification_deliveries
  for each row execute function set_updated_at();
create index notification_deliveries_claim_idx
  on notification_deliveries (next_attempt_at, created_at)
  where status in ('PENDING', 'RETRY');
create index notification_deliveries_processing_idx
  on notification_deliveries (processing_started_at)
  where status = 'PROCESSING';

create table notification_health_reports (
  id             uuid primary key default gen_random_uuid(),
  period_start   timestamptz not null,
  period_end     timestamptz not null,
  summary        jsonb not null default '{}'::jsonb,
  created_at     timestamptz not null default now(),
  check (period_end > period_start),
  unique (period_start, period_end)
);

-- A binding belongs to one subject (tenant user, staff, or platform owner),
-- not an email address. Chat id is necessary transport state; bind codes are
-- separately hashed and one-time, so their plaintext is never persisted.
create table telegram_bindings (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete cascade,
  subject_type   text not null check (subject_type in ('TENANT_USER', 'STAFF', 'PLATFORM_OWNER')),
  subject_ref    text not null,
  chat_id        bigint not null,
  active         boolean not null default true,
  invalid_reason text,
  bound_at       timestamptz not null default now(),
  invalidated_at timestamptz,
  updated_at     timestamptz not null default now(),
  unique (subject_type, subject_ref),
  unique (chat_id)
);
create trigger t_telegram_bindings_u before update on telegram_bindings
  for each row execute function set_updated_at();

create table telegram_bind_codes (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid references tenants(id) on delete cascade,
  subject_type   text not null check (subject_type in ('TENANT_USER', 'STAFF', 'PLATFORM_OWNER')),
  subject_ref    text not null,
  code_hash      bytea not null unique,
  expires_at     timestamptz not null,
  consumed_at    timestamptz,
  created_at     timestamptz not null default now()
);
create index telegram_bind_codes_pending_idx on telegram_bind_codes (expires_at)
  where consumed_at is null;

create table telegram_webhook_updates (
  bot_id       text not null,
  update_id    bigint not null,
  received_at  timestamptz not null default now(),
  primary key (bot_id, update_id)
);

-- All of these tables are service-role internal ledgers. RLS remains enabled
-- as a second safety net if Data API privileges later change.
alter table notification_outbox enable row level security;
alter table notification_deliveries enable row level security;
alter table notification_health_reports enable row level security;
alter table telegram_bindings enable row level security;
alter table telegram_bind_codes enable row level security;
alter table telegram_webhook_updates enable row level security;
revoke all on table notification_outbox, notification_deliveries, notification_health_reports,
  telegram_bindings, telegram_bind_codes, telegram_webhook_updates from anon, authenticated;

-- Internal-only primitive. It is SECURITY DEFINER because booking writes run
-- under RLS; EXECUTE is revoked from every API-facing role below.
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
set search_path = public, pg_temp
as $$
declare event_id uuid;
begin
  insert into notification_outbox (
    tenant_id, event_name, aggregate_type, aggregate_id, idempotency_key, payload
  ) values (
    p_tenant_id, p_event_name, p_aggregate_type, p_aggregate_id, p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (event_name, aggregate_type, aggregate_id, idempotency_key)
  do update set idempotency_key = excluded.idempotency_key
  returning id into event_id;
  return event_id;
end;
$$;

-- Booking events are the first migrated domain. The trigger is transactional:
-- a rolled-back booking/status change cannot leave an outbox row behind.
create or replace function public.enqueue_booking_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CREATED', 'BOOKING', new.id::text,
      'booking-created:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'CANCELLED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CANCELLED', 'BOOKING', new.id::text,
      'booking-cancelled:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  end if;
  return new;
end;
$$;
drop trigger if exists t_bookings_notification_outbox on bookings;
create trigger t_bookings_notification_outbox
  after insert or update of status on bookings
  for each row execute function public.enqueue_booking_notification_event();

-- Worker-safe claim. SKIP LOCKED means two dispatchers never receive the same
-- live row. A 10-minute lease makes a crashed worker eligible for a later retry.
create or replace function public.claim_notification_deliveries(p_limit integer default 20)
returns setof notification_deliveries
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 then
    raise exception 'p_limit must be between 1 and 100';
  end if;
  return query
  with candidates as (
    select d.id
    from notification_deliveries d
    where (d.status in ('PENDING', 'RETRY') and d.next_attempt_at <= now())
       or (d.status = 'PROCESSING' and d.processing_started_at < now() - interval '10 minutes')
    order by d.next_attempt_at, d.created_at
    for update skip locked
    limit p_limit
  )
  update notification_deliveries d
  set status = 'PROCESSING', claim_token = gen_random_uuid(), processing_started_at = now(), last_attempt_at = now()
  from candidates
  where d.id = candidates.id
  returning d.*;
end;
$$;

create or replace function public.refresh_notification_outbox_status(p_outbox_id uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare next_status text;
begin
  select case
    when exists (select 1 from notification_deliveries where outbox_id = p_outbox_id and status in ('PENDING', 'PROCESSING', 'RETRY')) then 'OPEN'
    when exists (select 1 from notification_deliveries where outbox_id = p_outbox_id and status = 'DEAD') then 'DEAD'
    else 'COMPLETE'
  end into next_status;
  update notification_outbox
  set status = next_status, completed_at = case when next_status = 'OPEN' then null else now() end
  where id = p_outbox_id;
  return next_status;
end;
$$;

-- Atomically bind a one-time Telegram deep-link code and remember update_id.
create or replace function public.consume_telegram_bind_code(
  p_bot_id text,
  p_update_id bigint,
  p_code_hash bytea,
  p_chat_id bigint
) returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare bind_row telegram_bind_codes%rowtype;
begin
  insert into telegram_webhook_updates (bot_id, update_id)
  values (p_bot_id, p_update_id)
  on conflict do nothing;
  if not found then return false; end if;

  select * into bind_row from telegram_bind_codes
  where code_hash = p_code_hash and consumed_at is null and expires_at > now()
  for update;
  if not found then return false; end if;

  insert into telegram_bindings (tenant_id, subject_type, subject_ref, chat_id, active, invalid_reason, invalidated_at)
  values (bind_row.tenant_id, bind_row.subject_type, bind_row.subject_ref, p_chat_id, true, null, null)
  on conflict (subject_type, subject_ref) do update
  set chat_id = excluded.chat_id, active = true, invalid_reason = null, invalidated_at = null;
  update telegram_bind_codes set consumed_at = now() where id = bind_row.id;
  return true;
end;
$$;

revoke execute on function public.enqueue_notification_event(uuid, text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function public.enqueue_booking_notification_event() from public, anon, authenticated;
revoke execute on function public.claim_notification_deliveries(integer) from public, anon, authenticated;
revoke execute on function public.refresh_notification_outbox_status(uuid) from public, anon, authenticated;
revoke execute on function public.consume_telegram_bind_code(text, bigint, bytea, bigint) from public, anon, authenticated;
