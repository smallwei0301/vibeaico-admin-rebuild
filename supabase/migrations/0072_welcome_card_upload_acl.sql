-- #152 — welcome-card uploads must go through the validated server endpoint.
-- 0069 already reached TEST, so close the direct authenticated Storage side
-- door with a forward-only migration instead of rewriting applied history.

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
 where id = 'welcome-card-images';

-- The application POST /api/upload performs role, MIME, size, random-path and
-- tenant checks before using service_role. Authenticated clients therefore do
-- not need a direct INSERT policy for this public bucket.
drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
      'richmenu-assets', 'chat-images'
    )
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
