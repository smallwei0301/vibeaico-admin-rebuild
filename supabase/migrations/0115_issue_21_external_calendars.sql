-- 0115 — Issue #21：外部行事曆匯入 external_calendars（表＋快取＋sync rpc）
-- ============================================================================
-- 範圍（見 Issue #21「本輪限定範圍」）：本檔只涵蓋 subscription 表、事件快取表
-- 與 sync 用的 service-role-only rpc。員工個人 ICS output token 的 rotation
-- 能力**刻意延後**到後續獨立 Issue（本檔不建任何 token 欄位／表）。
--
-- 設計決策：
--   - `external_calendars`：欄位照 Issue 原文列表（id/tenant_id/staff_id?/name/
--     ics_url/last_synced_at/last_sync_status/last_sync_error/active/
--     created_at）。RLS 用既有 `is_tenant_member(tenant_id)` 全操作 policy
--     （鏡像 0066 trips 系列），CRUD 走 `src/server/tenant.ts` 的 session-bound
--     client，租戶邊界完全交給 RLS，route 不額外信任 client 傳的 tenantId。
--   - `last_sync_status`：'NEVER_SYNCED' | 'OK' | 'ERROR' 三態；預設
--     'NEVER_SYNCED'，`last_synced_at` 預設 null——「從未同步過」是誠實的初始
--     狀態，不得在建立當下假造一個成功時間（Issue「Error truth」一節）。
--   - `external_calendar_events`：sync 快取表，`external_calendar_id` 外鍵
--     `on delete cascade`（刪除 subscription 一併清快取），`tenant_id`
--     denormalize 一份供 RLS／查詢直接用（不必為了讀快取多 join
--     external_calendars）。這張表**沒有**開放 authenticated 的
--     insert/update/delete policy——寫入只能透過下面的
--     `sync_replace_external_calendar_events` rpc（service role 專用），
--     與 0113 page_view_events／0114 banner_video_pending_uploads 同一套
--     「內部記帳表，租戶不直接寫」立場；authenticated 只給 select（`GET
--     /api/calendar` 併入 EXTERNAL 事件要讀這張表）。
--   - `sync_replace_external_calendar_events`：single security-definer rpc，
--     在同一個 transaction 內「刪除該 subscription 的舊快取 → 寫入新快取 →
--     更新 subscription 為 last_sync_status='OK'／last_synced_at=pg_catalog.now()／
--     last_sync_error=null」，滿足 Issue「一次 sync 原子替換」的要求
--     （supabase-js 沒有跨陳述式交易，postgres function 是唯一能保證原子性的
--     地方）。**同步失敗（ICS 抓取或解析失敗）完全不呼叫這支 rpc**——
--     `src/server/external-calendar-sync.ts` 改呼叫下面的
--     `mark_external_calendar_sync_error`，只更新 subscription 本身的
--     last_sync_status/last_sync_error，完全不動快取表，保留上次成功資料
--     （Issue「provider 失敗時保留上次成功資料」）。

create table if not exists public.external_calendars (
  id               uuid primary key default pg_catalog.gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  staff_id         uuid references public.staff(id) on delete set null,
  name             text not null,
  ics_url          text not null,
  last_synced_at   timestamptz,
  last_sync_status text not null default 'NEVER_SYNCED'
                     check (last_sync_status in ('NEVER_SYNCED', 'OK', 'ERROR')),
  last_sync_error  text,
  active           boolean not null default true,
  created_at       timestamptz not null default pg_catalog.now()
);

-- PB-026：`create table if not exists` 對既有同名異形表會靜默跳過，這裡把它變成
-- 大聲失敗（同 0113／0114 的做法）。
do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id', 'uuid'),
      ('name', 'text'),
      ('ics_url', 'text'),
      ('last_synced_at', 'timestamp with time zone'),
      ('last_sync_status', 'text'),
      ('last_sync_error', 'text'),
      ('active', 'boolean'),
      ('created_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'external_calendars'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'external_calendars.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'external_calendars.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

create index if not exists idx_external_calendars_tenant
  on public.external_calendars (tenant_id);

-- cron 主要查詢形狀：所有 active=true 的訂閱，跨租戶一次掃過。
create index if not exists idx_external_calendars_active
  on public.external_calendars (active) where active = true;

alter table public.external_calendars enable row level security;

drop policy if exists p_external_calendars_all on public.external_calendars;
create policy p_external_calendars_all on public.external_calendars
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));

-- ---------------------------------------------------------------- 事件快取表

