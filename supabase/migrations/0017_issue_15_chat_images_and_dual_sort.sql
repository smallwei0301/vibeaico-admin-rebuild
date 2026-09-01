-- Issue #15：聊天圖片儲存與公開頁／LINE 精選雙排序。
--
-- sort_order 保留作公開頁排序；line_sort_order 獨立保存 LINE 精選排序。
-- chat-images 是聊天歷史附件專用的 public bucket，不能和會被刪除的
-- keyword-reply 圖片共用生命週期。

insert into storage.buckets (id, name, public) values
  ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

-- 推播額度必須在資料庫內一次完成「存在則加、未超過上限才成功」。
-- route 層的 select → upsert 會在兩個同時請求間超賣額度。
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

  -- Do not create an over-quota row when a caller supplies a smaller quota.
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

revoke all on function public.consume_push_quota(uuid, text, integer, integer) from public;
revoke all on function public.consume_push_quota(uuid, text, integer, integer) from anon, authenticated;
grant execute on function public.consume_push_quota(uuid, text, integer, integer) to service_role;

drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'service-images','product-images','portfolio-images','staff-avatars',
      'richmenu-assets','chat-images','welcome-card-images','keyword-reply-images'
    )
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in (
    'service-images','product-images','portfolio-images','staff-avatars',
    'richmenu-assets','chat-images','welcome-card-images','keyword-reply-images'
  )
);

alter table services add column if not exists line_sort_order int not null default 0;
alter table products add column if not exists line_sort_order int not null default 0;
alter table portfolios add column if not exists line_sort_order int not null default 0;

update services set line_sort_order = sort_order where line_sort_order = 0;
update products set line_sort_order = sort_order where line_sort_order = 0;
update portfolios set line_sort_order = sort_order where line_sort_order = 0;
