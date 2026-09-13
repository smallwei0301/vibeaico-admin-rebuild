-- 0019 — 補齊-12（issue #30）：回報問題的截圖上傳
--
-- 背景：14 分冊 §6.4 衍生第 2 條、§8.14（擁有者裁決「現在就補」）。
-- issue #28 ① 把全站常駐的「回報問題」modal 接真了，但截圖欄位當時只做到誠實化
-- （停用＋畫面上說明尚未建置），因為三塊都缺：bug_reports 沒有附件欄位、
-- Storage 白名單沒有可用的 bucket、/api/bug-report 契約沒有附件。本檔補前兩塊。
--
-- ---- 1) bug-report-attachments bucket：**private**（public = false）----
--
-- 為什麼不照抄 chat-images（0017，public = true）：
--   chat-images 被迫 public 的理由很具體且只適用於它——LINE 的 image message
--   只收「可外連的 HTTPS 網址」，而「LINE 什麼時候去抓那個網址」官方沒有任何
--   規格（查證紀錄：06 分冊 §8.1–8.6），所以連改成簽名 URL 都不敢做。
--   06 §8.5 照實記下了代價：**網址即權限，無身分檢查、不分租戶，外流即失守**。
--
--   回報問題的截圖沒有那個限制——只有平台端要看，沒有第三方服務要來抓圖，
--   所以走 private ＋ 由伺服器端以 service role 簽發短效簽名 URL。
--
--   而且它的敏感度**比 chat-images 更高，不是更低**：使用者是在「畫面出問題」
--   的當下按下截圖，那張圖幾乎一定包含他當時螢幕上的顧客姓名、療程紀錄或
--   訂單明細。把一個被迫接受的隱私缺口主動複製到一個沒必要公開的地方，
--   是這個專案反覆在清的那類錯誤。
--
-- ---- 2) RLS：service role 專用，且用 restrictive policy 釘死 ----
--
-- storage.objects 的 p_storage_write / p_storage_read（0008 建、0017 重建）是
-- **列舉式 bucket 白名單**。本 bucket 刻意**不加進那兩張清單**：上傳一律走
-- /api/upload（service role，requireTenant() 已把關且路徑由伺服器端組出），
-- 讀取一律走伺服器端簽發的簽名 URL，authenticated / anon 不需要、也不該有
-- 任何直接存取權。這與 bug_reports 表本身的做法一致（0012：enable RLS 但
-- 刻意無 policy = service role 專用）。
--
-- 但「不加進清單」是一個**否定式**的保護：日後任何人重建那兩條 policy 時
-- 多打一個 bucket 名字，這個 bucket 就會瞬間對全體 authenticated 開放，
-- 而且不會有任何測試或 review 訊號。所以這裡再加一條 **restrictive** policy
-- 明文擋掉：restrictive 是 AND 進去的，就算未來 p_storage_read 把本 bucket
-- 列進白名單也仍然打不開。service_role 有 BYPASSRLS，不受影響。
--
-- ---- 3) bug_reports.attachment_path：存 **storage 路徑**，不存 URL ----
--
-- 06 §8.5 第 5 條把「chat_messages 只存最終 URL、沒存 storage path，日後要
-- 清理得反解 URL」列為已知技術債。這裡不重蹈：欄位存 bucket 內路徑
-- （{tenant_id}/{uuid}.{ext}），要顯示時由伺服器端現簽一個短效 URL。
-- private bucket 的簽名 URL 本來就會過期，存 URL 只會存出一堆死連結。
-- 預設空字串＝沒附截圖（既有列與不附圖的新回報都是這個值），不用 null，
-- 與同表的 page_url / contact_email 一致。

insert into storage.buckets (id, name, public) values
  ('bug-report-attachments', 'bug-report-attachments', false)
on conflict (id) do nothing;

drop policy if exists p_storage_bug_report_attachments_service_role_only on storage.objects;
create policy p_storage_bug_report_attachments_service_role_only on storage.objects
  as restrictive for all to public
  using (bucket_id is distinct from 'bug-report-attachments')
  with check (bucket_id is distinct from 'bug-report-attachments');

alter table bug_reports add column if not exists attachment_path text not null default '';
