-- #402 — keyword-reply-images uploads must go through the validated server
-- endpoint, same shape as 0072_welcome_card_upload_acl's fix for
-- welcome-card-images. 0086 already reached TEST/prod as an unrestricted
-- public bucket that was also left in the authenticated Storage write
-- allowlist, so this closes that side door with a forward-only migration
-- instead of rewriting applied history.
--
-- Owner decision (Issue #402, 2026-09-15 comment):
--   - keyword-reply-images stays public=true (LINE needs direct HTTPS read).
--   - file_size_limit fixed at 5 MiB (5242880 bytes).
--   - allowed_mime_types: image/jpeg, image/png, image/webp.
--   - authenticated no longer gets a direct INSERT policy for this bucket;
--     remove it from the shared p_storage_write allowlist.
--   - Normal uploads keep going through POST /api/upload (service_role
--     write) — no second, direct-to-Storage upload path.
--   - Forward-only migration; local verification only. Not authorized for
--     canonical TEST or Production application in this change.

update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
 where id = 'keyword-reply-images';

-- The application POST /api/upload performs role, MIME, size, random-path and
-- tenant checks before using service_role. Authenticated clients therefore do
-- not need a direct INSERT policy for this public bucket either.
--
-- Preserve every unrelated bucket already present in the canonical policy.
drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
      'richmenu-assets', 'chat-images'
    )
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
