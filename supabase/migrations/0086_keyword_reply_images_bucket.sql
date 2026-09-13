-- 0086 — 建立 keyword-reply-images bucket（issue #50）
--
-- ⚠️ 這支 migration 是被 CI 逼出來的，經過值得寫下來，因為它是一個很容易犯的
-- 推論錯誤：
--
-- `0072` / `0073` 的 `p_storage_write` 政策允許清單裡**列了** 'keyword-reply-images'，
-- 我因此推論「bucket 本來就存在，只是 /api/upload 沒收它」。**政策提到一個 bucket，
-- 不代表那個 bucket 存在。** 授權規則與物件本身是兩回事：政策可以合法地引用一個
-- 還沒被建立的 bucket，Postgres 不會抱怨，因為 `bucket_id in (...)` 只是字串比對。
--
-- 實查三個環境後才看清楚：
--
--   canonical TEST   有   ← 由一條從未併回 main 的分支 migration（0039）建的
--   正式庫           **無**
--   從 0001 全新建起  **無**  ← local-isolated 因此 500 SYS_001
--
-- 也就是說 TEST 有一個 `main` 的 source 重現不出來的物件（#197 / Schema Truth 的
-- 同型問題），而它剛好讓「bucket 已存在」這個錯誤推論在 TEST 上看起來成立。
-- 若沒有 local-isolated 從 0001 建庫這一關，這個缺陷會一路走到正式站，
-- 而且症狀是「店家選了圖，畫面顯示上傳失敗」——比原本誠實的「尚未建置」更糟。
--
-- 為什麼是 0086 而不是 0085：`0085_catalog_position_invariants.sql` 已被進行中的
-- PR #239 佔用（尚未併入 main）。PB-017 記過「先套用、後改名」的代價，這裡改為
-- 先讓編號避開已宣告的號碼，寧可留一個號碼空隙也不要撞號。
--
-- bucket 屬性與其他 LINE 可讀圖片 bucket 一致：public（LINE 必須能直接抓取），
-- 租戶隔離由 `/api/upload` 以伺服器端組出的 `{tenantId}/...` 路徑前綴 ＋ 0008 的
-- storage RLS 提供。本檔只建 bucket，不動任何政策——`p_storage_write` 早就涵蓋它。

insert into storage.buckets (id, name, public) values
  ('keyword-reply-images', 'keyword-reply-images', true)
on conflict (id) do nothing;
