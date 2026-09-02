-- Issue #15 forward repair:
--   * make chat push receipts idempotent and observable;
--   * refund a quota reservation when LINE rejects a push;
--   * make MAX+1 catalog creates retryable under a database uniqueness guard.
--
-- This migration is intentionally forward-only.  Existing chat rows are legacy
-- SENT rows; only new OUT rows may carry an idempotency key.

alter table public.chat_messages
  add column if not exists idempotency_key uuid;

alter table public.chat_messages
  add column if not exists delivery_status text not null default 'SENT';

do $$
begin
  alter table public.chat_messages
    add constraint chat_messages_delivery_status_check
    check (delivery_status in ('PENDING', 'SENT', 'FAILED'));
exception
  when duplicate_object then null;
end;
$$;

create unique index if not exists chat_messages_out_idempotency_uq
  on public.chat_messages (tenant_id, line_user_id, idempotency_key)
  where direction = 'OUT' and idempotency_key is not null;

-- A failed push has already reserved one unit.  Decrement only an existing row
-- with enough usage, and serialize it with the row update; never create a row
-- or let usage become negative.
create or replace function public.refund_push_quota(
  p_tenant_id uuid,
  p_month text,
  p_count integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  refunded boolean := false;
begin
  if p_tenant_id is null
    or p_month is null
    or p_month !~ '^[0-9]{4}-[0-9]{2}$'
    or p_count <= 0 then
    raise exception 'invalid push quota refund arguments';
  end if;

  update public.push_quota_usage
     set used = used - p_count
   where tenant_id = p_tenant_id
     and month = p_month
     and used >= p_count
  returning true into refunded;

  return refunded;
end;
$$;

revoke all on function public.refund_push_quota(uuid, text, integer)
  from public, anon, authenticated;
grant execute on function public.refund_push_quota(uuid, text, integer)
  to service_role;

-- Normalize legacy duplicate ranks before installing the uniqueness guards.
with ranked as (
  select id, row_number() over (partition by tenant_id order by sort_order, id)::integer - 1 as rank
  from public.services
)
update public.services item set sort_order = ranked.rank
from ranked where item.id = ranked.id;

with ranked as (
  select id, row_number() over (partition by tenant_id order by line_sort_order, id)::integer - 1 as rank
  from public.services
)
update public.services item set line_sort_order = ranked.rank
from ranked where item.id = ranked.id;

with ranked as (
  select id, row_number() over (partition by tenant_id order by sort_order, id)::integer - 1 as rank
  from public.products
)
update public.products item set sort_order = ranked.rank
from ranked where item.id = ranked.id;

with ranked as (
  select id, row_number() over (partition by tenant_id order by line_sort_order, id)::integer - 1 as rank
  from public.products
)
update public.products item set line_sort_order = ranked.rank
from ranked where item.id = ranked.id;

with ranked as (
  select id, row_number() over (partition by tenant_id order by sort_order, id)::integer - 1 as rank
  from public.portfolios
)
update public.portfolios item set sort_order = ranked.rank
from ranked where item.id = ranked.id;

with ranked as (
  select id, row_number() over (partition by tenant_id order by line_sort_order, id)::integer - 1 as rank
  from public.portfolios
)
update public.portfolios item set line_sort_order = ranked.rank
from ranked where item.id = ranked.id;

create unique index if not exists services_tenant_sort_order_uq
  on public.services (tenant_id, sort_order);
create unique index if not exists services_tenant_line_sort_order_uq
  on public.services (tenant_id, line_sort_order);
create unique index if not exists products_tenant_sort_order_uq
  on public.products (tenant_id, sort_order);
create unique index if not exists products_tenant_line_sort_order_uq
  on public.products (tenant_id, line_sort_order);
create unique index if not exists portfolios_tenant_sort_order_uq
  on public.portfolios (tenant_id, sort_order);
create unique index if not exists portfolios_tenant_line_sort_order_uq
  on public.portfolios (tenant_id, line_sort_order);

-- The uniqueness guards make MAX+1 collisions visible to the bounded retry in
-- src/server/catalog-position.ts.  Stage the existing lane outside its rank
-- range so a permutation update remains valid under immediate uniqueness.
create or replace function public.reorder_catalog_items(
  p_tenant_id uuid,
  p_resource text,
  p_lane text,
  p_ids uuid[]
)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  expected_count integer;
  submitted_count integer;
  has_missing boolean;
  target_column text;
  stage_base bigint;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'catalog reorder is not authorized' using errcode = '42501';
  end if;

  if p_resource is null
    or p_resource not in ('services', 'products', 'portfolios')
    or p_lane is null
    or p_lane not in ('public', 'line')
    or p_ids is null
    or pg_catalog.cardinality(p_ids) = 0
    or pg_catalog.cardinality(p_ids) > 500 then
    raise exception 'invalid catalog reorder arguments' using errcode = '22023';
  end if;

  target_column := case p_lane when 'public' then 'sort_order' else 'line_sort_order' end;

  select pg_catalog.count(*)::integer
    into submitted_count
    from (
      select distinct submitted.id
      from pg_catalog.unnest(p_ids) as submitted(id)
    ) unique_ids;

  execute pg_catalog.format(
    'select pg_catalog.count(*)::integer from public.%I where tenant_id = $1',
    p_resource
  ) into expected_count using p_tenant_id;

  if submitted_count <> expected_count
    or pg_catalog.cardinality(p_ids) <> expected_count then
    raise exception 'catalog reorder must include the complete tenant collection'
      using errcode = '22023';
  end if;

  execute pg_catalog.format(
    'select exists (
       select 1
       from pg_catalog.unnest($1::uuid[]) as submitted(id)
       left join public.%I item
         on item.id = submitted.id and item.tenant_id = $2
       where item.id is null
     )',
    p_resource
  ) into has_missing using p_ids, p_tenant_id;

  if has_missing then
    raise exception 'catalog reorder contains an unknown tenant item'
      using errcode = '22023';
  end if;

  execute pg_catalog.format(
    'select greatest(coalesce(max(%I), -1), $2)::bigint + $2 + 1
       from public.%I where tenant_id = $1',
    target_column, p_resource
  ) into stage_base using p_tenant_id, expected_count;

  execute pg_catalog.format(
    'with staged as (
       select id, ($2 + row_number() over (order by id))::integer as rank
       from public.%I where tenant_id = $1
     )
     update public.%I as item
        set %I = staged.rank
       from staged
      where item.id = staged.id and item.tenant_id = $1',
    p_resource, p_resource, target_column
  ) using p_tenant_id, stage_base;

  execute pg_catalog.format(
    'update public.%I as item
        set %I = ranked.ordinal::integer - 1
       from pg_catalog.unnest($1::uuid[]) with ordinality as ranked(id, ordinal)
      where item.id = ranked.id and item.tenant_id = $2',
    p_resource,
    target_column
  ) using p_ids, p_tenant_id;
end;
$$;

revoke all on function public.reorder_catalog_items(uuid, text, text, uuid[])
  from public, anon, authenticated;
grant execute on function public.reorder_catalog_items(uuid, text, text, uuid[])
  to authenticated, service_role;
