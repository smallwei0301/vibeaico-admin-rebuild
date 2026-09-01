-- Issue #15 forward repair:
-- Reconcile the locked catalog position counter with live tenant maxima
-- before allocating. Reorders and test fixtures can change the maxima after
-- 0062 initializes the counter; allocation must not return a duplicate rank.
-- Do not edit the already-applied 0062 or 0063 migrations.

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
    insert into public.catalog_position_counters (
      tenant_id, resource, next_sort_order, next_line_sort_order
    )
    select
      p_tenant_id,
      p_resource,
      coalesce(max(s.sort_order), -1) + 1,
      coalesce(max(s.line_sort_order), -1) + 1
      from public.services as s
     where s.tenant_id = p_tenant_id
    on conflict (tenant_id, resource) do nothing;
  elsif p_resource = 'products' then
    insert into public.catalog_position_counters (
      tenant_id, resource, next_sort_order, next_line_sort_order
    )
    select
      p_tenant_id,
      p_resource,
      coalesce(max(p.sort_order), -1) + 1,
      coalesce(max(p.line_sort_order), -1) + 1
      from public.products as p
     where p.tenant_id = p_tenant_id
    on conflict (tenant_id, resource) do nothing;
  else
    insert into public.catalog_position_counters (
      tenant_id, resource, next_sort_order, next_line_sort_order
    )
    select
      p_tenant_id,
      p_resource,
      coalesce(max(pf.sort_order), -1) + 1,
      coalesce(max(pf.line_sort_order), -1) + 1
      from public.portfolios as pf
     where pf.tenant_id = p_tenant_id
    on conflict (tenant_id, resource) do nothing;
  end if;

  select c.next_sort_order, c.next_line_sort_order
    into next_public, next_line
    from public.catalog_position_counters as c
   where c.tenant_id = p_tenant_id
     and c.resource = p_resource
   for update;

  if p_resource = 'services' then
    select
      greatest(next_public, coalesce(max(s.sort_order), -1) + 1),
      greatest(next_line, coalesce(max(s.line_sort_order), -1) + 1)
      into next_public, next_line
      from public.services as s
     where s.tenant_id = p_tenant_id;
  elsif p_resource = 'products' then
    select
      greatest(next_public, coalesce(max(p.sort_order), -1) + 1),
      greatest(next_line, coalesce(max(p.line_sort_order), -1) + 1)
      into next_public, next_line
      from public.products as p
     where p.tenant_id = p_tenant_id;
  else
    select
      greatest(next_public, coalesce(max(pf.sort_order), -1) + 1),
      greatest(next_line, coalesce(max(pf.line_sort_order), -1) + 1)
      into next_public, next_line
      from public.portfolios as pf
     where pf.tenant_id = p_tenant_id;
  end if;

  update public.catalog_position_counters as c
     set next_sort_order = next_public + 1,
         next_line_sort_order = next_line + 1
   where c.tenant_id = p_tenant_id
     and c.resource = p_resource;

  return query select next_public, next_line;
end;
$$;

revoke all on function public.reserve_catalog_positions(uuid, text)
  from public, anon;
grant execute on function public.reserve_catalog_positions(uuid, text)
  to authenticated, service_role;
