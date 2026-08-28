-- 0039 — Issue #50：關鍵字回覆圖片專用 bucket 與可重試的孤兒清理佇列
--
-- 不重用 richmenu-assets：它是 1MB 的 Rich Menu 底圖，且沒有「某一筆 keyword
-- reply 不再引用時刪掉素材」的生命週期。keyword reply 與 chat image 都會產獨立
-- preview，但聊天訊息要保留歷史，不能共用清理生命週期。keyword reply 素材是 LINE 要抓的店家行銷圖，
-- 因此 public=true（URL 即權限）；路徑第一段仍是 tenant id，API 另驗 object 存在。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('keyword-reply-images', 'keyword-reply-images', true, 5242880,
    array['image/jpeg','image/png']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- p_storage_write/read 是歷史列舉式 policy；重建時保留所有既有 public bucket。
drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images','product-images','portfolio-images','staff-avatars',
      'richmenu-assets','chat-images','welcome-card-images','keyword-reply-images')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images','product-images','portfolio-images','staff-avatars',
    'richmenu-assets','chat-images','welcome-card-images','keyword-reply-images')
);

-- 更新/刪除 keyword_replies 之後，若 remove 暫時失敗，留在這裡給 cron 重試；
-- 不能把錯誤吞掉成永久孤兒，也不能在 DB 更新前先刪造成仍被引用的 URL 404。
create table if not exists keyword_reply_image_cleanup (
  tenant_id uuid not null references tenants(id) on delete cascade,
  bucket text not null check (bucket = 'keyword-reply-images'),
  path text not null,
  attempts integer not null default 0,
  last_error text not null default '',
  last_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  primary key (bucket, path)
);
alter table keyword_reply_image_cleanup enable row level security;
-- service role only：店家不應能讀寫別人的 cleanup 狀態。
-- RLS 不保護 TRUNCATE；Supabase 的 public schema default privileges 可能
-- 仍給 browser roles 完整 table grant，所以必須連 table ACL 一起收掉。
revoke all on table public.keyword_reply_image_cleanup from anon, authenticated;

-- 既有 IMAGE row 只有 imageUrl，無法從任意外部 URL 安全推回本租戶 Storage object，
-- 因此不做猜測式 SQL backfill。API 保留唯讀/停用相容；重新選圖時才寫入同時包含
-- 原圖與 preview 的 imageStorageRef，之後的寫入一律驗租戶、URL 與兩個 object。
