-- 0017 — 修復-7（issue #15）：顧客訊息送圖片 + 公開頁/LINE 兩套排序各自落地
--
-- 1) chat-images bucket：/tenant/chat 的「傳送圖片」要先把檔案放到 Storage 拿到
--    公開 URL，才能用 LINE image message 的 originalContentUrl / previewImageUrl
--    推給顧客（LINE 只收 HTTPS 外連圖）。0008 的白名單沒有這個 bucket，
--    /api/upload 會擋在「不允許的 bucket」。
--    p_storage_write / p_storage_read 是列舉式 bucket 白名單，只能整條重建。
--
-- 2) line_sort_order：頁面上「公開頁排序 / LINE 精選排序」是兩套獨立順序
--    （portfolio 頁的型別早已寫成 sortOrder + lineSortOrder），但資料庫只有
--    sort_order 一欄，於是只有一套能存活。sort_order 維持＝公開頁排序
--    （對應原站 POST …/reorder），新增 line_sort_order＝LINE 精選排序
--    （對應原站 POST …/reorder-line）。預設 0；既有列一併補成 sort_order，
--    讓升級後兩套順序的起點一致，而不是全部併到 0 變成無序。

insert into storage.buckets (id, name, public) values
  ('chat-images', 'chat-images', true)
on conflict (id) do nothing;

drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets','chat-images')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets','chat-images')
);

alter table services   add column if not exists line_sort_order int not null default 0;
alter table products   add column if not exists line_sort_order int not null default 0;
alter table portfolios add column if not exists line_sort_order int not null default 0;

update services   set line_sort_order = sort_order where line_sort_order = 0;
update products   set line_sort_order = sort_order where line_sort_order = 0;
update portfolios set line_sort_order = sort_order where line_sort_order = 0;
