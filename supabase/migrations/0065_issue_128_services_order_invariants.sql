-- Issue #128: keep the services public and LINE ordering lanes distinct and
-- unique.  The live TEST project already carries these objects through the
-- historical catalog migrations; this forward-safe source migration also makes
-- a fresh local runner enforce the same service invariant.

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
