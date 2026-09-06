-- 0024 — 修復-9（issue #28 第 ⑥ 筆）：歡迎卡片圖片的上傳目的地
--
-- 背景：店家設定 → 通知設定 →「歡迎卡片圖片（自訂）」旁的「上傳圖片」鈕，
-- 原本的 onClick 整個內容就是一句成功 toast（不開檔案選擇器、不上傳、不改
-- 任何 state）。要把它接上 POST /api/upload 就得有一個目的地 bucket，而
-- 0008/0017/0019 的白名單裡沒有任何一個裝得下它：
--   service/product/portfolio/staff  —— 各自綁一種商業實體，不是店家設定
--   richmenu-assets                  —— LINE 圖文選單底圖，上限 1 MB（不同用途）
--   chat-images                      —— 顧客訊息的圖片，且會另產一張縮圖物件；
--                                       歡迎卡片圖不需要縮圖，多產一個沒人讀的物件
--   bug-report-attachments           —— private，回報問題專用
--
-- ---- public = true 的理由（與 chat-images 同一條，與 bug-report 相反）----
--
-- 歡迎卡片是顧客加好友時收到的 LINE 訊息，圖片必須是 LINE 抓得到的外連 HTTPS
-- 網址（同 06 分冊 §8）。代價與 chat-images 相同且已記在 §8.5：網址即權限。
-- 但這裡的內容是**店家自己的行銷圖**（店面照、優惠圖），不是顧客個資，
-- 敏感度與 chat-images／bug-report-attachments 不同級。
--
-- ⚠️ 誠實聲明（不要把用途讀成現況）：**目前沒有任何程式碼會把這張圖送給 LINE。**
-- src/server/line-events.ts 的 follow 事件只送 notify.welcomeMessageText 純文字，
-- 歡迎卡片（標題／圖片／功能清單）的 flex 尚未組出來。本檔只負責「圖片存得進去、
-- 網址存得回 tenant_settings」，卡片本身另案（已在 issue #28 回報）。
--
-- p_storage_write / p_storage_read 是列舉式 bucket 白名單（0008 建、0017 重建），
-- 只能整條重建 —— 這裡照 0017 的作法把新 bucket 加進去。

insert into storage.buckets (id, name, public) values
  ('welcome-card-images', 'welcome-card-images', true)
on conflict (id) do nothing;

drop policy if exists p_storage_write on storage.objects;
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets','chat-images','welcome-card-images')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );

drop policy if exists p_storage_read on storage.objects;
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets','chat-images','welcome-card-images')
);
