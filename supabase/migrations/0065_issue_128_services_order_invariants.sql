-- Issue #128: keep the services public and LINE ordering lanes distinct and
-- unique.  The live TEST project already carries these objects through the
-- historical catalog migrations; this forward-safe source migration also makes
-- a fresh local runner enforce the same service invariant.

create table if not exists public.catalog_position_counters (
  tenant_id            uuid not null references public.tenants(id) on delete cascade,
  resource             text not null check (resource in ('services', 'products', 'portfolios')),
  next_sort_order      integer not null check (next_sort_order >= 0),
  next_line_sort_order integer not null check (next_line_sort_order >= 0),
  primary key (tenant_id, resource)
);

alter table public.services
  add column if not exists line_sort_order integer not null default 0;

-- Preserve relative order while making legacy rows safe for unique indexes.
with ranked as (
  select id,
         (-1000000000 - row_number() over (
           partition by tenant_id order by sort_order, id
         ))::integer as rank
    from public.services
)
update public.services as item
   set sort_order = ranked.rank
  from ranked
 where item.id = ranked.id;

with ranked as (
  select id,
         (-1000000000 - row_number() over (
           partition by tenant_id order by line_sort_order, sort_order, id
         ))::integer as rank
    from public.services
)
update public.services as item
   set line_sort_order = ranked.rank
  from ranked
 where item.id = ranked.id;

with ranked as (
  select id,
         (row_number() over (
           partition by tenant_id order by sort_order, id
         ) - 1)::integer as rank
    from public.services
)
update public.services as item
   set sort_order = ranked.rank
  from ranked
 where item.id = ranked.id;

with ranked as (
  select id,
         (row_number() over (
           partition by tenant_id order by line_sort_order, sort_order, id
         ) - 1)::integer as rank
    from public.services
)
update public.services as item
   set line_sort_order = ranked.rank
  from ranked
 where item.id = ranked.id;

create unique index if not exists services_tenant_sort_order_uq
  on public.services (tenant_id, sort_order);

create unique index if not exists services_tenant_line_sort_order_uq
  on public.services (tenant_id, line_sort_order);

-- The canonical TEST migration history already provides these functions.  A
-- fresh local runner has only the compact source migrations plus the
-- explicitly staged historical overlay, so define the service-capable shape
-- only when the canonical function is not already present.  This keeps the
-- source migration forward-safe without replacing the live generic catalog
-- functions with a narrower implementation.
do $issue128$
begin
  if to_regprocedure('public.reserve_catalog_positions(uuid,text)') is null then
    execute $fn$
      create function public.reserve_catalog_positions(
        p_tenant_id uuid,
        p_resource text
      )
      returns table(sort_order integer, line_sort_order integer)
      language plpgsql
      security definer
      set search_path to ''
      as $function$
      declare
        next_public integer;
        next_line integer;
      begin
        if p_tenant_id is null or p_resource is distinct from 'services' then
          raise exception 'invalid catalog position arguments' using errcode = '22023';
        end if;
        if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
          raise exception 'catalog position allocation is not authorized' using errcode = '42501';
        end if;

        insert into public.catalog_position_counters (
          tenant_id, resource, next_sort_order, next_line_sort_order
        )
        select
          p_tenant_id,
          'services',
          coalesce(max(s.sort_order), -1) + 1,
          coalesce(max(s.line_sort_order), -1) + 1
          from public.services as s
         where s.tenant_id = p_tenant_id
        on conflict (tenant_id, resource) do nothing;

        select c.next_sort_order, c.next_line_sort_order
          into next_public, next_line
          from public.catalog_position_counters as c
         where c.tenant_id = p_tenant_id
           and c.resource = 'services'
         for update;

        select
          greatest(next_public, coalesce(max(s.sort_order), -1) + 1),
          greatest(next_line, coalesce(max(s.line_sort_order), -1) + 1)
          into next_public, next_line
          from public.services as s
         where s.tenant_id = p_tenant_id;

        update public.catalog_position_counters as c
           set next_sort_order = next_public + 1,
               next_line_sort_order = next_line + 1
         where c.tenant_id = p_tenant_id
           and c.resource = 'services';

        return query select next_public, next_line;
      end;
      $function$;
    $fn$;
  end if;
end;
$issue128$;

grant execute on function public.reserve_catalog_positions(uuid, text)
  to authenticated, service_role;

do $issue128$
begin
  if to_regprocedure('public.reorder_catalog_items(uuid,text,text,uuid[])') is null then
    execute $fn$
      create function public.reorder_catalog_items(
        p_tenant_id uuid,
        p_resource text,
        p_lane text,
        p_ids uuid[]
      )
      returns void
      language plpgsql
      set search_path to ''
      as $function$
      declare
        expected_count integer;
        submitted_count integer;
        has_missing boolean;
        stage_base bigint;
      begin
        if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
          raise exception 'catalog reorder is not authorized' using errcode = '42501';
        end if;

        if p_resource is distinct from 'services'
          or p_lane is distinct from 'public'
          or p_ids is null
          or pg_catalog.cardinality(p_ids) = 0
          or pg_catalog.cardinality(p_ids) > 500 then
          raise exception 'invalid catalog reorder arguments' using errcode = '22023';
        end if;

        select pg_catalog.count(*)::integer
          into submitted_count
          from (
            select distinct submitted.id
            from pg_catalog.unnest(p_ids) as submitted(id)
          ) unique_ids;

        select pg_catalog.count(*)::integer
          into expected_count
          from public.services
         where tenant_id = p_tenant_id;

        if submitted_count <> expected_count
          or pg_catalog.cardinality(p_ids) <> expected_count then
          raise exception 'catalog reorder must include the complete tenant collection'
            using errcode = '22023';
        end if;

        select exists (
          select 1
            from pg_catalog.unnest(p_ids) as submitted(id)
            left join public.services as item
              on item.id = submitted.id and item.tenant_id = p_tenant_id
           where item.id is null
        ) into has_missing;

        if has_missing then
          raise exception 'catalog reorder contains an unknown tenant item'
            using errcode = '22023';
        end if;

        select greatest(coalesce(max(sort_order), -1), expected_count)::bigint
               + expected_count + 1
          into stage_base
          from public.services
         where tenant_id = p_tenant_id;

        with staged as (
          select id, (stage_base + row_number() over (order by id))::integer as rank
            from public.services
           where tenant_id = p_tenant_id
        )
        update public.services as item
           set sort_order = staged.rank
          from staged
         where item.id = staged.id and item.tenant_id = p_tenant_id;

        update public.services as item
           set sort_order = ranked.ordinal::integer - 1
          from pg_catalog.unnest(p_ids) with ordinality as ranked(id, ordinal)
         where item.id = ranked.id and item.tenant_id = p_tenant_id;
      end;
      $function$;
    $fn$;
  end if;
end;
$issue128$;

grant execute on function public.reorder_catalog_items(uuid, text, text, uuid[])
  to authenticated, service_role;
