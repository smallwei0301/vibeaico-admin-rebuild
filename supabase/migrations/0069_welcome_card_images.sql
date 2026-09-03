-- #28⑥ — tenant-scoped welcome card image storage.
-- The settings row stores the public URL; this migration only provisions the
-- public bucket and keeps direct authenticated storage access tenant-scoped.
insert into storage.buckets (id, name, public) values
  ('welcome-card-images', 'welcome-card-images', true)
on conflict (id) do nothing;

-- Keep the existing buckets and historical chat-images bucket available while
-- adding the new product bucket. Welcome-card images are manager-owned just
-- like the tenant_settings row; other historical buckets remain member-writable.
drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    (
      bucket_id = 'welcome-card-images'
      and tenant_role_at_least((storage.foldername(name))[1]::uuid, 'MANAGER')
    )
    or (
      bucket_id in (
        'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
        'richmenu-assets', 'chat-images'
      )
      and is_tenant_member((storage.foldername(name))[1]::uuid)
    )
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in (
    'service-images', 'product-images', 'portfolio-images', 'staff-avatars',
    'richmenu-assets', 'chat-images', 'welcome-card-images'
  )
);
