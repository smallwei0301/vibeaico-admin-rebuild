-- Issue #15：filtered catalog reorder 必須以完整 tenant 集合一次提交。
--
-- API 只傳送目前租戶完整的 id permutation。這個 function 在同一個資料庫
-- transaction 內驗證角色、集合完整性與 duplicate，再用一個 UPDATE 寫入指定 lane；
-- 缺列、跨租戶 id、重複 id 或任一驗證失敗都不會留下部分排序。
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
