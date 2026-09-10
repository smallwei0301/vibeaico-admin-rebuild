-- 0095 — 平台管理者代登入（issue #25／#42；規格見 docs/integration/21-PLATFORM-ADMIN-IMPERSONATION.md）
-- =============================================================================
-- Owner 2026-08-27 裁示（docs/OWNER-DECISIONS.md:108）：
--   「要做，作為正式平台能力。從 Midao 管理者後台進入指定租戶協助查看／修改。
--     僅 platform admin；全程 audit；租戶可查紀錄；不可取得租戶密碼或共用密碼。」
--
-- 本檔建立那三張表，並補上代建 provenance 與跨專案對應欄位。
--
-- ## 這個能力的性質，寫在最前面
--
-- 一旦這條路徑存在，「**是店家自己改的**」就不再能單憑 `updated_at` 證明。
-- 因此本檔的每一個選擇都以「任何一筆資料都查得出是誰改的」為第一順位：
--   1. `platform_admins` 只有 service role 能讀寫——**沒有任何 API 能新增管理者**。
--      能自我授權的權限系統等於沒有權限系統，而這個權限的爆炸半徑是全平台每一家店。
--   2. 兩張稽核表對租戶成員開放 select、對所有人關閉 insert/update/delete。
--      裁示明文要求「租戶可查紀錄」，那就必須是租戶自己讀得到，不是平台說了算。
--   3. `reason` 是 not null 且有長度下限：沒有理由的進入紀錄，稽核時等於沒有紀錄。
--
-- ## 稽核刻意不記 request body
--
-- body 裡有顧客姓名電話。把它抄進一張「租戶與平台都看得到」的表，是拿稽核之名
-- 多做一份個資副本。本表回答的是「誰、什麼時候、動了哪一支端點」；
-- 「哪一筆資料被改成什麼」由既有業務表自己的欄位承擔。
-- ⚠️ 因此本表**證不到欄位級的變更內容**——這是誠實記錄的覆蓋缺口，不是疏漏。
-- 巧合佐證：tour platform 的 `midao_audit_events` 欄位註解逐字寫著
-- `must not contain tokens, cookies, payment secrets, or complete traveler PII`。
--
-- ## 套用範圍
--
-- 依 `docs/AGENT-EXECUTION.md`，正式庫套用需 Owner 逐次具名授權；本檔合併不等於生效。

-- ---------------------------------------------------------------- platform_admins
create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  active     boolean not null default true,
  note       text not null default '',
  created_at timestamptz not null default now()
);

alter table public.platform_admins enable row level security;
alter table public.platform_admins force row level security;
-- 一般使用者連「這張表有誰」都讀不到：有沒有人是管理者本身不外洩。
revoke all on table public.platform_admins from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_admins to service_role;

-- --------------------------------------------------- impersonation_sessions
create table if not exists public.impersonation_sessions (
  id            uuid primary key default gen_random_uuid(),
  admin_user_id uuid not null references auth.users(id) on delete restrict,
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  -- 8 字下限與 `src/app/api/platform/impersonation/start` 的 zod 相同；
  -- 兩邊都擋，是因為只擋應用層的話，任何繞過該 route 的寫入都會留下空理由。
  reason        text not null check (length(btrim(reason)) between 8 and 200),
  started_at    timestamptz not null default now(),
  expires_at    timestamptz not null,
  ended_at      timestamptz,
  constraint impersonation_sessions_window_ck check (expires_at > started_at),
  constraint impersonation_sessions_ended_ck  check (ended_at is null or ended_at >= started_at)
);

create index if not exists impersonation_sessions_tenant_started_idx
  on public.impersonation_sessions (tenant_id, started_at desc, id);
create index if not exists impersonation_sessions_admin_started_idx
  on public.impersonation_sessions (admin_user_id, started_at desc, id);

-- ---------------------------------------------------- impersonation_actions
create table if not exists public.impersonation_actions (
  id         uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.impersonation_sessions(id) on delete cascade,
  -- 冗餘一份 tenant_id：租戶端查詢與 RLS 都不必 join sessions。
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  method     text not null check (method in ('POST', 'PUT', 'PATCH', 'DELETE')),
  path       text not null check (length(path) between 1 and 500),
  status     int  not null,
  at         timestamptz not null default now()
);

create index if not exists impersonation_actions_tenant_at_idx
  on public.impersonation_actions (tenant_id, at desc, id);
create index if not exists impersonation_actions_session_at_idx
  on public.impersonation_actions (session_id, at desc, id);

