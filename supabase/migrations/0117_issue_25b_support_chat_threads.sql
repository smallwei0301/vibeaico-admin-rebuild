-- 0117 — Support chat 完整客服對話串第一版（issue #25 B 段）
-- =============================================================================
-- Owner Decision 2026-09-11（docs/decisions/2026-09-11-support-chat-human-escalation.md）：
-- 第一版採 Email 升級，不建立平台客服後台。流程：
--   店家在 widget 「轉人工」→ 寫入 thread + 第一則訊息 → 寄信通知平台管理者
--   → 店家可在 widget 看到自己送出的歷史與（誠實的）狀態。
--
-- ⚠️ 這張表與 `POST /api/support-chat/ask`（0012 之後既有的自助查詢端點）完全
-- 無關：那支端點唯讀、不寫入任何資料表，語意是「查詢」；這裡是「客服案件／
-- 對話串」的持久化，語意是「留言」。docs/integration/04-API-CONTRACTS.md 已
-- 用一段註解把兩者的路徑分開，本檔延續同一條界線，不建立
-- `support_chat_messages` 以外任何看起來像自助查詢的表。
--
-- 第一版狀態真實性（決策文件「第一版的狀態真實性」一節）：
--   thread.status 只有 OPEN／CLOSED 兩種；CLOSED 目前沒有任何寫入路徑會設定它
--   （沒有平台後台可以關閉案件），保留欄位是為了日後平台後台落地時不需要再改
--   schema。thread.notify_status 記錄「通知信有沒有真的送出去」，是 UI 用來
--   誠實顯示「已送出，等待人工回覆」或「已保存，但通知寄送失敗」的依據——
--   不得從 thread 存在本身推斷通知已送達。

-- ------------------------------------------------------------------ 通知狀態
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'support_chat_notify_status') then
    create type public.support_chat_notify_status as enum
      ('SENT', 'FAILED', 'SKIPPED_NO_KEY', 'SKIPPED_NO_RECIPIENT');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'support_chat_thread_status') then
    create type public.support_chat_thread_status as enum ('OPEN', 'CLOSED');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'support_chat_sender_role') then
    -- PLATFORM 目前沒有任何寫入路徑（第一版不建平台客服後台），保留列舉值是
    -- 為了 messages.sender_role 的 schema 不必在日後平台後台落地時再改一次；
    -- 該路徑落地前，任何 sender_role = 'PLATFORM' 的資料只可能來自手動 DB 操作。
    create type public.support_chat_sender_role as enum ('TENANT', 'PLATFORM');
  end if;
end $$;

-- -------------------------------------------------------------------- 資料表
create table if not exists public.support_chat_threads (
  id                uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  subject           text not null default '',
  status            public.support_chat_thread_status not null default 'OPEN',
  created_by        uuid not null references auth.users(id),
  created_by_email  text not null default '',
  notify_status     public.support_chat_notify_status not null default 'SKIPPED_NO_RECIPIENT',
  last_message_at   timestamptz not null default pg_catalog.now(),
  -- 店家上次讀取這個 thread 的時間；widget 用它算「未讀」。NULL＝從未讀過。
  tenant_read_at    timestamptz,
  created_at        timestamptz not null default pg_catalog.now(),
  updated_at        timestamptz not null default pg_catalog.now()
);

create index if not exists support_chat_threads_tenant_recent
  on public.support_chat_threads (tenant_id, last_message_at desc);

create table if not exists public.support_chat_messages (
  id            uuid primary key default pg_catalog.gen_random_uuid(),
  thread_id     uuid not null references public.support_chat_threads(id) on delete cascade,
  -- 冗餘存 tenant_id（而非只靠 thread_id join）：RLS 與應用層的租戶收窄鎖
  -- （tests/unit/impersonation-tenant-scope-lock.test.ts）要求每一段查詢述句
  -- 本身就帶得出 tenant_id，不能仰賴另一張表的 join 才能收窄。
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  sender_role   public.support_chat_sender_role not null,
  sender_email  text not null default '',
  body          text not null,
  created_at    timestamptz not null default pg_catalog.now()
);

create index if not exists support_chat_messages_thread_created
  on public.support_chat_messages (thread_id, created_at);
