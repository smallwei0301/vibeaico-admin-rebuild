-- 0018 — 修復-9（issue #28 第 ① 與第 ⑨ 筆）：把「使用者填了但從未離開瀏覽器」的
-- 欄位補上落地位置。14 分冊 §7 三輪盤點的兩筆 MISMATCH。
--
-- 1) service_categories / product_categories 的 description / active
--    分類管理 modal 收「說明」（服務）與「啟用」（服務＋商品），新增後表格立刻
--    顯示，重新整理就消失——因為 0004 建的兩張表只有 id/tenant_id/name/sort_order，
--    POST 端點也只 insert name + sort_order。GET 端點甚至硬回 `active: true`
--    （product-categories/route.ts 的註解自己寫了「已回報」）。
--    這裡補上兩欄，讓端點可以誠實地存下與讀回使用者填的值。
--    既有列走 default：description=''、active=true，與先前畫面上的顯示一致
--    （先前一律顯示啟用），所以升級不會改變任何一列看起來的樣子。
--
-- 2) bug_reports 的 subject / contact_email
--    0012 建表時只有 reporter/category/content/page_url，但全站常駐的「回報問題」
--    modal 收四個欄位：類別、標題、詳細說明、聯絡信箱。標題與聯絡信箱沒有落點，
--    若不補欄位就只能塞進 content 攪成一團（等於仍然沒有逐欄保存）。
--    contact_email 與 reporter 不同：reporter 是登入者帳號（伺服器端填），
--    contact_email 是回報者自己填的回覆信箱，可能刻意留別的信箱，不得互相覆蓋。
--
-- RLS（02 分冊 §RLS 慣例）：
--   - service_categories / product_categories 的 policy（0006）是資料表層級
--     `is_tenant_member(tenant_id)`，不列舉欄位，新增欄位自動沿用，無需改 policy。
--   - bug_reports（0012）啟用 RLS 且刻意無 policy＝service role 專用，同樣無需改。

alter table service_categories add column if not exists description text not null default '';
alter table service_categories add column if not exists active boolean not null default true;

alter table product_categories add column if not exists description text not null default '';
alter table product_categories add column if not exists active boolean not null default true;

alter table bug_reports add column if not exists subject text not null default '';
alter table bug_reports add column if not exists contact_email text not null default '';
