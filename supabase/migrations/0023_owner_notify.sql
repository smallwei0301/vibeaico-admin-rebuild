-- 0022_owner_notify.sql — 老闆通知（owner-notify）通知名單（GitHub issue #18 / 補齊-3）
--
-- 原站有這組功能（docs/specs/dashboard.json 的 jsApiCalls：
--   /api/settings/line/owner-notify
--   /api/settings/line/owner-notify/bind
--   /api/settings/line/owner-notify/line-users
--   /api/settings/line/owner-notify/recipients/            ← 尾斜線＝路徑帶 ${id}
-- ），我方後端與 06 分冊皆零記載，故本檔為新建。契約補寫於
-- docs/integration/06-LINE-INTEGRATION.md §5.5。
--
-- ⚠️ 與 line_users → customers 的「顧客綁定」（06 §4）是兩條不同的通道：
-- 這裡的對象是**店家團隊**（老闆＋主管），顧客通道的對象是**顧客**。
-- 兩者共用同一份每月推播額度（push_quota_usage），但名單、觸發事件、文案都不同，
-- 不得合併成同一個函式（issue #18「背景與根因」）。
--
-- 資料模型為什麼是關聯表而不是 line_users 上的一個 role 欄位
-- ---------------------------------------------------------------------------
-- 規格逐字要求三件 line_users 裝不下的東西：
--   「每次通知會同時發給 ${n} 位（消耗 ${n} 則推播額度）」→ 一對多
--   「>主要</span>」                                      → 接收者上的旗標
--   「已達上限 ${_notify.maxRecipients} 位」               → 租戶層上限欄位
-- 在 line_users 加 role='OWNER' 只裝得下第一件，且會把「這個 LINE 用戶是誰」
-- 與「這個 LINE 用戶在通知名單裡的角色」兩件事混在同一列。
--
-- display_name 為什麼不存在本表
-- ---------------------------------------------------------------------------
-- 顯示名稱的唯一事實來源是 line_users.display_name（webhook 收到 follow 事件時
-- 由 GET /v2/bot/profile 寫入）。複製一份到這裡，店主在 LINE 改暱稱之後兩份就
-- 會分岔，而畫面讀的是哪一份沒有人說得準。要顯示名稱時 join 過去即可；
-- 名稱為空時由前端顯示規格的 fallback 文案「(LINE 用戶)」。

create table owner_notify_recipients (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  line_user_id text not null,
  -- 「主要」接收者：訂閱到期／儲值提醒只發給這一位（規格逐字）
  is_primary   boolean not null default false,
  created_at   timestamptz not null default now(),
  -- 同一位好友不可重複加入名單
  unique (tenant_id, line_user_id),
  -- 名單只能從「該店已加入的 LINE 好友」挑人；好友列被刪（unfollow 清理）時一併移除
  foreign key (tenant_id, line_user_id)
    references line_users (tenant_id, line_user_id) on delete cascade
);

-- 名單一律「某租戶、依加入時間」查詢（遞補主要時取最早的下一位）
create index i_owner_notify_recipients_tenant
  on owner_notify_recipients (tenant_id, created_at);

-- ★ 一租戶最多一位「主要」——由 DB 保證，不是靠應用層先查後寫。
--   應用層的「先 count 再 insert」在併發下擋不住（兩個請求都讀到 0 位主要）；
--   有了這條部分唯一索引，第二個寫入會撞 23505，由 route 轉成明確的錯誤。
create unique index u_owner_notify_recipients_primary
  on owner_notify_recipients (tenant_id) where is_primary;

-- 租戶層的人數上限（規格證明這個欄位存在：「已達上限 ${_notify.maxRecipients} 位」，
-- 由後端提供，但**規格沒有記錄它是幾**）。
--
-- 預設 3 是**我們選的數字，不是原站考據結果**（擁有者 2026-08-25 裁示，
-- issue #1 裁示總表 comment-5414180398）。理由：推播額度 200 則/月，而老闆通知
-- **每次發給 n 位就消耗 n 則**——上限直接決定額度燒速；老闆＋兩位主管是常見規模。
alter table tenants
  add column owner_notify_max_recipients int not null default 3
    check (owner_notify_max_recipients between 1 and 20);

-- 「訂閱到期／儲值提醒」的去重紀錄（cron 每日跑，同一件事不可以每天重發一次）。
--   kind='SUBSCRIPTION_EXPIRY' → ref = '<feature code>@<expires_at>'（同一張訂閱只提醒一次）
--   kind='POINTS_LOW'          → ref = 台北月份鍵 'YYYY-MM'（同一個月最多提醒一次）
create table owner_notify_reminder_log (
  tenant_id uuid not null references tenants(id) on delete cascade,
  kind      text not null check (kind in ('SUBSCRIPTION_EXPIRY', 'POINTS_LOW')),
  ref       text not null,
  sent_at   timestamptz not null default now(),
  primary key (tenant_id, kind, ref)
);

-- RLS：02 分冊 §0006 慣例（四條 is_tenant_member），寫法同 0020 的 booking_addons
alter table owner_notify_recipients enable row level security;

create policy p_owner_notify_recipients_s on owner_notify_recipients
  for select using (is_tenant_member(tenant_id));
create policy p_owner_notify_recipients_i on owner_notify_recipients
  for insert with check (is_tenant_member(tenant_id));
create policy p_owner_notify_recipients_u on owner_notify_recipients
  for update using (is_tenant_member(tenant_id));
create policy p_owner_notify_recipients_d on owner_notify_recipients
  for delete using (is_tenant_member(tenant_id));

-- 提醒去重紀錄只有平台（service role）會讀寫，比照 feature_subscriptions 的收緊寫法：
-- 開 RLS 但只給成員 select，寫入一律走 service role。
alter table owner_notify_reminder_log enable row level security;
create policy p_owner_notify_reminder_log_s on owner_notify_reminder_log
  for select using (is_tenant_member(tenant_id));