-- ------------------------------------------------------------- 兩張稽核表的 RLS
-- 租戶成員讀得到自己店的紀錄（裁示明文），但**沒有人**能經 PostgREST 寫入——
-- 寫入一律由 service role 在 `handleTenantWrite()` 裡完成。
-- 一條可被租戶或管理者改寫的稽核表，不是稽核表。
do $$
declare t text;
begin
  foreach t in array array['impersonation_sessions', 'impersonation_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('drop policy if exists p_%s_r on public.%I', t, t);
    -- ⚠️ 門檻是 MANAGER，不是「任何成員」。
    -- 這份紀錄會揭露平台管理者看過／動過哪些頁面，`api/settings/impersonation-log`
    -- 因此要求 MANAGER 以上。RLS 若只寫 `is_tenant_member()`，任何 STAFF 拿 anon key
    -- 直打 PostgREST 就繞過那道門檻讀得到——端點的權限門檻不等於資料的權限門檻，
    -- 兩者必須對齊，而且要對齊到比較嚴的那一邊。
    execute format(
      'create policy p_%s_r on public.%I for select using (tenant_role_at_least(tenant_id, ''MANAGER''))',
      t, t);
    execute format('revoke all on table public.%I from public, anon, authenticated', t);
    -- ⚠️ **明確** grant select 給 authenticated，不靠環境的 default privileges。
    -- Supabase 專案通常有 `alter default privileges … grant all on tables to authenticated`，
    -- 所以只寫 revoke 在 Supabase 上「看起來」是對的；但在沒有那組預設的資料庫上
    -- （全新專案、本機隔離庫），租戶成員會拿到零權限，「租戶可查紀錄」這條裁示
    -- 就靜默失效——RLS 政策放行不代表 GRANT 放行，兩道都要過。PB-028 的同族。
    execute format('grant select on table public.%I to authenticated', t);
    execute format('grant select, insert, update, delete on table public.%I to service_role', t);
  end loop;
end $$;

-- ------------------------------------------------- 跨專案對應（21 分冊 §8.5）
-- tour platform 的 `guide_profiles.id`。實查證實兩邊今天零關聯，對應建在本專案
-- （可寫的那一邊）。null 是合法且常見的狀態：店家不一定在 Midao 上架，
-- 反之亦然——**未對應時入口不該出現**，而不是出現了按下去出錯。
alter table public.tenants add column if not exists midao_guide_id uuid;
create unique index if not exists tenants_midao_guide_id_uq
  on public.tenants (midao_guide_id) where midao_guide_id is not null;

/**
 * ⚠️ 這個欄位必須由平台寫，店家不能自己改。
 *
 * 最終風險評估（第二輪）抓到：`tenants` 早在 0003 就有
 * `p_tenants_w ... for update using (tenant_role_at_least(id,'OWNER'))`，**沒有欄位限制**，
 * 而 authenticated 對 tenants 有 UPDATE。所以任何一店的 OWNER 拿 anon key 直打 PostgREST
 * 就能把自己的店對應到任意 guide id——Midao 那端「進入導遊 G 的後台」就會落到攻擊者的店，
 * 而真正的導遊反而對應不上（唯一索引只擋重複，不擋先搶）。
 * 新增這個欄位卻不擋，等於一起新增了一條劫持路徑。
 *
 * 用 trigger 而不是撤 GRANT：table 層的 UPDATE 權限要改成欄位層，得把 tenants 其餘每個
 * 欄位逐一列出來 grant，日後加欄位就會漏。trigger 只針對這一個欄位，範圍最小。
 */
create or replace function public.guard_tenants_midao_guide_id() returns trigger as $guard$
begin
  if new.midao_guide_id is distinct from old.midao_guide_id
     and coalesce(
       nullif(current_setting('request.jwt.claim.role', true), ''),
       nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
       ''
     ) <> 'service_role'
  then
    raise exception 'midao_guide_id 只能由平台設定' using errcode = '42501';
  end if;
  return new;
end;
$guard$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_tenants_midao_guide_id on public.tenants;
create trigger trg_tenants_midao_guide_id
  before update on public.tenants
  for each row execute function public.guard_tenants_midao_guide_id();

-- ------------------------------------------------- 代建 provenance（#42／21 分冊 §6）
-- 只是來源標記，**不改變任何權限**：導遊仍是可編輯的資料 owner，可以自由修改
-- 甚至刪除平台幫他建的方案（裁示明文）。值由伺服器端決定，不接受客戶端傳入。
alter table public.trip_plans add column if not exists source text not null default 'GUIDE';
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'trip_plans_source_ck'
  ) then
    alter table public.trip_plans
      add constraint trip_plans_source_ck
      check (source in ('GUIDE', 'PLATFORM_ASSISTED', 'IMPORTED'));
  end if;
