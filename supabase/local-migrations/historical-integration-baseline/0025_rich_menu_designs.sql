-- 0025_rich_menu_designs.sql — Rich Menu 進階設計器的草稿 / 已發布 / 還原點
-- （GitHub issue #19 / 補齊-4；規格 docs/integration/06-LINE-INTEGRATION.md §6.2.1）
--
-- 原站有這一整組端點（docs/specs/rich-menu-design.json 的 jsApiCalls：
--   /api/settings/line/rich-menu/advanced-config   ← 草稿讀寫
--   /api/settings/line/rich-menu/restore-previous   ← 還原前一次發布
--   /api/settings/line/rich-menu/create-advanced|create-scene|create-custom
-- ），但 spec 只留下扁平的路徑字串、沒有資料模型，06 分冊在 issue #19 之前也只有
-- 一句「標為 Phase 6+」。所以本檔的欄位形狀＝我方設計，見 §6.2.0 第 (1) 點。
--
-- 為什麼是一張表三個 kind，而不是三張表
-- ---------------------------------------------------------------------------
-- 這三者裝的是**同一種東西**（一份 rich menu 設計），差別只在它現在扮演什麼角色。
-- 三張表會有三份幾乎相同的欄位定義，而「發布時把 PUBLISHED 搬成 RESTORE_POINT」
-- 這個動作要跨表搬——同一件事寫兩份、長期一定分岔（本專案反覆抓到的缺陷家族）。
-- 一張表加 kind，那個動作就只是一次 update。
--
-- 為什麼「保留最近 1 份」是主鍵而不是設定值
-- ---------------------------------------------------------------------------
-- 擁有者 2026-08-25 裁決 restore-previous 只支援還原到上一次發布（issue #1 裁示總表）。
-- 用 (tenant_id, kind) 當主鍵、一律 upsert，份數上限就是資料庫結構本身的性質：
-- 沒有「保留 N 份」的設定值可以被改壞，也沒有需要跑的清理排程，更不會出現
-- 「說好留 1 份、實際上留了 40 份」這種只有查 DB 才看得出來的偏差。
--
-- line_rich_menu_id 為什麼要存，明明 config 就能重建
-- ---------------------------------------------------------------------------
-- 兩者在不同情況下失效（§6.2.2）：id 讓 restore-previous 直接把**位元組完全相同**
-- 的那一張切回預設（不必重新上傳底圖）；店家若在 LINE OA Manager 手動刪過那張選單，
-- id 就失效，這時才用 config 重跑一次建立序列。只存其中一個都會有還原不了的情況。
-- 空字串＝這一份從未發布過（草稿），不是 null——與 tenant_settings.line 的既有慣例一致。

create table rich_menu_designs (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  kind              text not null check (kind in ('DRAFT', 'PUBLISHED', 'RESTORE_POINT')),
  config            jsonb not null default '{}'::jsonb,
  line_rich_menu_id text not null default '',
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, kind)
);

-- RLS：02 分冊 §0006 慣例（四條 is_tenant_member），寫法同 0023 的 owner_notify_recipients
alter table rich_menu_designs enable row level security;

create policy p_rich_menu_designs_s on rich_menu_designs
  for select using (is_tenant_member(tenant_id));
create policy p_rich_menu_designs_i on rich_menu_designs
  for insert with check (is_tenant_member(tenant_id));
create policy p_rich_menu_designs_u on rich_menu_designs
  for update using (is_tenant_member(tenant_id));
create policy p_rich_menu_designs_d on rich_menu_designs
  for delete using (is_tenant_member(tenant_id));
