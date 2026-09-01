-- 0039 — Issue #50: dedicated keyword-reply image bucket and cleanup queue.
--
-- This is source-only until the Owner authorizes a TEST/Production rollout.
-- The bucket is public because LINE must fetch both URLs directly; writes and
-- all persisted references remain tenant-scoped and server-validated.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('keyword-reply-images', 'keyword-reply-images', true, 5242880,
    array['image/jpeg', 'image/png']::text[])
on conflict (id) do update set
  name = excluded.name,
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Keep the current-main bucket set and add only the new bucket. Later bucket
-- migrations must extend this allow-list when they introduce another bucket.
drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images', 'product-images', 'portfolio-images', 'staff-avatars',
      'richmenu-assets', 'keyword-reply-images')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images', 'product-images', 'portfolio-images', 'staff-avatars',
    'richmenu-assets', 'keyword-reply-images')
);

create table if not exists public.keyword_reply_image_cleanup (
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  bucket          text not null check (bucket = 'keyword-reply-images'),
  path            text not null,
  attempts        integer not null default 0,
  last_error      text not null default '',
  last_attempt_at timestamptz,
  created_at      timestamptz not null default now(),
  primary key (bucket, path)
);

alter table public.keyword_reply_image_cleanup enable row level security;
revoke all on table public.keyword_reply_image_cleanup from anon, authenticated;

-- Existing rows with only a bare imageUrl are intentionally not backfilled:
-- an arbitrary public URL is not evidence of a tenant-owned Storage object.
