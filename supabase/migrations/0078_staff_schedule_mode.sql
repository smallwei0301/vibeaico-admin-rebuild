-- #7 — 排班模式（週排班／逐日排班）改為 per-員工屬性，Owner 裁示（2026-09-04）
-- 欄位加在 staff 表本身，不是另開一張表。
--
-- 查證（Sol/Terra，2026-09-04，唯讀，未連線 Production）：PROD staff 表實際欄位為
-- id, tenant_id, name, phone, email, title, avatar_url, bookable, active,
-- sort_order, created_at, updated_at —— schedule_mode 目前不存在，是真的新欄位，
-- 不是本專案先前三次發生過的 schema drift no-op。
--
-- 是否需要重建相依 view：唯一引用 staff 的 view 是 bookings_view，其寫法是
-- `st.name AS staff_name`（明確欄位清單），不是 `select st.*`，因此對 staff 加欄位
-- 不會改變 bookings_view 的輸出欄位，**不需要**重建它。
-- （對照 0076/customers_view：customers_view 用 `select c.*` 讓輸出欄位跟著來源表走，
-- 加欄位才需要重建那個 view；staff/bookings_view 不是這種情況。）
--
-- 冪等寫法（本專案已發生三次 schema drift，任何環境重跑都必須是 no-op-safe）：
-- add column if not exists；check 約束以 do $$ … exception when duplicate_object
-- 包裹。
--
-- 值域：前端 ScheduleMode 型別（src/app/tenant/shifts/page.tsx）只有兩個值：
-- 'FIXED_REST'（週排班）／'ROTATING'（逐日排班，預設）。

alter table public.staff
  add column if not exists schedule_mode text not null default 'ROTATING';

do $$
begin
  alter table public.staff add constraint staff_schedule_mode_chk
    check (schedule_mode = any (array['FIXED_REST'::text, 'ROTATING'::text]));
exception when duplicate_object then null;
end $$;