create table if not exists public.external_calendar_events (
  id                    uuid primary key default pg_catalog.gen_random_uuid(),
  external_calendar_id  uuid not null references public.external_calendars(id) on delete cascade,
  -- denormalized：RLS／`GET /api/calendar` 查詢直接用，不必為了讀快取多 join。
  tenant_id             uuid not null references public.tenants(id) on delete cascade,
  -- ICS UID（無 UID 的來源由 sync 端合成穩定 fallback，見
  -- `src/server/external-calendar-sync.ts`），純紀錄用途，目前沒有唯一約束
  -- ——同一輪 sync 整批替換，不靠這欄去重跨輪次的列。
  uid                   text not null,
  title                 text not null,
  start_at              timestamptz not null,
  end_at                timestamptz not null,
  all_day               boolean not null default false,
  created_at            timestamptz not null default pg_catalog.now()
);

do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('external_calendar_id', 'uuid'),
      ('tenant_id', 'uuid'),
      ('uid', 'text'),
      ('title', 'text'),
      ('start_at', 'timestamp with time zone'),
      ('end_at', 'timestamp with time zone'),
      ('all_day', 'boolean'),
      ('created_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'external_calendar_events'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'external_calendar_events.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'external_calendar_events.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;
end $$;

-- `GET /api/calendar` 主要查詢形狀：依 tenant + 時間區間找出重疊事件。
create index if not exists idx_external_calendar_events_tenant_range
  on public.external_calendar_events (tenant_id, start_at, end_at);

create index if not exists idx_external_calendar_events_subscription
  on public.external_calendar_events (external_calendar_id);

alter table public.external_calendar_events enable row level security;

-- 只讀 policy：租戶成員只能看自己租戶的快取事件。刻意沒有對應的
-- insert/update/delete policy 給 authenticated/anon——寫入只透過下面的
-- service-role-only rpc，見檔頭。
drop policy if exists p_external_calendar_events_select on public.external_calendar_events;
create policy p_external_calendar_events_select on public.external_calendar_events
  for select to authenticated
  using (is_tenant_member(tenant_id));

-- ---------------------------------------------------------- sync rpc（成功）

create or replace function public.sync_replace_external_calendar_events(
  p_external_calendar_id uuid,
  p_tenant_id uuid,
  p_events jsonb
) returns void as $$
begin
  if not exists (
    select 1 from public.external_calendars
     where id = p_external_calendar_id and tenant_id = p_tenant_id
  ) then
    raise exception 'external_calendar % not found for tenant %', p_external_calendar_id, p_tenant_id;
  end if;

  delete from public.external_calendar_events
   where external_calendar_id = p_external_calendar_id;

  insert into public.external_calendar_events
    (external_calendar_id, tenant_id, uid, title, start_at, end_at, all_day)
  select
    p_external_calendar_id,
    p_tenant_id,
    coalesce(e->>'uid', ''),
    coalesce(e->>'title', ''),
    (e->>'start_at')::timestamptz,
    (e->>'end_at')::timestamptz,
    coalesce((e->>'all_day')::boolean, false)
  from jsonb_array_elements(p_events) as e;

  update public.external_calendars
     set last_synced_at = now(),
         last_sync_status = 'OK',
         last_sync_error = null
   where id = p_external_calendar_id;
end;
$$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------- sync rpc（失敗記錄）
-- 刻意與成功路徑分開成獨立 rpc：失敗時**完全不碰** external_calendar_events，
-- 只更新 subscription 本身的三個狀態欄位——保留上次成功快取（Issue「Error
-- truth」一節）。

create or replace function public.mark_external_calendar_sync_error(
  p_external_calendar_id uuid,
  p_tenant_id uuid,
  p_error text
) returns void as $$
begin
  update public.external_calendars
     set last_sync_status = 'ERROR',
         last_sync_error = p_error
   where id = p_external_calendar_id and tenant_id = p_tenant_id;
end;
$$ language plpgsql security definer set search_path = public;

-- --------------------------------------------------------------------- ACL
-- 同 0111 accept_tour_request 的既有慣例：security definer 繞過 RLS，只能由
-- 伺服器端 service_role（cron／sync 呼叫）使用；先 revoke all from public 再
-- 個別 grant，PostgreSQL 對新函式預設 `GRANT EXECUTE TO PUBLIC`，只 revoke
-- anon/authenticated 不夠（PB-028）。
revoke all on function public.sync_replace_external_calendar_events(uuid, uuid, jsonb) from public;
revoke all on function public.sync_replace_external_calendar_events(uuid, uuid, jsonb) from anon, authenticated;
grant execute on function public.sync_replace_external_calendar_events(uuid, uuid, jsonb) to service_role;

revoke all on function public.mark_external_calendar_sync_error(uuid, uuid, text) from public;
revoke all on function public.mark_external_calendar_sync_error(uuid, uuid, text) from anon, authenticated;
grant execute on function public.mark_external_calendar_sync_error(uuid, uuid, text) to service_role;
