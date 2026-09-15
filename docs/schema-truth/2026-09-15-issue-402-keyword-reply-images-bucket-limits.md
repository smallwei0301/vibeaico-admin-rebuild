# TEST 的 `keyword-reply-images` bucket 有超出 canonical 的限制值（2026-09-15）

## 一句話

TEST（`nmwhwngojosmagjuvxol`）的 `storage.buckets` 中 `keyword-reply-images` 這筆資料
已設定 `file_size_limit=5242880` 和 `allowed_mime_types={image/jpeg,image/png}`，但
**canonical migration 並沒有建立這些設定值**。migration `0086` 只執行 `insert into
storage.buckets (id, name, public)` 而且在檔頭明確說明不設任何 policy；後來的 `0112`
才補上這些限制，而且改為允許 webp，並移除 authenticated 直寫。

## 三邊查證

| 來源 | 檔案 | 狀態 |
|---|---|---|
| canonical `origin/main` | `supabase/migrations/0086_keyword_reply_images_bucket.sql` | 只 insert bucket，不設 `file_size_limit` 或 `allowed_mime_types`；檔頭說明：「does not set any policy」 |
| canonical `origin/main` | `supabase/migrations/0112_keyword_reply_images_upload_acl.sql` | **設定** `file_size_limit=5242880`、`allowed_mime_types={image/jpeg,image/png,image/webp}`、移除 authenticated 直寫 |
| TEST（`nmwhwngojosmagjuvxol`） | `storage.buckets` 的 `keyword-reply-images` row | **已有** `file_size_limit=5242880` 和 `allowed_mime_types={image/jpeg,image/png}` |
| Production（`egehnijjpgijmccagxac`） | `storage.buckets` | 無 `keyword-reply-images` bucket |

TEST 有超出 canonical 的設定；Production 還沒套用 0112，連 bucket 都沒有限制值。

## 為什麼是漂移，不是正常狀態

- `0086` 明確不設 policy，只做最小化建立（id、name、public）。
- TEST 上卻已經有 `file_size_limit` 和 `allowed_mime_types`。
- 這些值沒有出處：`supabase/migrations/` 沒有、overlay 沒有。
- 如果 TEST 是純正常安裝路徑的產物，不應該有這些欄位。
- 推測：TEST 上後來手工設定或由某個已刪除的 migration 遺留，或由開發環境人工調整。

## 正確狀態由 0112 定義

`0112` 已合併進 `main`，現在定義了 `keyword-reply-images` bucket 的標準樣子：
- `file_size_limit=5242880`（5 MB）
- `allowed_mime_types={image/jpeg,image/png,image/webp}`（包含 webp，比 TEST 現狀多一個）
- 移除 authenticated 直寫 ACL

## 現況與後續

| 環境 | 現狀 | 0112 套用前 |
|---|---|---|
| TEST | 有 bucket、有 `file_size_limit`/`allowed_mime_types`（不含 webp） | 待套用；套用後會新增 webp 支援 |
| Production | 無 bucket、無任何限制 | 待套用；套用才會有完整 bucket 與限制 |

0112 尚未套用到任何遠端環境，需要 Owner 授權後才能執行（Production DDL 規範）。

## Issue 參考

Issue #402：完整漂移盤點與根因分析。

---

## 附註

本文件單純記錄漂移事實：TEST 的設定值超出 canonical source 的內容。不涉及環境修復、
不做任何 DDL、不改變 0086 或 0112 的內容。待 0112 套用時，這份文件可轉為歷史紀錄。
