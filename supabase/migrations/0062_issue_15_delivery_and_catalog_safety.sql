-- Issue #15 forward repair:
--   * persist quota reservations independently from the monthly counter;
--   * keep ambiguous provider/database outcomes retryable and non-refundable;
--   * allocate both catalog tails atomically before the insert.
--
-- Do not edit 0017-0020 or 0060: those migrations may already be applied.

alter table public.chat_messages
  add column if not exists request_fingerprint text,
  add column if not exists provider_attempt_status text not null default 'ACCEPTED',
  add column if not exists reservation_month text,
  add column if not exists reservation_token uuid,
  add column if not exists refund_status text not null default 'NOT_REQUIRED',
  add column if not exists image_cleanup_status text not null default 'NOT_APPLICABLE',
  add column if not exists delivery_error text;

alter table public.chat_messages drop constraint if exists chat_messages_delivery_status_check;
alter table public.chat_messages
  add constraint chat_messages_delivery_status_check
  check (delivery_status in ('PENDING', 'RETRY', 'SENT', 'FAILED'));

alter table public.chat_messages drop constraint if exists chat_messages_provider_attempt_status_check;
alter table public.chat_messages
  add constraint chat_messages_provider_attempt_status_check
  check (provider_attempt_status in ('NOT_ATTEMPTED', 'IN_FLIGHT', 'ACCEPTED', 'REJECTED', 'UNKNOWN'));

alter table public.chat_messages drop constraint if exists chat_messages_refund_status_check;
alter table public.chat_messages
  add constraint chat_messages_refund_status_check
  check (refund_status in ('NOT_REQUIRED', 'RESERVED', 'REFUNDED', 'COMMITTED', 'REFUND_PENDING', 'SETTLEMENT_PENDING'));

alter table public.chat_messages drop constraint if exists chat_messages_image_cleanup_status_check;
alter table public.chat_messages
  add constraint chat_messages_image_cleanup_status_check
  check (image_cleanup_status in ('NOT_APPLICABLE', 'RETAINED', 'PENDING', 'CLEANED', 'CLEANUP_PENDING'));

