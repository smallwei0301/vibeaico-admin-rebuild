-- #46 INSTANT 自選時間 slice 1（release 版）：取代 0138_issue_46_instant_occupancy。
--
-- ## 為什麼有 0139
--   0138 已在 main，但從未套用到任何環境（canonical TEST、Production 皆無）。0138 原文無法通過 Production DB
--   release 分類器（頂層 DO 呼叫非白名單函式；既有團次回填使整支同時成為 SCHEMA_REPAIR／AUTHZ／BACKFILL）。
--   已在 main 的 migration 不得原地修改，因此以本檔取代：ledger alias map 將 0138 標為 VERIFIED_NOT_APPLIED
--   （被 0139 取代、從未套用），release 只套用 0139。
--
-- ## 兩種起點都必須正確（冪等）
--   (a) 只有 0001–0137（Production／TEST 實際路徑，0138 不會套用）：本檔完整建立所有物件。
--   (b) 0138 已套用（fresh install／historical-compatibility 依序重放 0138 再 0139）：全部以
--       add column if not exists／create or replace／drop trigger if exists 重建；0138 留下的
--       trip_plans_instant_start_times_ck（與 trigger 內驗證等價）與已回填的 duration_minutes_snapshot 都相容保留，
--       本檔不移除任何約束、不修改任何既有團次資料。
--
-- 以下為原 0138 說明（已依本檔調整）。
--
-- #46 INSTANT 自選時間 slice 1：資料庫與伺服器核心（SOURCE only，不含公開頁 UI／公開 route）。
--
-- Owner 決策（2026-10-23，https://github.com/smallwei0301/vibeaico-admin-rebuild/issues/46#issuecomment-6377107200）：
--   Q1 方案固定起始時刻清單（預設最短提前 24 小時、可售 60 天）。
--   Q2 方案指定單一導遊（不自動分派）。
--   Q3 建單即 snapshot hold_expires_at（沿用 trip_plans.request_hold_hours 單一來源，預設 12 小時），
--      逾期由既有 expire_tour_order 取消並釋放 Departure。
--   Q4 團與團間緩衝時間 0 分，本檔不做。
--
-- ## 本檔做的事
--
--   1. trip_departures.duration_minutes_snapshot（0135 檔頭要求的前置條件）：新建團次 INSERT 時 snapshot
--      （僅行程時長已知時；其餘維持 NULL）。本檔不回填既有團次（回填屬獨立風險類別，需 Production backup
--      證據；既有團次的 snapshot 維持 NULL）。實際占用一律取
--      departure_effective_minutes＝greatest(snapshot, 目前 plan.duration_minutes, 行程時數*60)，
--      NULL 視為 0：既有團次（snapshot 為 NULL）因此等於 greatest(plan, 行程時數*60)，與 app 端
--      src/server/staff-availability.ts 的 greatest(plan, trip) 一致。
--      新建團次的 snapshot 只會延長占用、不會縮短（方案事後調長時長仍延長團次，維持 0135 原行為）；
--      三者皆未知才整日占用。此公式套用於 0135 predicate、departure_occupancy_range 的呼叫端與全部 trigger。
--      既有團次唯一與回填版本的差異：方案事後「調短」時長時，既有團次的占用會跟著縮短（新團次則維持凍結的較長值）。
--   2. trip_plans 新增 INSTANT 規則欄位 instant_start_times／instant_min_lead_minutes／
--      instant_max_advance_days／instant_guide_staff_id。對非 INSTANT 方案不強制；「INSTANT 方案必須
--      設定時刻清單與導遊」由 create_instant_tour_order 在執行時 fail closed（INSTANT_NOT_CONFIGURED），
--      不加 DB check：既有 INSTANT 方案資料與 tests/integration/db/formation-state-model.41 會被擋，
--      待後台表單 slice 補齊設定後再評估 NOT VALID→VALIDATE。
--   3. 共用占用排他：bookings／trip_departure_staff／trip_departures 三個 writer 掛 constraint trigger，
--      以 per-(tenant,staff) pg_advisory_xact_lock 序列化後重驗「新／變更列」與其他 PENDING/CONFIRMED
--      預約、非 CANCELLED 團次的重疊，衝突 raise STAFF_OCCUPIED（errcode P0020）。
--      不追溯既有重疊資料；不在 trigger 內判 shift／block／external（那是可接案偏好，由 predicate 判）。
--   4. create_instant_tour_order：單一交易內驗規則、鎖導遊、重驗可用性、建 PRIVATE Departure＋PRIMARY、
--      經 create_tour_order_quoted 建單（價格比對與 PRICE_CHANGED 回滾沿用 0137）、冪等。
--   5. cancel_tour_order／expire_tour_order（簽章不變）：INSTANT 私人團無其他有效訂單時一併設 CANCELLED。
--
-- ## 錯誤碼（app 以 SQLSTATE 或 message 映射）
--   P0020 STAFF_OCCUPIED｜P0021 INVALID_START｜P0022 SLOT_TAKEN｜P0023 INSTANT_NOT_AVAILABLE
--   P0024 INSTANT_NOT_CONFIGURED｜P0025 IDEMPOTENCY_KEY_REUSED｜P0004 PRICE_CHANGED（0137）
--   P0001 SEATS_UNAVAILABLE（reserve_seats）｜P0003 INVALID_ARGUMENTS／PARTY_SIZE_OUT_OF_RANGE。
--
-- ## 已知限制（有意不處理）
--   - 既有撞班（0139 之前留下的重疊）的團次，在衝突解決前無法重新儲存指派：replace_trip_departure_staff
--     （0131，本檔不改）先刪後插，插入會被占用 trigger 以 STAFF_OCCUPIED 擋下並整筆回滾（原指派保留）。
--     先調整其中一邊的時間或導遊即可。
--   - ACTIVATE 之前，PATCH /api/trip-departures/:id 仍是兩步寫入（先 update 團次、再 replace 指派，各自一個交易）：
--     0139 套用後到 ACTIVATE 之間，「同時改時間與導遊」會以舊導遊驗證新時間，舊導遊在新時間撞班就 fail-closed
--     （409）。ACTIVATE PR 必須改呼叫本檔新增的 update_trip_departure_with_staff（單一交易、最終狀態驗證）。
--   - 占用排他只保證 READ COMMITTED（Supabase 預設）：trigger 取 advisory lock 後以新 statement snapshot 重驗；
--     REPEATABLE READ／SERIALIZABLE 交易看不到鎖等待期間他人已提交的列，不在保證範圍。
--
-- ## 發布與範圍
--   - 必須在 0111、0131、0132、0135、0136、0137 之後套用；僅新增 source，不套用到任何環境。
--   - 規格 1.5.1：新 schema source 例外依據為 Owner 明確改優先序；Production 套用需 Owner 另行具名授權。
--   - 觸發器改變所有 booking／團次 writer 的行為面：套用順序為 LOCAL_ISOLATED → canonical TEST。
begin;

-- ------------------------------------------------------------------ 前置形狀
do $$
declare v_n integer;
begin
  if pg_catalog.to_regclass('public.trip_departures') is null or pg_catalog.to_regclass('public.trip_plans') is null
    or pg_catalog.to_regclass('public.trip_departure_staff') is null or pg_catalog.to_regclass('public.tour_orders') is null
    or pg_catalog.to_regclass('public.bookings') is null or pg_catalog.to_regclass('public.staff') is null
    or pg_catalog.to_regclass('public.trips') is null or pg_catalog.to_regclass('public.tenant_settings') is null then
    raise exception '0139 前置條件失敗：缺少必要資料表（需 0066／0087／0092／0107／0110／0135）';
  end if;
  -- 以 pg_proc 的參數型別向量（只比型別、不比參數名稱）找三個前置 RPC，各自必須恰好一個。
  select count(*) into v_n
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and ((p.proname = 'create_tour_order_quoted'
           and p.proargtypes = array['uuid'::regtype::oid, 'text'::regtype::oid, 'uuid'::regtype::oid,
             'integer'::regtype::oid, 'uuid'::regtype::oid, 'jsonb'::regtype::oid,
             pg_catalog.to_regtype('public.tour_order_source')::oid, 'uuid'::regtype::oid, 'text'::regtype::oid,
             'timestamptz'::regtype::oid, 'numeric'::regtype::oid]::oidvector)
       or (p.proname = 'replace_trip_departure_staff'
           and p.proargtypes = array['uuid'::regtype::oid, 'uuid'::regtype::oid, 'uuid'::regtype::oid, 'uuid[]'::regtype::oid]::oidvector)
       or (p.proname = 'guide_staff_interval_available'
           and p.proargtypes = array['uuid'::regtype::oid, 'uuid'::regtype::oid, 'timestamptz'::regtype::oid, 'timestamptz'::regtype::oid]::oidvector));
  if v_n <> 3 then
    raise exception '0139 前置條件失敗：缺少 0131／0135／0137 的 RPC';
  end if;
