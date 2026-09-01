-- Issue #15 forward repair：0017/0018 可能已在環境中記錄套用，不能只修改歷史檔。
-- 重新建立同一個 atomic quota RPC，補上 quota/count/month guards，並重設 ACL。
create or replace function public.consume_push_quota(
  p_tenant_id uuid,
  p_month text,
  p_count integer,
  p_quota integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  accepted boolean := false;
begin
  if p_tenant_id is null
    or p_month is null
    or p_month !~ '^[0-9]{4}-[0-9]{2}$'
    or p_count <= 0
    or p_quota < 0 then
    raise exception 'invalid push quota arguments';
  end if;

  if p_count > p_quota then
    return false;
  end if;

  insert into public.push_quota_usage (tenant_id, month, used)
  values (p_tenant_id, p_month, p_count)
  on conflict (tenant_id, month) do update
    set used = public.push_quota_usage.used + excluded.used
    where public.push_quota_usage.used + excluded.used <= p_quota
  returning true into accepted;

  return accepted;
end;
$$;

revoke all on function public.consume_push_quota(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_push_quota(uuid, text, integer, integer)
  to service_role;