create table if not exists public.push_quota_reservations (
  token uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  chat_message_id uuid not null unique references public.chat_messages(id) on delete cascade,
  month text not null check (month ~ '^[0-9]{4}-[0-9]{2}$'),
  count integer not null check (count > 0),
  status text not null default 'RESERVED'
    check (status in ('RESERVED', 'COMMITTED', 'REFUNDED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists push_quota_reservations_tenant_month_idx
  on public.push_quota_reservations (tenant_id, month, status);

alter table public.push_quota_reservations enable row level security;
revoke all on public.push_quota_reservations from public, anon, authenticated;

-- Atomically consume the monthly counter and create its durable reservation.
create or replace function public.reserve_push_quota(
  p_tenant_id uuid,
  p_month text,
  p_count integer,
  p_quota integer,
  p_chat_message_id uuid
)
returns table(accepted boolean, reservation_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_value uuid;
begin
  if p_tenant_id is null
    or p_month is null
    or p_month !~ '^[0-9]{4}-[0-9]{2}$'
    or p_count <= 0
    or p_quota < 0
    or p_chat_message_id is null then
    raise exception 'invalid push quota reservation arguments';
  end if;

  select r.token into token_value
    from public.push_quota_reservations r
   where r.chat_message_id = p_chat_message_id
     and r.tenant_id = p_tenant_id;
  if token_value is not null then
    return query select true, token_value;
    return;
  end if;

  if p_count > p_quota then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.push_quota_usage (tenant_id, month, used)
  values (p_tenant_id, p_month, p_count)
  on conflict (tenant_id, month) do update
    set used = public.push_quota_usage.used + excluded.used
    where public.push_quota_usage.used + excluded.used <= p_quota;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.push_quota_reservations (tenant_id, chat_message_id, month, count)
  values (p_tenant_id, p_chat_message_id, p_month, p_count)
  returning token into token_value;

  return query select true, token_value;
end;
$$;

revoke all on function public.reserve_push_quota(uuid, text, integer, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.reserve_push_quota(uuid, text, integer, integer, uuid)
  to service_role;

-- Refund only this exact reservation, at its original month, and only once.
create or replace function public.refund_push_quota(
  p_tenant_id uuid,
  p_month text,
  p_count integer,
  p_reservation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  reservation public.push_quota_reservations%rowtype;
begin
  if p_tenant_id is null
    or p_month is null
    or p_month !~ '^[0-9]{4}-[0-9]{2}$'
    or p_count <= 0
    or p_reservation_token is null then
    raise exception 'invalid push quota refund arguments';
  end if;

  select * into reservation
    from public.push_quota_reservations r
   where r.token = p_reservation_token
     and r.tenant_id = p_tenant_id
   for update;

  if not found then return false; end if;
  if reservation.status = 'REFUNDED' then return true; end if;
  if reservation.status <> 'RESERVED'
    or reservation.month <> p_month
    or reservation.count <> p_count then
    return false;
  end if;

  update public.push_quota_usage
     set used = used - reservation.count
   where tenant_id = reservation.tenant_id
     and month = reservation.month
     and used >= reservation.count;
  if not found then return false; end if;

  update public.push_quota_reservations
     set status = 'REFUNDED', updated_at = now()
   where token = reservation.token;
  return true;
end;
$$;

revoke all on function public.refund_push_quota(uuid, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.refund_push_quota(uuid, text, integer, uuid)
  to service_role;

create or replace function public.commit_push_quota(
  p_tenant_id uuid,
  p_reservation_token uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  changed boolean := false;
begin
  if p_tenant_id is null or p_reservation_token is null then
    raise exception 'invalid push quota commit arguments';
  end if;

  update public.push_quota_reservations
     set status = 'COMMITTED', updated_at = now()
   where tenant_id = p_tenant_id
     and token = p_reservation_token
     and status = 'RESERVED'
  returning true into changed;

  if changed then return true; end if;
  return exists (
    select 1 from public.push_quota_reservations
     where tenant_id = p_tenant_id
       and token = p_reservation_token
       and status = 'COMMITTED'
  );
end;
$$;

revoke all on function public.commit_push_quota(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.commit_push_quota(uuid, uuid) to service_role;

-- Counters make create/duplicate allocation independent of a racy MAX+1 read.
create table if not exists public.catalog_position_counters (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  resource text not null check (resource in ('services', 'products', 'portfolios')),
  next_sort_order integer not null check (next_sort_order >= 0),
  next_line_sort_order integer not null check (next_line_sort_order >= 0),
  primary key (tenant_id, resource)
);

insert into public.catalog_position_counters (tenant_id, resource, next_sort_order, next_line_sort_order)
select tenant_id, 'services', coalesce(max(sort_order), -1) + 1, coalesce(max(line_sort_order), -1) + 1
  from public.services group by tenant_id
on conflict (tenant_id, resource) do nothing;
insert into public.catalog_position_counters (tenant_id, resource, next_sort_order, next_line_sort_order)
select tenant_id, 'products', coalesce(max(sort_order), -1) + 1, coalesce(max(line_sort_order), -1) + 1
  from public.products group by tenant_id
on conflict (tenant_id, resource) do nothing;
insert into public.catalog_position_counters (tenant_id, resource, next_sort_order, next_line_sort_order)
select tenant_id, 'portfolios', coalesce(max(sort_order), -1) + 1, coalesce(max(line_sort_order), -1) + 1
  from public.portfolios group by tenant_id
on conflict (tenant_id, resource) do nothing;

alter table public.catalog_position_counters enable row level security;
revoke all on public.catalog_position_counters from public, anon, authenticated;

create or replace function public.reserve_catalog_positions(
  p_tenant_id uuid,
  p_resource text
)
returns table(sort_order integer, line_sort_order integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  next_public integer;
  next_line integer;
begin
  if p_tenant_id is null or p_resource not in ('services', 'products', 'portfolios') then
    raise exception 'invalid catalog position arguments' using errcode = '22023';
  end if;
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'catalog position allocation is not authorized' using errcode = '42501';
  end if;

  if p_resource = 'services' then
    insert into public.catalog_position_counters
      select p_tenant_id, p_resource,
        coalesce((select max(sort_order) from public.services where tenant_id = p_tenant_id), -1) + 1,
        coalesce((select max(line_sort_order) from public.services where tenant_id = p_tenant_id), -1) + 1
    on conflict (tenant_id, resource) do nothing;
  elsif p_resource = 'products' then
    insert into public.catalog_position_counters
      select p_tenant_id, p_resource,
        coalesce((select max(sort_order) from public.products where tenant_id = p_tenant_id), -1) + 1,
        coalesce((select max(line_sort_order) from public.products where tenant_id = p_tenant_id), -1) + 1
    on conflict (tenant_id, resource) do nothing;
  else
    insert into public.catalog_position_counters
      select p_tenant_id, p_resource,
        coalesce((select max(sort_order) from public.portfolios where tenant_id = p_tenant_id), -1) + 1,
        coalesce((select max(line_sort_order) from public.portfolios where tenant_id = p_tenant_id), -1) + 1
    on conflict (tenant_id, resource) do nothing;
  end if;

  select c.next_sort_order, c.next_line_sort_order
    into next_public, next_line
    from public.catalog_position_counters c
   where c.tenant_id = p_tenant_id and c.resource = p_resource
   for update;

  update public.catalog_position_counters
     set next_sort_order = next_public + 1,
         next_line_sort_order = next_line + 1
   where tenant_id = p_tenant_id and resource = p_resource;

  return query select next_public, next_line;
end;
$$;

revoke all on function public.reserve_catalog_positions(uuid, text)
  from public, anon;
grant execute on function public.reserve_catalog_positions(uuid, text)
  to authenticated, service_role;
