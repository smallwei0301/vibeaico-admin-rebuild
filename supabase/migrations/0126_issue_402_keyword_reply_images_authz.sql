-- #402 release-safe successor for the historical keyword-reply-images fix.
--
-- 0112 intentionally remains NOT_APPLIED because it combines this AUTHZ
-- change with a bucket metadata backfill. This forward-only successor keeps
-- the security repair in its own AUTHZ release and leaves storage.buckets
-- metadata untouched. The validated POST /api/upload route continues to
-- use service_role for normal keyword-reply image writes.

drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
      'richmenu-assets', 'chat-images'
    )
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