end $$;

-- ------------------------------------------------------------------ 欄位
alter table public.trip_departures add column if not exists duration_minutes_snapshot integer;
-- 持久標記：這個團次是 create_instant_tour_order 建立（或重用）的 INSTANT 私人團。cancel／expire 依此釋放，
-- 不看方案「現在」的 sales_mode／participation_mode（店家建單後改方案不會讓私人團永遠不被釋放）。
alter table public.trip_departures add column if not exists instant_private boolean not null default false;
alter table public.trip_plans
  add column if not exists instant_start_times time[],
  add column if not exists instant_min_lead_minutes integer not null default 1440,
  add column if not exists instant_max_advance_days integer not null default 60,
  add column if not exists instant_guide_staff_id uuid;
alter table public.tour_orders add column if not exists idempotency_key text;

do $$
begin
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_departures'::regclass
    and conname = 'trip_departures_duration_minutes_snapshot_ck') then
    alter table public.trip_departures add constraint trip_departures_duration_minutes_snapshot_ck
      check (duration_minutes_snapshot is null or duration_minutes_snapshot > 0);
  end if;
  -- instant_start_times 的「1 到 48 個元素、不得有 NULL」檢查需要函式（cardinality／array_position），
  -- 不能寫成只有運算子的 CHECK；改由下方 trg_trip_plans_instant_guide_same_tenant 驗證
  -- （同樣 errcode 23514、constraint 名 trip_plans_instant_start_times_ck）。
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_plans'::regclass
    and conname = 'trip_plans_instant_min_lead_ck') then
    alter table public.trip_plans add constraint trip_plans_instant_min_lead_ck
      check (instant_min_lead_minutes between 0 and 525600);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_plans'::regclass
    and conname = 'trip_plans_instant_max_advance_ck') then
    alter table public.trip_plans add constraint trip_plans_instant_max_advance_ck
      check (instant_max_advance_days between 1 and 365);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.trip_plans'::regclass
    and conname = 'trip_plans_instant_guide_staff_fk') then
    -- 單欄 FK 指向 staff(id)（no action＝restrict 語意）。同租戶由下方 trigger 驗證，而不是複合 FK：
    -- 複合 FK 會依賴 staff_tenant_id_id_key（0133），而 production-shaped 升級驗證（agent-schema-bootstrap）
    -- 會移除該 key，被依賴的物件會使移除動作失敗。
    alter table public.trip_plans add constraint trip_plans_instant_guide_staff_fk
      foreign key (instant_guide_staff_id) references public.staff (id);
  end if;
  if not exists (select 1 from pg_constraint where conrelid = 'public.tour_orders'::regclass
    and conname = 'tour_orders_idempotency_key_ck') then
    alter table public.tour_orders add constraint tour_orders_idempotency_key_ck
      check (idempotency_key is null or idempotency_key ~ '^.{1,128}$');
  end if;
end $$;

create or replace function public.trg_trip_plans_instant_guide_same_tenant()
returns trigger language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
begin
  -- 等價於原本的 CHECK：1 到 48 個元素、不得含 NULL（cardinality／array_position 放在函式本體，
  -- 不在 migration 時期執行的 DO／DDL 運算式內，避免觸發 Production DB release 分類器的函式白名單）。
  if new.instant_start_times is not null
     and not (cardinality(new.instant_start_times) between 1 and 48
              and array_position(new.instant_start_times, null::time) is null) then
    raise exception 'new row for relation "trip_plans" violates check constraint "trip_plans_instant_start_times_ck"'
      using errcode = '23514', schema = 'public', table = 'trip_plans',
            constraint = 'trip_plans_instant_start_times_ck';
  end if;
  if new.instant_guide_staff_id is not null and not exists (
    select 1 from public.staff s where s.id = new.instant_guide_staff_id and s.tenant_id = new.tenant_id
  ) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0002',
      detail = 'instant_guide_staff_id 必須是同租戶的導遊';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trip_plans_instant_guide_same_tenant on public.trip_plans;
create trigger trg_trip_plans_instant_guide_same_tenant
  before insert or update of instant_guide_staff_id, instant_start_times, tenant_id on public.trip_plans
  for each row execute function public.trg_trip_plans_instant_guide_same_tenant();

create unique index if not exists ux_tour_orders_tenant_idempotency
  on public.tour_orders (tenant_id, idempotency_key) where idempotency_key is not null;
-- (tenant_id, staff_id) 索引已由 0092 的 ix_trip_departure_staff_staff 提供，不重複建立。

-- PB-026：add column if not exists 遇到同名但形狀不同的既有欄位會靜默跳過。
do $$
declare r record; v_actual text;
begin
  for r in select * from (values
    ('trip_departures','duration_minutes_snapshot','integer'),
    ('trip_departures','instant_private','boolean'),
    ('trip_plans','instant_start_times','ARRAY'),
    ('trip_plans','instant_min_lead_minutes','integer'),
    ('trip_plans','instant_max_advance_days','integer'),
    ('trip_plans','instant_guide_staff_id','uuid'),
    ('tour_orders','idempotency_key','text')
  ) as e(tbl, col, typ) loop
    select data_type into v_actual from information_schema.columns
     where table_schema='public' and table_name=r.tbl and column_name=r.col;
    if v_actual is distinct from r.typ then
      raise exception '0139 形狀斷言失敗：%.% 型別應為 %，實際 %', r.tbl, r.col, r.typ, v_actual;
    end if;
  end loop;
  if not exists (select 1 from information_schema.columns where table_schema='public'
      and table_name='trip_plans' and column_name='instant_start_times' and udt_name = '_time') then
    raise exception '0139 形狀斷言失敗：trip_plans.instant_start_times 應為 time[]';
  end if;
end $$;

-- ------------------------------------------------------------------ duration snapshot（只對新建團次）
-- 不回填既有團次：既有團次的 snapshot 維持 NULL，占用由 departure_effective_minutes 以
-- greatest(目前 plan.duration_minutes, 行程時數*60) 計算（NULL snapshot 視為 0）。
create or replace function public.trg_trip_departures_duration_snapshot()
returns trigger language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if new.duration_minutes_snapshot is null then
    select greatest(pl.duration_minutes, round(t.duration_hours * 60)::integer)
      into new.duration_minutes_snapshot
      from public.trip_plans pl join public.trips t on t.id = new.trip_id and t.tenant_id = new.tenant_id
     where pl.id = new.plan_id and pl.tenant_id = new.tenant_id
       and t.duration_hours is not null and t.duration_hours > 0;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_trip_departures_duration_snapshot on public.trip_departures;
create trigger trg_trip_departures_duration_snapshot
  before insert on public.trip_departures
  for each row execute function public.trg_trip_departures_duration_snapshot();

comment on column public.trip_departures.duration_minutes_snapshot is
  '#46：新建團次當下 snapshot 的占用分鐘數；既有團次為 NULL（不回填）。實際占用取 departure_effective_minutes＝greatest(snapshot, 目前 plan.duration_minutes, 行程時數*60)，NULL 視為 0，只延長不縮短；三者皆未知才占用整個租戶日。';

-- ------------------------------------------------------------------ 共用占用 helper
-- 時區來源：tenant_settings.basic.timezone。
--   - 沒有 tenant_settings 列、或沒有 timezone 鍵：回正式預設 Asia/Taipei（與 0135 predicate 同一規則，
--     舊租戶可能沒有設定列）。
--   - 有 timezone 鍵但不是字串、或不是 pg_timezone_names 內的名稱：raise TENANT_TIMEZONE_INVALID（P0026），
--     不靜默改用台北，以免用錯時區占用時段。
-- 維持 security invoker（不用 definer：definer 的 owner 若非 bypassrls 會被 RLS 濾掉而看起來「沒有列」，
-- 反而更容易靜默落到預設值——0136 教訓）。service_role 與租戶成員都讀得到自己租戶的設定列。
create or replace function public.tenant_timezone_name(p_tenant uuid)
returns text language plpgsql stable security invoker set search_path = pg_catalog, public
as $$
declare
  v_basic jsonb;
  v_zone text;
  v_canonical text;
