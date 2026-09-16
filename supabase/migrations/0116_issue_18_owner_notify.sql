-- 0116 — Issue #18：LINE 老闆通知 owner-notify（通知名單＋本人認領 bind 流程）
-- ============================================================================
-- Canonical flow（Issue #18 逐字，不得走回頭路的舊 bind-code 模式）：
--   已加入 LINE 好友 → 後台從 line_users 挑人 → 本人在 LINE 確認「是我」
--   → 加入 owner-notify recipients
--
-- 與 06 分冊 §4「顧客綁定」（line_users → customers）是兩條不同通道：這裡的
-- 對象是**店家團隊**（老闆／主管），顧客通道的對象是**顧客**，觸發事件、
-- 文案、名單上限全不相同，資料表刻意分開，不與 customers 綁定共用同一張表。
--
-- 為什麼是兩張表而不是一張：
--   `owner_notify_bind_requests` 是「已發出確認訊息、等待本人在 LINE 上按
--   確認」的暫存態；`owner_notify_recipients` 只裝**已確認**的正式名單。混在
--   同一張表要嘛在正式名單裡摻雜未確認列（畫面必須每處都多濾一次狀態），
--   要嘛把「發出邀請」與「本人確認」這兩個時間點疊在同一列的同一個
--   created_at 上，兩者都會讓「這位是不是真的本人按過確認」這個問題失去
--   單一事實來源。
--
-- 上限＝3、無付費解鎖（Owner 已裁決，Issue #18 本文）：故意不做成 tenants 的
-- 一個可調欄位——欄位本身就是「以後可能會改」的訊號，而這條規則的重點正是
-- 「現在不能改、也不打算讓任何人加值解鎖」。上限常數收在
-- `src/server/owner-notify.ts` 的 `OWNER_NOTIFY_MAX_RECIPIENTS`，DB 端不重複
-- 這個數字（未來如果真的要改，兩處都要動，那正是刻意的摩擦）。
--
-- 每接收者兩個獨立事件開關（Issue #18 逐字）：
--   notify_new_booking → 新預約
--   notify_cancel      → 旅客自行取消
--   訂閱到期／儲值提醒 → 只發給 is_primary 者、無視上面兩個開關（Issue 逐字
--   「primary only, unconditionally」），故不需要第三個開關欄位。

create table if not exists public.owner_notify_bind_requests (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  line_user_id  text not null,
  status        text not null default 'PENDING'
                  check (status in ('PENDING', 'CONFIRMED', 'EXPIRED', 'CANCELLED')),
  created_at    timestamptz not null default pg_catalog.now(),
  -- 24 小時後前端／webhook 一律視為過期（見 src/server/owner-notify.ts）；
  -- 存欄位而非硬編在應用程式碼，方便之後調整而不必動表結構。
  expires_at    timestamptz not null default (pg_catalog.now() + interval '24 hours'),
  confirmed_at  timestamptz,
  foreign key (tenant_id, line_user_id)
    references public.line_users (tenant_id, line_user_id) on delete cascade
);

do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id', 'uuid'),
      ('line_user_id', 'text'),
      ('status', 'text'),
      ('created_at', 'timestamp with time zone'),
      ('expires_at', 'timestamp with time zone'),
      ('confirmed_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'owner_notify_bind_requests'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'owner_notify_bind_requests.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'owner_notify_bind_requests.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

-- 同一位好友同時只能有一筆「進行中」的邀請——避免重覆點「邀請」狂發推播訊息
-- 又製造出一堆彼此競爭的待確認請求。
create unique index if not exists u_owner_notify_bind_requests_pending
  on public.owner_notify_bind_requests (tenant_id, line_user_id) where status = 'PENDING';

create index if not exists idx_owner_notify_bind_requests_tenant
  on public.owner_notify_bind_requests (tenant_id, created_at);

alter table public.owner_notify_bind_requests enable row level security;

drop policy if exists p_owner_notify_bind_requests_all on public.owner_notify_bind_requests;
create policy p_owner_notify_bind_requests_all on public.owner_notify_bind_requests
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ------------------------------------------------------------------ 正式名單

create table if not exists public.owner_notify_recipients (
  id                  uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id           uuid not null references public.tenants(id) on delete cascade,
  line_user_id        text not null,
  -- 「主要」：訂閱到期／儲值提醒只發給這一位（Issue 逐字）。第一位加入的
  -- 接收者自動成為主要（應用層邏輯，見 src/server/owner-notify.ts）。
  is_primary          boolean not null default false,
  notify_new_booking  boolean not null default true,
  notify_cancel       boolean not null default true,
  created_at          timestamptz not null default pg_catalog.now(),
  -- 同一位好友不可重複加入名單。
  unique (tenant_id, line_user_id),
  -- 名單只能從「該店已加入的 LINE 好友」挑人；好友被刪（unfollow 清理）時
  -- 一併移除該筆通知名單資格。
  foreign key (tenant_id, line_user_id)
    references public.line_users (tenant_id, line_user_id) on delete cascade
);

do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id', 'uuid'),
      ('line_user_id', 'text'),
      ('is_primary', 'boolean'),
      ('notify_new_booking', 'boolean'),
      ('notify_cancel', 'boolean'),
      ('created_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'owner_notify_recipients'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'owner_notify_recipients.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'owner_notify_recipients.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

-- 名單一律「某租戶、依加入時間」查詢（遞補主要時取最早的下一位）。
create index if not exists idx_owner_notify_recipients_tenant
  on public.owner_notify_recipients (tenant_id, created_at);

-- ★ 一租戶最多一位「主要」——由 DB 保證，不是靠應用層先查後寫。應用層的
-- 「先 count 再 insert」在併發下擋不住（兩個請求都讀到 0 位主要）；有了這條
-- 部分唯一索引，第二個違規寫入會撞 23505，由 route 轉成明確的錯誤訊息。
create unique index if not exists u_owner_notify_recipients_primary
  on public.owner_notify_recipients (tenant_id) where is_primary;

alter table public.owner_notify_recipients enable row level security;

drop policy if exists p_owner_notify_recipients_all on public.owner_notify_recipients;
create policy p_owner_notify_recipients_all on public.owner_notify_recipients
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
