-- 0128 — 建立 chat-images bucket（issue #15：LINE chat 真的能傳送圖片）
--
-- `0126_issue_402_keyword_reply_images_authz.sql` 的 `p_storage_write` 政策已經把
-- 'chat-images' 列進允許清單，但那只是「政策提到這個 bucket」——跟 0086 那次一模
-- 一樣的陷阱（政策白名單引用一個從未被建立的 bucket，Postgres 不會抱怨，因為
-- `bucket_id in (...)` 只是字串比對）：本檔之前，storage.buckets 裡根本沒有
-- 'chat-images' 這一列，從 0001 全新建庫會讓 /tenant/chat 選圖上傳直接 500。
--
-- bucket 屬性與其他 LINE 可讀圖片 bucket 一致：public（LINE image message 的
-- originalContentUrl / previewImageUrl 必須是外部可直接抓取的 HTTPS URL），
-- 租戶隔離由 `/api/upload` 以伺服器端組出的 `{tenantId}/...` 路徑前綴 ＋既有的
-- storage RLS（`p_storage_write` 的 `is_tenant_member((storage.foldername(name))[1]::uuid)`）
-- 提供。本檔只建 bucket，不動任何政策——0126 早就涵蓋它。
--
-- 依 schema-staged-release 閘門與今日 #42（PR #627）已驗證過的慣例，這支 migration
-- 拆成獨立 PR，不與同批的 runtime 變更（/api/upload、/api/chat/messages、
-- SupportChatWidget）混在同一個 PR。

insert into storage.buckets (id, name, public) values
  ('chat-images', 'chat-images', true)
on conflict (id) do nothing;