create index if not exists support_chat_messages_tenant
  on public.support_chat_messages (tenant_id);

-- ---------------------------------------------------------------------- RLS
alter table public.support_chat_threads enable row level security;
alter table public.support_chat_messages enable row level security;

drop policy if exists p_sct_r on public.support_chat_threads;
drop policy if exists p_sct_i on public.support_chat_threads;
drop policy if exists p_sct_u on public.support_chat_threads;
drop policy if exists p_scm_r on public.support_chat_messages;
drop policy if exists p_scm_i on public.support_chat_messages;

-- 讀：任何店員（STAFF 以上，與 /ask 一致——這是溝通管道，不是敏感設定）。
create policy p_sct_r on public.support_chat_threads
  for select using (is_tenant_member(tenant_id));
-- 建立 thread：任何店員。created_by 由伺服器端從 session 決定，不接受 client 指定。
create policy p_sct_i on public.support_chat_threads
  for insert with check (is_tenant_member(tenant_id));
-- 更新：目前只用於「標記已讀」（tenant_read_at）。第一版沒有平台後台可以改
-- status／notify_status，但 RLS 是列層級、無法只放行單一欄位，故用 with check
-- 鎖住 tenant_id 不被跨租戶改寫；欄位層的「只能改 tenant_read_at」由
-- src/server/support-chat-threads.ts 的 update() 呼叫本身只帶這一欄保證，
-- 並由 tests/unit/support-chat-threads-tenant-scope.test.ts 鎖住。
create policy p_sct_u on public.support_chat_threads
  for update using (is_tenant_member(tenant_id))
             with check (is_tenant_member(tenant_id));

create policy p_scm_r on public.support_chat_messages
  for select using (is_tenant_member(tenant_id));
-- 寫訊息：必須是店員、訊息的 tenant_id 與其 thread 的 tenant_id 一致（防止把
-- 訊息掛到別家店的 thread 下），且第一版只允許店家寫（sender_role='TENANT'）——
-- PLATFORM 沒有任何前端／API 路徑會送出這個角色，寫死在 check 裡讓錯誤在
-- schema 層就被擋下，而不是仰賴應用層永遠記得檢查。
create policy p_scm_i on public.support_chat_messages
  for insert with check (
    sender_role = 'TENANT'
    and is_tenant_member(tenant_id)
    and tenant_id = (select t.tenant_id from public.support_chat_threads t where t.id = thread_id)
  );

-- ------------------------------------------------------- 套用後的形狀斷言
do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(want.col, ', ' order by want.col) into v_missing
    from (values
      ('id'), ('tenant_id'), ('subject'), ('status'), ('created_by'),
      ('created_by_email'), ('notify_status'), ('last_message_at'),
      ('tenant_read_at'), ('created_at'), ('updated_at')
    ) as want(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'support_chat_threads'
        and c.column_name = want.col
   );
  if v_missing is not null then
    raise exception 'support_chat_threads 缺少必要欄位：%', v_missing;
  end if;

  select pg_catalog.string_agg(want.col, ', ' order by want.col) into v_missing
    from (values
      ('id'), ('thread_id'), ('tenant_id'), ('sender_role'),
      ('sender_email'), ('body'), ('created_at')
    ) as want(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = 'support_chat_messages'
        and c.column_name = want.col
   );
  if v_missing is not null then
    raise exception 'support_chat_messages 缺少必要欄位：%', v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'support_chat_threads' and c.relrowsecurity
  ) then
    raise exception 'support_chat_threads 沒有啟用 RLS';
  end if;
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'support_chat_messages' and c.relrowsecurity
  ) then
    raise exception 'support_chat_messages 沒有啟用 RLS';
  end if;

  select pg_catalog.string_agg(p.polname, ', ' order by p.polname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'support_chat_threads';
  if v_missing is distinct from 'p_sct_i, p_sct_r, p_sct_u' then
    raise exception 'support_chat_threads 的 RLS 政策集合不如預期：%', v_missing;
  end if;

  select pg_catalog.string_agg(p.polname, ', ' order by p.polname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'support_chat_messages';
  if v_missing is distinct from 'p_scm_i, p_scm_r' then
    raise exception 'support_chat_messages 的 RLS 政策集合不如預期：%', v_missing;
  end if;
end $$;