begin
  select ts.basic into v_basic from public.tenant_settings ts where ts.tenant_id = p_tenant;
  if v_basic is null or jsonb_typeof(v_basic) <> 'object' or not (v_basic ? 'timezone') then
    return 'Asia/Taipei';
  end if;
  if jsonb_typeof(v_basic -> 'timezone') <> 'string' then
    raise exception 'TENANT_TIMEZONE_INVALID' using errcode = 'P0026';
  end if;
  v_zone := btrim(v_basic ->> 'timezone');
  -- PostgreSQL 的 AT TIME ZONE 不分大小寫（'asia/taipei'、'utc' 都能用），所以這裡也不分大小寫比對，
  -- 並回傳 pg_timezone_names 的 canonical 名稱；查不到才 raise，避免把原本可用的租戶設定誤判為無效。
  select n.name into v_canonical from pg_catalog.pg_timezone_names n
   where lower(n.name) = lower(v_zone) order by (n.name = v_zone) desc, n.name limit 1;
  if v_zone = '' or v_canonical is null then
    raise exception 'TENANT_TIMEZONE_INVALID' using errcode = 'P0026';
  end if;
  return v_canonical;
end;
$$;

-- DST gap／fold：團次的牆上開始時間若落在不存在（gap）或重複（fold）的時間，這裡沿用 PostgreSQL 的
-- 預設解析（gap 往後推、fold 取較早一次），最多與實際差一小時，且只影響占用 trigger 的重疊判斷。
-- 嚴格拒絕 gap／fold 的是 INSTANT 下單（create_instant_tour_order）與 0135 predicate，不在這裡擴大行為面
-- 去擋既有 writer。
create or replace function public.departure_occupancy_range(
  p_departs_on date, p_start time, p_minutes integer, p_zone text
) returns tstzrange
language sql stable security invoker set search_path = pg_catalog, public
as $$
  select case
    when p_start is null or p_minutes is null or p_minutes <= 0 then
      tstzrange(p_departs_on::timestamp at time zone p_zone, (p_departs_on + 1)::timestamp at time zone p_zone, '[)')
    else
      tstzrange((p_departs_on + p_start) at time zone p_zone,
        ((p_departs_on + p_start) at time zone p_zone) + make_interval(mins => p_minutes), '[)')
  end;
$$;

create or replace function public.lock_staff_occupancy(p_tenant uuid, p_staff uuid)
returns void language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended('staff-occupancy:' || p_tenant::text || ':' || p_staff::text, 0));
end;
$$;

-- p_local 是該 instant 在 p_zone 的牆上時間；若同一牆上時間另有不同 instant（fold）回 true。
create or replace function public.instant_wall_clock_ambiguous(p_zone text, p_local timestamp, p_instant timestamptz)
returns boolean language sql stable security invoker set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from unnest(array[p_local::date - 1, p_local::date, p_local::date + 1]) sample(day)
    cross join lateral (select sample.day::timestamp at time zone p_zone instant) observed
    cross join lateral (select (observed.instant at time zone p_zone) - (observed.instant at time zone 'UTC') utc_offset) offsets
    cross join lateral (select (p_local - offsets.utc_offset) at time zone 'UTC' instant) candidate
    where candidate.instant <> p_instant and (candidate.instant at time zone p_zone) = p_local
  );
$$;

-- 團次占用分鐘數（最保守值）：greatest(snapshot, 目前 plan.duration_minutes, 行程 duration_hours*60)。
-- snapshot 只會延長占用、不會縮短：方案事後調長時長，既有團次的占用隨之延長（0135 原行為），
-- 調短則不會釋放建團當下凍結的較長值。三者都未知（<=0 或 NULL）時回 NULL＝整日占用。
-- app 端 #1115 的 departureSnapshotMinutes 用同一個 greatest(plan, trip)；行程時長未知時 app 取整日（更保守）。
create or replace function public.departure_effective_minutes(
  p_snapshot integer, p_plan_minutes integer, p_trip_hours numeric
) returns integer
language sql immutable security invoker set search_path = pg_catalog, public
as $$
  select nullif(greatest(
    coalesce(p_snapshot, 0),
    coalesce(p_plan_minutes, 0),
    case when p_trip_hours is not null and p_trip_hours > 0 then round(p_trip_hours * 60)::integer else 0 end
  ), 0);
$$;

create or replace function public.departure_range_for(p_departure uuid, p_zone text)
returns tstzrange
language sql stable security invoker set search_path = pg_catalog, public
as $$
  select public.departure_occupancy_range(d.departs_on, d.start_time,
           public.departure_effective_minutes(d.duration_minutes_snapshot, pl.duration_minutes, t.duration_hours), p_zone)
    from public.trip_departures d
    left join public.trip_plans pl on pl.id = d.plan_id and pl.tenant_id = d.tenant_id
    left join public.trips t on t.id = d.trip_id and t.tenant_id = d.tenant_id
   where d.id = p_departure;
$$;

-- 取鎖後重驗：呼叫端必須已確認本列需要檢查。多人時由呼叫端依 staff id 排序呼叫。
-- READ COMMITTED 下每個 statement 取新 snapshot，等鎖結束後看得到對方已 commit 的列。
create or replace function public.assert_staff_not_occupied(
  p_tenant uuid, p_staff uuid, p_range tstzrange, p_except_departure uuid, p_except_booking uuid,
  p_zone text default null
) returns void language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
declare
  v_zone text;
  v_hit record;
begin
  perform public.lock_staff_occupancy(p_tenant, p_staff);
  select b.id, b.start_at, b.end_at into v_hit
    from public.bookings b
   where b.tenant_id = p_tenant and b.staff_id = p_staff
     and b.status in ('PENDING', 'CONFIRMED')
     and b.id is distinct from p_except_booking
     and b.start_at < upper(p_range) and b.end_at > lower(p_range)
   limit 1;
  if found then
    raise exception 'STAFF_OCCUPIED' using errcode = 'P0020',
      detail = json_build_object('kind', 'BOOKING', 'id', v_hit.id, 'staffId', p_staff,
        'start', v_hit.start_at, 'end', v_hit.end_at)::text;
  end if;
  v_zone := coalesce(p_zone, public.tenant_timezone_name(p_tenant));
  select d.id, public.departure_range_for(d.id, v_zone) occ
    into v_hit
    from public.trip_departure_staff ds
    join public.trip_departures d on d.id = ds.departure_id and d.tenant_id = ds.tenant_id
   where ds.tenant_id = p_tenant and ds.staff_id = p_staff
     and d.status <> 'CANCELLED'
     and d.id is distinct from p_except_departure
     -- 占用不會早於 departs_on 開始；僅排除出發日在請求區間之後的團次。
     and d.departs_on <= ((upper(p_range) at time zone v_zone)::date)
     and public.departure_range_for(d.id, v_zone) && p_range
   limit 1;
  if found then
    raise exception 'STAFF_OCCUPIED' using errcode = 'P0020',
      detail = json_build_object('kind', 'DEPARTURE', 'id', v_hit.id, 'staffId', p_staff,
        'start', lower(v_hit.occ), 'end', upper(v_hit.occ))::text;
  end if;
end;
$$;

-- ------------------------------------------------------------------ 占用 constraint trigger
create or replace function public.trg_bookings_staff_occupancy()
returns trigger language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
begin
  if new.staff_id is null or new.status not in ('PENDING', 'CONFIRMED') then return null; end if;
  -- 新狀態已確定屬占用狀態（PENDING／CONFIRMED）。導遊與起訖時間都沒變、舊狀態也屬占用狀態
  -- （例如 PENDING→CONFIRMED 或改備註）時占用事實沒有改變，不重驗：0139 之前留下的既有重疊
  -- 不能因為只是確認預約而被擋下。
  if tg_op = 'UPDATE' and old.staff_id is not distinct from new.staff_id
     and old.start_at = new.start_at and old.end_at = new.end_at
     and old.status in ('PENDING', 'CONFIRMED') then
    return null;
  end if;
  perform public.assert_staff_not_occupied(new.tenant_id, new.staff_id,
    tstzrange(new.start_at, new.end_at, '[)'), null, new.id);
  return null;