end $$;

/**
 * 同一位管理者同時只能有一段開著的 session。
 *
 * `startImpersonation()` 已經會「先關掉舊的、再開新的」，但那是兩個語句、不是原子操作：
 * 兩個併發的 start 會各自關掉自己看得到的舊列、各插一列，留下一條沒有任何 cookie
 * 指向、卻 `ended_at is null` 的幽靈 session，一路顯示「進行中」到逾時為止——正是
 * 那段修正要消除的東西。資料庫層擋住，才不必依賴應用層的時序。
 */
create unique index if not exists impersonation_sessions_one_open_per_admin
  on public.impersonation_sessions (admin_user_id) where ended_at is null;

-- ------------------------------------------- 代登入必須真的「改得動」（實測抓到）
--
-- 本機測試綠、CI 的 local-isolated 車道紅，抓到一個靜態讀不出來的缺陷：
-- 代登入下 `POST /api/services` 回 500。
--
-- 原因：代登入必然用 service role client（管理者不是租戶成員，用他自己的 session
-- 一列都讀不到）。service role **繞得過 RLS**，但繞不過 `security definer` 函式
-- **body 裡**的授權檢查——`reserve_catalog_positions()` 開頭有
-- `if not tenant_role_at_least(p_tenant_id,'MANAGER') then raise 42501`，
-- 而 `tenant_role_at_least()` 查的是 `auth.uid()`，service role 呼叫時是 NULL。
-- 於是「進入後可修改」在任何走這條 RPC 的端點上都是假的。
--
-- 修法：讓 `tenant_role_at_least()` 對 **service role 呼叫者**回 true。
--
-- ⚠️ 這**沒有放寬任何人的權限**，理由要說清楚：
--   1. 握有 service role key 的呼叫者本來就能直接讀寫每一張表（BYPASSRLS），
--      也能執行所有 grant 給 service_role 的函式。在只會「限縮」的 helper 裡
--      擋他，擋不到任何實際能力，只擋掉合法路徑——是假的防線。
--   2. 這個 helper 出現在 7 條 RLS 政策裡，那些政策是給 anon/authenticated 評估的；
--      service role 根本不會走到 RLS，所以對政策而言這一行是 no-op。
--   3. 判斷依據是 JWT 的 role claim；偽造它需要簽發 service role key 的同一把
--      密鑰，沒有新的攻擊面。
--
-- 刻意**不**動 `is_tenant_member()`：它只出現在 RLS 政策裡，沒有這個問題，
-- 不需要跟著改。改動範圍愈小愈好。
create or replace function tenant_role_at_least(tid uuid, min_role text) returns boolean as $$
  select
    coalesce(
      nullif(current_setting('request.jwt.claim.role', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role',
      ''
    ) = 'service_role'
    or exists (
      select 1 from tenant_users
      where tenant_id = tid and user_id = auth.uid()
        and case role when 'OWNER' then 2 when 'MANAGER' then 1 else 0 end
            >= case min_role when 'OWNER' then 2 when 'MANAGER' then 1 else 0 end
    );
$$ language sql stable security definer set search_path = public;

-- ------------------------------------------------------------------ 檔尾斷言
-- PB-026：`create table if not exists` 遇到「同名但形狀不同」的既有表會**靜默跳過**。
-- 因此不能假設上面的 create 真的建出了預期的形狀，逐項斷言。
do $$
declare v_missing text;
begin
  select string_agg(x.t || '.' || x.col, ', ' order by x.t, x.col) into v_missing
    from (values
      ('platform_admins', 'user_id'), ('platform_admins', 'active'),
      ('platform_admins', 'note'), ('platform_admins', 'created_at'),
      ('impersonation_sessions', 'id'), ('impersonation_sessions', 'admin_user_id'),
      ('impersonation_sessions', 'tenant_id'), ('impersonation_sessions', 'reason'),
      ('impersonation_sessions', 'started_at'), ('impersonation_sessions', 'expires_at'),
      ('impersonation_sessions', 'ended_at'),
      ('impersonation_actions', 'id'), ('impersonation_actions', 'session_id'),
      ('impersonation_actions', 'tenant_id'), ('impersonation_actions', 'method'),
      ('impersonation_actions', 'path'), ('impersonation_actions', 'status'),
      ('impersonation_actions', 'at'),
      ('tenants', 'midao_guide_id'), ('trip_plans', 'source')
    ) as x(t, col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public' and c.table_name = x.t and c.column_name = x.col
   );
  if v_missing is not null then
    raise exception '0095 缺少必要欄位：%（很可能是同名舊表讓 create table if not exists 被跳過）', v_missing;
  end if;

  -- 三張表都必須真的開著 RLS。
  select string_agg(t.name, ', ' order by t.name) into v_missing
    from (values ('platform_admins'), ('impersonation_sessions'), ('impersonation_actions')) as t(name)
   where not exists (
     select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = t.name and c.relrowsecurity
   );
  if v_missing is not null then
    raise exception '0095 未啟用 RLS 的表：%', v_missing;
  end if;

  -- platform_admins 一條政策都不該有：它對 anon/authenticated 是完全撤權的，
  -- 有政策代表有人打算讓一般使用者讀它。
  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'platform_admins'
  ) then
    raise exception 'platform_admins 不應有任何 RLS 政策（只有 service role 能存取）';
  end if;

  -- 兩張稽核表的政策集合必須**逐字**只有那一條 select。
  select string_agg(c.relname || ':' || p.polname, ', ' order by c.relname, p.polname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('impersonation_sessions', 'impersonation_actions');
  if v_missing is distinct from
     'impersonation_actions:p_impersonation_actions_r, impersonation_sessions:p_impersonation_sessions_r' then
    raise exception '稽核表的 RLS 政策集合不如預期：%', v_missing;
  end if;

  -- 政策名字對了不代表條件對了。這裡斷言那兩條 select 政策真的用 MANAGER 門檻——
  -- 少了這一條，把 using 改回 is_tenant_member() 也不會有人發現。
  select string_agg(c.relname, ', ' order by c.relname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname in ('impersonation_sessions', 'impersonation_actions')
     and pg_get_expr(p.polqual, p.polrelid) not like '%MANAGER%';
  if v_missing is not null then
    raise exception '稽核表的讀取政策沒有用 MANAGER 門檻：%（STAFF 會讀得到）', v_missing;
  end if;

  -- authenticated 不得對稽核表有任何寫入權：一條改得動的稽核表不是稽核表。
  select string_agg(x.t || '/' || x.priv, ', ' order by x.t, x.priv) into v_missing
    from (values
      ('impersonation_sessions', 'INSERT'), ('impersonation_sessions', 'UPDATE'),
      ('impersonation_sessions', 'DELETE'), ('impersonation_actions', 'INSERT'),
      ('impersonation_actions', 'UPDATE'), ('impersonation_actions', 'DELETE')
    ) as x(t, priv)
   where has_table_privilege('authenticated', 'public.' || x.t, x.priv);
  if v_missing is not null then
    raise exception 'authenticated 對稽核表仍有寫入權：%', v_missing;
  end if;

  -- ⚠️ 反方向也要斷言：authenticated **必須**讀得到，否則裁示要求的
  -- 「租戶可查紀錄」會在沒有 Supabase default privileges 的資料庫上靜默失效。
  -- 只斷言「不能寫」而不斷言「讀得到」，就會漏掉這一整類環境差異。
  select string_agg(x.t, ', ' order by x.t) into v_missing
    from (values ('impersonation_sessions'), ('impersonation_actions')) as x(t)
   where not has_table_privilege('authenticated', 'public.' || x.t, 'SELECT');
  if v_missing is not null then
    raise exception 'authenticated 讀不到稽核表：%（租戶就查不到自己的紀錄）', v_missing;
  end if;

  -- platform_admins 反過來：authenticated 連 select 都不該有。
  if has_table_privilege('authenticated', 'public.platform_admins', 'SELECT') then
    raise exception 'authenticated 不應讀得到 platform_admins';
  end if;

  -- 代登入「改得動」的那一行必須真的在函式裡。只斷言函式存在證不到行為，
  -- 這裡斷言 body 真的含 service_role 分支——沒有它，走 RPC 的寫入端點會 500。
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'tenant_role_at_least'
       and pg_get_functiondef(p.oid) like '%service_role%'
  ) then
    raise exception 'tenant_role_at_least 缺少 service_role 分支（代登入下寫入會 500）';
  end if;

  -- 反方向：一般呼叫（沒有 service_role claim）不得因此變成永遠 true。
  -- 只斷言「service_role 過得了」而不斷言「其他人過不了」，就是把租戶邊界拆掉還以為修好了。
  if tenant_role_at_least('00000000-0000-4000-8000-000000000000'::uuid, 'MANAGER') then
    raise exception 'tenant_role_at_least 對非成員回了 true —— 租戶邊界破了';
  end if;
end $$;
