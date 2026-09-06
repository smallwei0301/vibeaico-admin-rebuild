-- #152 — forward repair for environments that applied the first 0072 draft.
--
-- The original 0072 correctly removed welcome-card-images from direct
-- authenticated Storage INSERT, but rebuilt the shared allowlist without the
-- existing keyword-reply-images bucket. Fresh databases receive the corrected
-- 0072 first; already-migrated TEST environments receive this 0073 repair.
-- Keep welcome-card-images behind POST /api/upload while preserving unrelated
-- keyword-reply image behavior.

drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in (
      'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
      'richmenu-assets', 'chat-images', 'keyword-reply-images'
    )
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