end;
$$;

create or replace function public.trg_trip_departure_staff_occupancy()
returns trigger language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
declare
  v_dep record;
  v_lock uuid;
  v_zone text;
begin
  if tg_op = 'UPDATE' and old.staff_id = new.staff_id and old.departure_id = new.departure_id then
    return null;
  end if;
  -- 先鎖團次列（FOR NO KEY UPDATE，與改時間／狀態的 UPDATE 互斥），再取 staff advisory lock。
  -- 全檔鎖序一致：團次列 → staff advisory（團次 UPDATE trigger、replace_trip_departure_staff、
  -- create_instant_tour_order 皆同）。否則「A 指派尚未 commit、B 同時改同一團時間」會各自驗到舊狀態而漏判。
  select d.id, d.departs_on, d.start_time, d.duration_minutes_snapshot, d.status into v_dep
    from public.trip_departures d where d.id = new.departure_id and d.tenant_id = new.tenant_id
     for no key update;
  if not found or v_dep.status = 'CANCELLED' then return null; end if;
  v_zone := public.tenant_timezone_name(new.tenant_id); -- 只算一次，下面的範圍與 assert 共用
  -- 一次指派多人時（AFTER ROW 於語句結束後觸發，此時同團全部列皆可見）先依 staff id 排序對全團取鎖，
  -- 避免不同交易以相反順序取得多把鎖而死結；assert 內再取同一把鎖為可重入。
  for v_lock in
    select x.staff_id from (
      select ds.staff_id from public.trip_departure_staff ds
       where ds.tenant_id = new.tenant_id and ds.departure_id = new.departure_id
      union select new.staff_id
    ) x order by x.staff_id
  loop
    perform public.lock_staff_occupancy(new.tenant_id, v_lock);
  end loop;
  perform public.assert_staff_not_occupied(new.tenant_id, new.staff_id,
    public.departure_range_for(new.departure_id, v_zone),
    new.departure_id, null, v_zone);
  return null;
end;
$$;

create or replace function public.trg_trip_departures_staff_occupancy()
returns trigger language plpgsql volatile security invoker set search_path = pg_catalog, public
as $$
declare
  v_staff uuid;
  v_range tstzrange;
  v_zone text;
begin
  if new.status = 'CANCELLED' then return null; end if;
  if old.status <> 'CANCELLED' and old.departs_on = new.departs_on
     and old.start_time is not distinct from new.start_time
     and old.duration_minutes_snapshot is not distinct from new.duration_minutes_snapshot then
    return null;
  end if;
  v_zone := public.tenant_timezone_name(new.tenant_id); -- 只算一次，範圍與每位導遊的 assert 共用
  v_range := public.departure_range_for(new.id, v_zone);
  -- 依 staff id 排序取鎖，避免多人團次互相死結。
  for v_staff in
    select ds.staff_id from public.trip_departure_staff ds
     where ds.tenant_id = new.tenant_id and ds.departure_id = new.id order by ds.staff_id
  loop
    perform public.assert_staff_not_occupied(new.tenant_id, v_staff, v_range, new.id, null, v_zone);
  end loop;
  return null;
end;
$$;

drop trigger if exists trg_bookings_staff_occupancy on public.bookings;
create constraint trigger trg_bookings_staff_occupancy
  after insert or update of staff_id, start_at, end_at, status on public.bookings
  deferrable initially immediate
  for each row execute function public.trg_bookings_staff_occupancy();

drop trigger if exists trg_trip_departure_staff_occupancy on public.trip_departure_staff;
create constraint trigger trg_trip_departure_staff_occupancy
  after insert or update of staff_id, departure_id on public.trip_departure_staff
  deferrable initially immediate
  for each row execute function public.trg_trip_departure_staff_occupancy();

drop trigger if exists trg_trip_departures_staff_occupancy on public.trip_departures;
create constraint trigger trg_trip_departures_staff_occupancy
  after update of departs_on, start_time, status, duration_minutes_snapshot on public.trip_departures
  deferrable initially immediate
  for each row execute function public.trg_trip_departures_staff_occupancy();

-- trigger 內呼叫的 helper 以「寫入者」身分執行：bookings 可由 authenticated 租戶成員寫入，
-- 因此 authenticated 必須保有 execute；anon／PUBLIC 不給。
revoke all on function public.tenant_timezone_name(uuid) from public, anon;
revoke all on function public.departure_occupancy_range(date, time, integer, text) from public, anon;
revoke all on function public.departure_effective_minutes(integer, integer, numeric) from public, anon;
revoke all on function public.departure_range_for(uuid, text) from public, anon;
revoke all on function public.lock_staff_occupancy(uuid, uuid) from public, anon;
revoke all on function public.instant_wall_clock_ambiguous(text, timestamp, timestamptz) from public, anon;
revoke all on function public.assert_staff_not_occupied(uuid, uuid, tstzrange, uuid, uuid, text) from public, anon;
grant execute on function public.tenant_timezone_name(uuid) to authenticated, service_role;
grant execute on function public.departure_occupancy_range(date, time, integer, text) to authenticated, service_role;
grant execute on function public.departure_effective_minutes(integer, integer, numeric) to authenticated, service_role;
grant execute on function public.departure_range_for(uuid, text) to authenticated, service_role;
grant execute on function public.lock_staff_occupancy(uuid, uuid) to authenticated, service_role;
grant execute on function public.instant_wall_clock_ambiguous(text, timestamp, timestamptz) to authenticated, service_role;
grant execute on function public.assert_staff_not_occupied(uuid, uuid, tstzrange, uuid, uuid, text) to authenticated, service_role;

