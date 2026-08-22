-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0008（逐字轉錄，不可自行更動）
insert into storage.buckets (id, name, public) values
  ('service-images',  'service-images',  true),
  ('product-images',  'product-images',  true),
  ('portfolio-images','portfolio-images',true),
  ('staff-avatars',   'staff-avatars',   true),
  ('richmenu-assets', 'richmenu-assets', true)
on conflict (id) do nothing;

-- 上傳規則：路徑第一段必須是自己所屬租戶的 id（{tenant_id}/{filename}）
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets')
);