-- ------------------------------------------------------------------ 0135 predicate：snapshot 優先
-- 與 0135 位元組相同，唯一差異：DEPARTURE 分支的時長由 pl.duration_minutes 改為 departure_effective_minutes
-- （greatest(snapshot, 目前 plan.duration_minutes, 行程時數*60)，只延長不縮短）
-- （NULL／<=0＝整日占用）。plan 仍 left join，僅用於血統有效性檢查。
create or replace function public.guide_staff_interval_available(
  p_tenant uuid, p_staff uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language plpgsql stable security invoker set search_path = pg_catalog, public
as $$
declare
  v_policy text;
  v_basic jsonb;
  v_zone text;
  v_canonical text;
  v_request tstzrange;
  v_shifts tstzrange[] := array[]::tstzrange[];
  v_coverage tstzmultirange;
  v_start timestamptz;
  v_end timestamptz;
  v_local timestamp;
  v_utc timestamptz;
  v_i integer;
  v_possible_start timestamptz;
  v_possible_end timestamptz;
  v_min timestamptz;
  v_max timestamptz;
  r record;
begin
  if p_tenant is null or p_staff is null or p_start is null or p_end is null
    or not isfinite(p_start) or not isfinite(p_end) or p_end <= p_start then return false; end if;
  select s.availability_policy into v_policy from public.staff s
    where s.tenant_id=p_tenant and s.id=p_staff and s.active and s.bookable;
  if not found or v_policy is null or v_policy not in ('DEFAULT_AVAILABLE','EXPLICIT_ONLY') then return false; end if;
  select ts.basic into v_basic from public.tenant_settings ts where ts.tenant_id=p_tenant;
  -- A missing legacy settings row/key alone uses the canonical tenant default.
  if v_basic is not null and jsonb_typeof(v_basic) <> 'object' then return false; end if;
  if v_basic ? 'timezone' then
    if jsonb_typeof(v_basic->'timezone') <> 'string' then return false; end if;
    v_zone := btrim(v_basic->>'timezone');
  else v_zone := 'Asia/Taipei'; end if;
  -- 與 tenant_timezone_name 同一段查詢：不分大小寫比對並取 canonical 名稱；查不到維持回 false（不 raise）。
  select n.name into v_canonical from pg_catalog.pg_timezone_names n
   where lower(n.name)=lower(v_zone) order by (n.name=v_zone) desc, n.name limit 1;
  if v_zone is null or v_zone='' or v_canonical is null then return false; end if;
  v_zone := v_canonical;
  v_request := tstzrange(p_start,p_end,'[)');

  if exists (select 1 from public.bookings b where b.tenant_id=p_tenant and b.staff_id=p_staff
    and b.status in ('PENDING','CONFIRMED')
    and (b.end_at <= b.start_at or not isfinite(b.start_at) or not isfinite(b.end_at)
      or (b.start_at < p_end and b.end_at > p_start))) then return false; end if;

  -- UTC intervals in the cache are authoritative, including retained last-good
  -- events after ERROR. No invented freshness TTL or provider call here.
  if exists (select 1 from public.external_calendar_events e
    join public.external_calendars c on c.id=e.external_calendar_id
    where c.tenant_id=p_tenant and c.active and (c.staff_id is null or c.staff_id=p_staff)
    and (e.tenant_id<>p_tenant or e.end_at<=e.start_at
      or not isfinite(e.start_at) or not isfinite(e.end_at)
      or (e.start_at<p_end and e.end_at>p_start))) then return false; end if;
  if exists (select 1 from public.external_calendar_events e
    join public.external_calendars c on c.id=e.external_calendar_id
    where e.tenant_id=p_tenant and c.tenant_id<>p_tenant
      and c.active and (c.staff_id is null or c.staff_id=p_staff)) then return false; end if;

  if exists (select 1 from public.block_times b where b.tenant_id=p_tenant
    and (b.staff_id is null or b.staff_id=p_staff)
    and (b.end_at<=b.start_at or not isfinite(b.start_at) or not isfinite(b.end_at)
      or b.recurrence not in ('SINGLE','WEEKLY')
      or (b.recurrence='WEEKLY' and (b.day_of_week is null or b.day_of_week not between 0 and 6))
      or (b.recurrence='SINGLE' and b.start_at<p_end and b.end_at>p_start))) then return false; end if;

  -- Each local wall-clock interval is resolved in the tenant zone. PostgreSQL
  -- silently chooses offsets in gaps/folds; roundtrip and alternative-offset
  -- checks below reject those inputs instead of reporting available.
  for r in
    select 'SHIFT'::text kind, sh.work_date+sh.start_time local_start,
      sh.work_date+sh.end_time local_end, null::interval elapsed, false whole_day, true valid
      from public.shifts sh where sh.tenant_id=p_tenant and sh.staff_id=p_staff
        and v_policy='EXPLICIT_ONLY'
    union all
    select 'BLOCK', case when b.full_day then g.day::date::timestamp
        else g.day::date+(b.start_at at time zone v_zone)::time end,
      case when b.full_day then (g.day::date+1)::timestamp else null::timestamp end,
      case when b.full_day then null::interval else b.end_at-b.start_at end, b.full_day, true
      from public.block_times b
      cross join lateral generate_series(
        ((p_start at time zone v_zone)::date-ceil(extract(epoch from (b.end_at-b.start_at))/86400)::integer-2)::timestamp,
        ((p_end at time zone v_zone)::date)::timestamp, interval '1 day') g(day)
      where b.tenant_id=p_tenant and (b.staff_id is null or b.staff_id=p_staff)
        and b.recurrence='WEEKLY' and extract(dow from g.day)=b.day_of_week
        and g.day::date >= (b.start_at at time zone v_zone)::date
    union all
    select 'DEPARTURE', d.departs_on+coalesce(d.start_time,'00:00'::time),
      case when d.start_time is null or public.departure_effective_minutes(d.duration_minutes_snapshot, pl.duration_minutes, tr.duration_hours) is null
        then (d.departs_on+1)::timestamp else null::timestamp end,
      case when d.start_time is not null and public.departure_effective_minutes(d.duration_minutes_snapshot, pl.duration_minutes, tr.duration_hours) is not null
        then make_interval(mins=>public.departure_effective_minutes(d.duration_minutes_snapshot, pl.duration_minutes, tr.duration_hours)) else null::interval end,
      d.start_time is null or public.departure_effective_minutes(d.duration_minutes_snapshot, pl.duration_minutes, tr.duration_hours) is null,
      d.tenant_id=p_tenant and pl.tenant_id=p_tenant and pl.trip_id=d.trip_id
      from public.trip_departure_staff ds
      left join public.trip_departures d on d.id=ds.departure_id
      left join public.trip_plans pl on pl.id=d.plan_id
      left join public.trips tr on tr.id=d.trip_id and tr.tenant_id=d.tenant_id
      where ds.tenant_id=p_tenant and ds.staff_id=p_staff
        and (d.status is null or d.status<>'CANCELLED')
  loop
    if r.valid is distinct from true or r.local_start is null then return false; end if;
    -- Unknown duration is conservatively the tenant calendar day, not 24h UTC.
    if r.whole_day then r.local_start := r.local_start::date::timestamp; end if;
    if r.kind='SHIFT' and r.local_end<=r.local_start then return false; end if;
    -- A wall-time anomaly matters only if this row can affect the requested
    -- interval. Bound all offset candidates before rejecting gaps/folds: old
    -- or future ambiguous shifts/departures must not poison unrelated dates.
    -- Elapsed durations are retained, so multi-day occupancy is not truncated.
    for v_i in 1..(case when r.local_end is null then 1 else 2 end) loop
      v_local := case when v_i=1 then r.local_start else r.local_end end;
      select min(candidate.instant), max(candidate.instant) into v_min,v_max
        from unnest(array[v_local::date-1,v_local::date,v_local::date+1]) sample(day)
        cross join lateral (select sample.day::timestamp at time zone v_zone instant) observed
        cross join lateral (select (observed.instant at time zone v_zone)
          -(observed.instant at time zone 'UTC') utc_offset) offsets
        cross join lateral (select (v_local-offsets.utc_offset) at time zone 'UTC' instant) candidate;
      v_min := least(v_min,v_local at time zone v_zone);
      v_max := greatest(v_max,v_local at time zone v_zone);
      if v_i=1 then
        v_possible_start:=v_min;
        v_possible_end:=v_max+r.elapsed;
      else v_possible_end:=v_max; end if;
    end loop;
    if v_possible_end<=p_start or v_possible_start>=p_end then continue; end if;
    for v_i in 1..(case when r.local_end is null then 1 else 2 end) loop
      v_local := case when v_i=1 then r.local_start else r.local_end end;
      v_utc := v_local at time zone v_zone;
      if not isfinite(v_local) or (v_utc at time zone v_zone)<>v_local then return false; end if;
      -- Obtain actual offsets from the surrounding tenant calendar dates,
      -- rather than guessing a maximum number of repeated minutes. This also
      -- finds the +11/-12 offsets of the Kwajalein 1969 23-hour backward change.
      -- An offset is only evidence of ambiguity when its constructed UTC
      -- candidate roundtrips to this exact wall clock and differs from v_utc.
      if exists (
        select 1 from unnest(array[v_local::date-1,v_local::date,v_local::date+1]) sample(day)
        cross join lateral (select sample.day::timestamp at time zone v_zone instant) observed
        cross join lateral (select (observed.instant at time zone v_zone)
          -(observed.instant at time zone 'UTC') utc_offset) offsets
        cross join lateral (select (v_local-offsets.utc_offset) at time zone 'UTC' instant) candidate
        where candidate.instant<>v_utc and (candidate.instant at time zone v_zone)=v_local
      ) then return false; end if;
      if v_i=1 then v_start:=v_utc; else v_end:=v_utc; end if;
    end loop;
    if r.local_end is null then v_end:=v_start+r.elapsed; end if;
    if v_end is null or v_end<=v_start or not isfinite(v_end) then return false; end if;
    if r.kind='SHIFT' then v_shifts:=array_append(v_shifts,tstzrange(v_start,v_end,'[)'));
    elsif v_start<p_end and v_end>p_start then return false; end if;
  end loop;
  if v_policy='EXPLICIT_ONLY' then
    select range_agg(x) into v_coverage from unnest(v_shifts) x;
    return coalesce(v_request <@ v_coverage,false);
  end if;
  return true;
end;
$$;

revoke all on function public.guide_staff_interval_available(uuid,uuid,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.guide_staff_interval_available(uuid,uuid,timestamptz,timestamptz) to service_role;

-- ------------------------------------------------------------------ create_instant_tour_order
-- 全程單一交易：任一步 raise（含 PRICE_CHANGED／SEATS_UNAVAILABLE）整筆回滾，不留私人團或空單。
-- security invoker：由 service_role（公開 route 的 server）呼叫，不以函式 owner 放大權限（0136 教訓）。
create or replace function public.create_instant_tour_order(
  p_tenant          uuid,
  p_plan            uuid,
  p_starts_at       timestamptz,
  p_party_size      integer,
  p_customer        uuid,
  p_contact         jsonb,
  p_note            text,
  p_idempotency_key text,
  p_expected_total  numeric,
  p_order_no        text,
  p_source          public.tour_order_source,
  p_payment_method  uuid
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
declare
  v_plan    record;
  v_zone    text;
  v_local   timestamp;
  v_time    time;
  v_day     date;
  v_now     timestamptz := now();
  v_end     timestamptz;
  v_minutes integer;
  v_prev    record;
  v_slot    record;
  v_slot_found boolean;
  v_dep     uuid;
  v_order   uuid;
  v_hold    timestamptz;
begin
  if p_tenant is null or p_plan is null or p_starts_at is null or not isfinite(p_starts_at)
     or p_party_size is null or p_party_size < 1
     or p_order_no is null or length(btrim(p_order_no)) = 0
     or p_expected_total is null or p_expected_total < 0
     or p_idempotency_key is null or length(p_idempotency_key) not between 1 and 128 then
    raise exception 'INVALID_ARGUMENTS' using errcode = 'P0003';
  end if;

  v_zone := public.tenant_timezone_name(p_tenant);

  -- 冪等：同 (tenant, key) 序列化；已有訂單回原單（不重複扣名額、不重複建團）。
  perform pg_advisory_xact_lock(hashtextextended('instant-order:' || p_tenant::text || ':' || p_idempotency_key, 0));
  select o.id, o.plan_id, o.party_size, o.departure_id, o.hold_expires_at, o.total_amount,
         o.status, o.customer_id, o.contact, d.departs_on, d.start_time
    into v_prev
    from public.tour_orders o
    join public.trip_departures d on d.id = o.departure_id and d.tenant_id = o.tenant_id
   where o.tenant_id = p_tenant and o.idempotency_key = p_idempotency_key;
  if found then
    -- 同 key 必須是同一份請求：方案、人數、起始時刻、旅客確認的總額、客戶與聯絡資料皆一致；
    -- 否則 P0025。原訂單已取消（含逾期取消）時也回 P0025，不把已失效的單當成成功回給旅客，
    -- 讓呼叫端換新的 idempotency key 重新下單。
    if v_prev.plan_id <> p_plan or v_prev.party_size <> p_party_size
       or v_prev.start_time is null
       or ((v_prev.departs_on + v_prev.start_time) at time zone v_zone) <> p_starts_at
       or v_prev.total_amount <> p_expected_total
       or v_prev.customer_id is distinct from p_customer
       or v_prev.contact is distinct from coalesce(p_contact, '{}'::jsonb) then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0025', detail = 'REQUEST_MISMATCH';
    end if;
    if v_prev.status = 'CANCELLED' then
      raise exception 'IDEMPOTENCY_KEY_REUSED' using errcode = 'P0025', detail = 'ORDER_CANCELLED';
    end if;
    return jsonb_build_object('orderId', v_prev.id, 'departureId', v_prev.departure_id,
      'holdExpiresAt', v_prev.hold_expires_at, 'totalAmount', v_prev.total_amount,
      'status', v_prev.status, 'deduped', true);
  end if;

  select p.id, p.trip_id, p.sales_mode, p.participation_mode, p.active, p.max_party,
         p.duration_minutes, t.duration_hours, p.instant_start_times, p.instant_min_lead_minutes,
         p.instant_max_advance_days, p.instant_guide_staff_id, p.request_hold_hours,
         t.status as trip_status
    into v_plan
    from public.trip_plans p
    join public.trips t on t.id = p.trip_id and t.tenant_id = p.tenant_id
   where p.id = p_plan and p.tenant_id = p_tenant
   for share of p;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_plan.sales_mode <> 'INSTANT' or not v_plan.active or v_plan.trip_status <> 'PUBLISHED' then
    raise exception 'INSTANT_NOT_AVAILABLE' using errcode = 'P0023';
  end if;
  if v_plan.participation_mode <> 'PRIVATE' or v_plan.instant_start_times is null
     or cardinality(v_plan.instant_start_times) = 0 or v_plan.instant_guide_staff_id is null
     or v_plan.duration_minutes is null or v_plan.duration_minutes <= 0
     or v_plan.request_hold_hours is null or v_plan.request_hold_hours <= 0 then
    raise exception 'INSTANT_NOT_CONFIGURED' using errcode = 'P0024';
  end if;
  -- 最短提前量必須不小於付款保留時數：否則未付款的保留可能比出發時間還晚到期，導遊時段在出發後仍被占住。
  -- 選擇「拒絕設定」而非把 hold 截短到出發前，理由是截短會讓旅客看到比方案宣告更短的付款期限，
  -- 且需另開通知文案；由後台設定時就擋住較單純、可預期。
  if v_plan.instant_min_lead_minutes::numeric < v_plan.request_hold_hours * 60 then
    raise exception 'INSTANT_NOT_CONFIGURED' using errcode = 'P0024', detail = 'LEAD_LT_HOLD';
  end if;

  -- 起始時刻：租戶時區牆上時間必須整分、可往返、非 fold，且在方案清單內。
  v_local := p_starts_at at time zone v_zone;
  if v_local <> date_trunc('minute', v_local)
     or (v_local at time zone v_zone) is distinct from p_starts_at
     or public.instant_wall_clock_ambiguous(v_zone, v_local, p_starts_at) then
    raise exception 'INVALID_START' using errcode = 'P0021', detail = 'WALL_CLOCK';
  end if;
  v_time := v_local::time;
  v_day := v_local::date;
  if not (v_time = any (v_plan.instant_start_times)) then
    raise exception 'INVALID_START' using errcode = 'P0021', detail = 'NOT_IN_START_TIMES';
  end if;
  if p_starts_at < v_now + make_interval(mins => v_plan.instant_min_lead_minutes) then
    raise exception 'INVALID_START' using errcode = 'P0021', detail = 'LEAD_TIME';
  end if;
  if v_day > (v_now at time zone v_zone)::date + v_plan.instant_max_advance_days then
    raise exception 'INVALID_START' using errcode = 'P0021', detail = 'BEYOND_WINDOW';
  end if;

  -- 占用長度與全部占用判斷同一公式（departure_effective_minutes）；snapshot 也存這個值。
  v_minutes := public.departure_effective_minutes(null, v_plan.duration_minutes, v_plan.duration_hours);
  v_end := p_starts_at + make_interval(mins => v_minutes);

  -- 鎖序：團次列（若已存在）→ 導遊 advisory lock，與 trigger／replace_trip_departure_staff 一致，避免死結。
  perform 1 from public.trip_departures d
   where d.tenant_id = p_tenant and d.plan_id = p_plan and d.departs_on = v_day and d.start_time = v_time
   for update;
  -- 導遊鎖：與 constraint trigger 同一把 (tenant, staff) advisory lock，之後的檢查與寫入對所有 writer 序列化。
  perform public.lock_staff_occupancy(p_tenant, v_plan.instant_guide_staff_id);

  -- 取得導遊鎖後重讀（等鎖期間他人可能已提交同鍵團次）。
  select d.id, d.status, d.seats_booked into v_slot
    from public.trip_departures d
   where d.tenant_id = p_tenant and d.plan_id = p_plan and d.departs_on = v_day and d.start_time = v_time
   for update;
  v_slot_found := found;
  -- 只有「已取消、名額為 0、且該團下沒有任何非 CANCELLED 訂單」的同鍵團次才可重用；
  -- 否則（例如舊的 PENDING 且 seats_reserved=false 的申請單仍掛在上面）重用後取消 INSTANT 單，
  -- 團因仍有其他有效訂單而不會被釋放，導遊時段會永遠卡住。
  if v_slot_found and (v_slot.status <> 'CANCELLED' or v_slot.seats_booked <> 0
      or exists (select 1 from public.tour_orders o0
                  where o0.departure_id = v_slot.id and o0.tenant_id = p_tenant and o0.status <> 'CANCELLED')) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0022';
  end if;

  if not public.guide_staff_interval_available(p_tenant, v_plan.instant_guide_staff_id, p_starts_at, v_end) then
    raise exception 'STAFF_OCCUPIED' using errcode = 'P0020', detail = 'UNAVAILABLE';
  end if;

  if v_slot_found then
    -- unique (tenant, plan, departs_on, start_time) 不放寬：重用同鍵已取消的私人團。
    -- 先換導遊（團仍 CANCELLED，trigger 不檢查），最後 reopen 才由 trigger 重驗占用。
    v_dep := v_slot.id;
    update public.trip_departures
       set capacity = v_plan.max_party, seats_booked = 0,
           duration_minutes_snapshot = v_minutes,
           formation_status = 'FORMED', min_to_depart_snapshot = 1,
           formation_deadline_at = null, formed_at = v_now, formed_by = 'SYSTEM',
           formed_participants = p_party_size, instant_private = true
     where id = v_dep and tenant_id = p_tenant;
    perform public.replace_trip_departure_staff(p_tenant, v_dep, v_plan.instant_guide_staff_id, '{}'::uuid[]);
    update public.trip_departures set status = 'OPEN' where id = v_dep and tenant_id = p_tenant;
  else
    begin
      insert into public.trip_departures (
        tenant_id, trip_id, plan_id, departs_on, start_time, capacity, seats_booked, status, note,
        formation_status, min_to_depart_snapshot, formed_at, formed_by, formed_participants,
        duration_minutes_snapshot, instant_private
      ) values (
        p_tenant, v_plan.trip_id, p_plan, v_day, v_time, v_plan.max_party, 0, 'OPEN', '',
        'FORMED', 1, v_now, 'SYSTEM', p_party_size, v_minutes, true
      ) returning id into v_dep;
    exception when unique_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0022';
    end;
    perform public.replace_trip_departure_staff(p_tenant, v_dep, v_plan.instant_guide_staff_id, '{}'::uuid[]);
  end if;

  -- Q3：建單即 snapshot 保留期限（單一來源 trip_plans.request_hold_hours）。
  v_hold := v_now + (v_plan.request_hold_hours::double precision * interval '1 hour');
  v_order := public.create_tour_order_quoted(
    p_tenant, p_order_no, v_dep, p_party_size, p_customer, p_contact, p_source,
    p_payment_method, p_note, v_hold, p_expected_total
  );
  update public.tour_orders set idempotency_key = p_idempotency_key
   where id = v_order and tenant_id = p_tenant;

  -- 私人團：名額已由 create_tour_order 鎖住，關閉以免他人加入。
  update public.trip_departures set status = 'CLOSED' where id = v_dep and tenant_id = p_tenant;

  return jsonb_build_object('orderId', v_order, 'departureId', v_dep, 'holdExpiresAt', v_hold,
    'startsAt', p_starts_at, 'endsAt', v_end, 'status', 'PENDING', 'deduped', false);
end;
$$;

revoke all on function public.create_instant_tour_order(
  uuid, uuid, timestamptz, integer, uuid, jsonb, text, text, numeric, text, public.tour_order_source, uuid
) from public;
revoke all on function public.create_instant_tour_order(
  uuid, uuid, timestamptz, integer, uuid, jsonb, text, text, numeric, text, public.tour_order_source, uuid
) from anon, authenticated;
grant execute on function public.create_instant_tour_order(
  uuid, uuid, timestamptz, integer, uuid, jsonb, text, text, numeric, text, public.tour_order_source, uuid
) to service_role;

-- ------------------------------------------------------------------ update_trip_departure_with_staff
-- 後台 PATCH 同時改時間（或狀態）與導遊時的原子入口。分兩步寫入時，第一步會用「舊導遊」驗證新時間，
-- 舊導遊在新時間撞班就被擋，即使替換後的新導遊有空。這裡在同一交易內把兩個占用 constraint trigger 延後，
-- 依序更新團次與替換指派，再 SET CONSTRAINTS IMMEDIATE 立即以「最終狀態」（團次新時間＋新指派）一次驗證：
-- 延後的 trigger 在觸發當下才讀資料，看到的是更新後的團次與替換後的指派；失敗則整個 RPC 回滾（原時間與原指派保留）。
-- 鎖序：團次列（FOR UPDATE）→ 導遊 advisory lock（在 trigger 內取得），與其他入口一致。
-- 參數：p_departs_on／p_status 為 NULL＝不變；p_change_start_time＝false 時忽略 p_start_time（因為 NULL 是合法的時間值）；
-- p_replace_staff＝false 時不動指派（只改時間）。其他非占用欄位（名額、備註…）仍由呼叫端另行更新。
-- security invoker、僅 service_role。錯誤碼沿用：P0020 STAFF_OCCUPIED、P0002 DEPARTURE_NOT_FOUND／STAFF_NOT_FOUND、
-- P0003 DUPLICATE_STAFF_ASSIGNMENT。
create or replace function public.update_trip_departure_with_staff(
  p_tenant           uuid,
  p_departure        uuid,
  p_departs_on       date,
  p_change_start_time boolean,
  p_start_time       time,
  p_status           text,
  p_replace_staff    boolean,
  p_primary          uuid,
  p_assistants       uuid[]
) returns jsonb
language plpgsql security invoker set search_path = pg_catalog, public
as $$
begin
  if p_tenant is null or p_departure is null then
    raise exception 'INVALID_ARGUMENTS' using errcode = 'P0003';
  end if;
  perform 1 from public.trip_departures d
   where d.id = p_departure and d.tenant_id = p_tenant
   for update;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  set constraints public.trg_trip_departures_staff_occupancy, public.trg_trip_departure_staff_occupancy deferred;

  update public.trip_departures d
     set departs_on = coalesce(p_departs_on, d.departs_on),
         start_time = case when p_change_start_time then p_start_time else d.start_time end,
         status = coalesce(p_status::public.departure_status, d.status)
   where d.id = p_departure and d.tenant_id = p_tenant;

  if p_replace_staff then
    perform public.replace_trip_departure_staff(p_tenant, p_departure, p_primary, coalesce(p_assistants, '{}'::uuid[]));
  end if;

  -- 以最終狀態驗證：立即執行延後的 trigger，衝突在此 raise（整個 RPC 回滾）。
  set constraints public.trg_trip_departures_staff_occupancy, public.trg_trip_departure_staff_occupancy immediate;

  return jsonb_build_object('departureId', p_departure);
end;
$$;

revoke all on function public.update_trip_departure_with_staff(
  uuid, uuid, date, boolean, time, text, boolean, uuid, uuid[]
) from public;
revoke all on function public.update_trip_departure_with_staff(
  uuid, uuid, date, boolean, time, text, boolean, uuid, uuid[]
) from anon, authenticated;
grant execute on function public.update_trip_departure_with_staff(
  uuid, uuid, date, boolean, time, text, boolean, uuid, uuid[]
) to service_role;

-- ------------------------------------------------------------------ cancel／expire：釋放 INSTANT 私人團
-- 簽章與 0087／0100／0111 相同，本體以 0111 為基礎，僅在訂單取消後加「INSTANT 私人團無其他有效訂單 →
-- CANCELLED」。CANCELLED 的團不再被 0135 predicate／占用 trigger 視為占用，導遊時段重新可售。
-- release_seats 仍只在 seats_reserved 為真時呼叫（0111 B1），不重複釋放。
create or replace function public.cancel_tour_order(
  p_tenant uuid,
  p_order  uuid,
  p_reason text
) returns boolean as $$
declare
  v_order record;
begin
  select id, departure_id, party_size, status, seats_reserved into v_order
    from public.tour_orders
   where id = p_order and tenant_id = p_tenant
   for update;
  if not found then
    return false;
  end if;
  if v_order.status in ('CANCELLED', 'COMPLETED') then
    return false;
  end if;

  update public.tour_orders
     set status = 'CANCELLED',
         cancel_reason = coalesce(p_reason, ''),
         seats_reserved = false,
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  if v_order.seats_reserved then
    perform public.release_seats(v_order.departure_id, v_order.party_size);
  end if;

  update public.trip_departures d
     set status = 'CANCELLED'
   where d.id = v_order.departure_id and d.tenant_id = p_tenant and d.status <> 'CANCELLED'
     and d.instant_private
     and not exists (select 1 from public.tour_orders o2
                      where o2.departure_id = d.id and o2.tenant_id = d.tenant_id
                        and o2.status <> 'CANCELLED');
  return true;
end; $$ language plpgsql security definer set search_path = public;

create or replace function public.expire_tour_order(
  p_tenant uuid,
  p_order  uuid,
  p_reason text
) returns boolean as $$
declare
  v_order record;
begin
  select id, departure_id, party_size, seats_reserved into v_order
    from public.tour_orders
   where id = p_order
     and tenant_id = p_tenant
     and status = 'PENDING'
     and hold_expires_at is not null
     and hold_expires_at < now()
   for update;

  if not found then
    return false;
  end if;

  update public.tour_orders
     set status = 'CANCELLED',
         cancel_reason = coalesce(p_reason, ''),
         seats_reserved = false,
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  if v_order.seats_reserved then
    perform public.release_seats(v_order.departure_id, v_order.party_size);
  end if;

  update public.trip_departures d
     set status = 'CANCELLED'
   where d.id = v_order.departure_id and d.tenant_id = p_tenant and d.status <> 'CANCELLED'
     and d.instant_private
     and not exists (select 1 from public.tour_orders o2
                      where o2.departure_id = d.id and o2.tenant_id = d.tenant_id
                        and o2.status <> 'CANCELLED');
  return true;
end; $$ language plpgsql security definer set search_path = public;

-- ------------------------------------------------------------------ 後置斷言（PB-026／PB-033）
do $$
declare
  v_def text;
  v_n   int;
  v_bad text;
  r     record;
begin
  -- ① 三個 writer 的 trigger 都在，且是 constraint trigger。
  for r in select * from (values
    ('public.bookings'::regclass, 'trg_bookings_staff_occupancy'),
    ('public.trip_departure_staff'::regclass, 'trg_trip_departure_staff_occupancy'),
    ('public.trip_departures'::regclass, 'trg_trip_departures_staff_occupancy')
  ) as e(rel, tg) loop
    if not exists (select 1 from pg_trigger t where t.tgrelid = r.rel and t.tgname = r.tg
        and t.tgconstraint <> 0 and not t.tgisinternal and t.tgenabled <> 'D') then
      raise exception '0139 後置斷言失敗：% 未建立或未啟用', r.tg;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.trip_plans'::regclass
      and t.tgname = 'trg_trip_plans_instant_guide_same_tenant' and not t.tgisinternal) then
    raise exception '0139 後置斷言失敗：INSTANT 導遊同租戶 trigger 未建立';
  end if;
  if exists (select 1 from pg_constraint c where c.conrelid = 'public.trip_plans'::regclass
      and c.conname = 'trip_plans_instant_guide_staff_fk'
      and pg_get_constraintdef(c.oid) ~* 'tenant_id') then
    raise exception '0139 後置斷言失敗：INSTANT 導遊 FK 不得依賴 staff 複合 key';
  end if;
  if not exists (select 1 from pg_trigger t where t.tgrelid = 'public.trip_departures'::regclass
      and t.tgname = 'trg_trip_departures_duration_snapshot' and not t.tgisinternal) then
    raise exception '0139 後置斷言失敗：duration snapshot trigger 未建立';
  end if;

  -- ② RPC 唯一、security invoker、僅 service_role 可執行。
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'create_instant_tour_order';
  if v_n <> 1 then raise exception '0139 後置斷言失敗：create_instant_tour_order 應唯一，實際 %', v_n; end if;
  for r in select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'create_instant_tour_order' loop
    if r.prosecdef then raise exception '0139 後置斷言失敗：create_instant_tour_order 不得為 security definer'; end if;
    v_def := pg_get_functiondef(r.oid);
    if v_def !~* 'create_tour_order_quoted' or v_def !~* 'guide_staff_interval_available'
       or v_def !~* 'lock_staff_occupancy' or v_def !~* 'request_hold_hours'
       or v_def !~* 'replace_trip_departure_staff' or v_def !~* 'idempotency_key' then
      raise exception '0139 後置斷言失敗：create_instant_tour_order 本體缺少必要步驟';
    end if;
  end loop;

  -- ③ 0135 predicate 已改讀 snapshot，ACL 維持 service_role only。
  select pg_get_functiondef(p.oid) into v_def
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'guide_staff_interval_available'
     and p.proargtypes = array['uuid'::regtype::oid, 'uuid'::regtype::oid, 'timestamptz'::regtype::oid, 'timestamptz'::regtype::oid]::oidvector;
  if v_def is null or v_def !~* 'departure_effective_minutes' or v_def ~* 'make_interval\(mins=>pl\.duration_minutes' then
    raise exception '0139 後置斷言失敗：guide_staff_interval_available 未改用 departure_effective_minutes';
  end if;

  -- ④ cancel／expire 簽章唯一，且同時保留 seats_reserved 守門與 INSTANT 釋放。
  for r in select * from (values ('cancel_tour_order'), ('expire_tour_order')) as e(fn) loop
    select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_n <> 1 then raise exception '0139 後置斷言失敗：% 應唯一，實際 %', r.fn, v_n; end if;
    select pg_get_functiondef(p.oid) into v_def from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_def !~* 'seats_reserved' or v_def !~* 'instant_private' or v_def !~* '''CANCELLED''' then
      raise exception '0139 後置斷言失敗：% 缺少 seats_reserved 守門或 INSTANT 私人團釋放', r.fn;
    end if;
  end loop;

  -- ④b 原子改期＋改派 RPC：invoker、僅 service_role、含延後／立即驗證與團次列鎖。
  select count(*) into v_n from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'update_trip_departure_with_staff';
  if v_n <> 1 then raise exception '0139 後置斷言失敗：update_trip_departure_with_staff 應唯一，實際 %', v_n; end if;
  for r in select p.oid, p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and p.proname = 'update_trip_departure_with_staff' loop
    v_def := pg_get_functiondef(r.oid);
    if r.prosecdef or v_def !~* 'deferred' or v_def !~* 'immediate' or v_def !~* 'replace_trip_departure_staff'
       or v_def !~* 'for update' then
      raise exception '0139 後置斷言失敗：update_trip_departure_with_staff 本體或屬性不符';
    end if;
  end loop;

  -- ⑤ 冪等唯一索引存在。
  if not exists (select 1 from pg_indexes where schemaname = 'public' and tablename = 'tour_orders'
      and indexname = 'ux_tour_orders_tenant_idempotency') then
    raise exception '0139 後置斷言失敗：ux_tour_orders_tenant_idempotency 不存在';
  end if;
  -- ⑥ ACL：五支 RPC 只給 service_role。以 ACL 本身判斷（proacl 為 NULL 時套用 acldefault('f', owner)，
  -- 即 PUBLIC 預設可執行），不呼叫 has_function_privilege：PUBLIC（grantee 0）、anon、authenticated
  -- 與其所屬角色（pg_auth_members 一層）任一有 EXECUTE 即失敗；service_role 必須（直接或經 PUBLIC）有 EXECUTE。
  select string_agg(p.proname, ', ' order by p.proname) into v_bad
    from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('create_instant_tour_order', 'guide_staff_interval_available', 'cancel_tour_order',
                       'expire_tour_order', 'update_trip_departure_with_staff')
     and (p.proname <> 'guide_staff_interval_available'
          or p.proargtypes = array['uuid'::regtype::oid, 'uuid'::regtype::oid, 'timestamptz'::regtype::oid, 'timestamptz'::regtype::oid]::oidvector)
     and (exists (select 1
                    from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                   where a.privilege_type = 'EXECUTE'
                     and (a.grantee = 0
                          or a.grantee in (select ro.oid from pg_catalog.pg_roles ro
                                            where ro.rolname in ('anon', 'authenticated'))
                          or a.grantee in (select m.roleid from pg_catalog.pg_auth_members m
                                             join pg_catalog.pg_roles ro on ro.oid = m.member
                                            where ro.rolname in ('anon', 'authenticated'))))
          or not exists (select 1
                           from pg_catalog.aclexplode(coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
                          where a.privilege_type = 'EXECUTE'
                            and (a.grantee = 0
                                 or a.grantee in (select ro.oid from pg_catalog.pg_roles ro
                                                   where ro.rolname = 'service_role'))));
  if v_bad is not null then
    raise exception '0139 後置斷言失敗：ACL 必須只給 service_role（anon／authenticated／PUBLIC 不得執行）：%', v_bad;
  end if;
end $$;

commit;
