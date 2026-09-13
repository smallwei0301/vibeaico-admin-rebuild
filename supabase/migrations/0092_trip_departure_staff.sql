-- 0092 — 團次實際執行人員（issue #37 §1 的前半：trip_departure_staff）
-- =============================================================================
-- 在此之前，`trip_departures` 沒有任何「誰帶這團」的欄位。團次照樣開得成、照樣
-- 收得到報名，但**沒有任何一位導遊被指派**，而導遊自己的一般服務預約與這團之間
-- 也沒有任何防撞——同一個人可以在同一個時段被排進一場一般預約與兩個團次，三邊
-- 都不會有任何錯誤。這不是「功能還沒建好」，是已經開得出撞班的班表。
--
-- 依 `docs/integration/10-TOUR-DOMAIN.md` §1.3（Owner 2026-08-27 裁示）：
--
--   * 不在 `trip_departures` 塞單一 `staff_id`——一團有一位 PRIMARY 主導遊，
--     外加 0..N 位 ASSISTANT 協同導遊，塞不進一個欄位。
--   * 每團最多一位 PRIMARY，用 **partial unique index** 表達，不是靠應用層自律。
--   * 同團同人不得重複（不能既是 PRIMARY 又是 ASSISTANT）。
--
-- ⚠️ 相容策略（§1.3 逐字）：既有團次可暫時誠實顯示「未指派」。本檔**不替任何
-- 舊團次假造主導遊**——沒有真的指派過的團次就是沒有，補一個猜的進去會讓「未指派」
-- 這個真實狀態永遠消失，之後也分不出哪些是真的指派、哪些是 migration 掰的。
--
-- ⚠️ 本檔只建表，不建 `tenant.guide_mode` / `SOLO` / `TEAM` 或任何等價的永久模式
-- 欄位（issue #37 §1 明文禁止）。單人／團隊是 UI 依 active+bookable 導遊數量自動
-- 適應的結果，不是另一套資料模型。

-- --------------------------------------------------------------------- 角色
do $$
begin
  if not exists (select 1 from pg_type where typname = 'departure_staff_role') then
    create type departure_staff_role as enum ('PRIMARY', 'ASSISTANT');
  end if;
end $$;

-- --------------------------------------------------------------------- 建表
create table if not exists public.trip_departure_staff (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references public.tenants(id)         on delete cascade,
  departure_id uuid not null references public.trip_departures(id) on delete cascade,
  -- on delete restrict：停用導遊不刪歷史指派（issue #37 §3「停用導遊不刪歷史
  -- assignment、訂單與業績」）。要真的刪掉一位 staff，得先處理他帶過的團。
  staff_id     uuid not null references public.staff(id)           on delete restrict,
  role         departure_staff_role not null,
  created_at   timestamptz not null default now(),
  unique (tenant_id, departure_id, staff_id)
);

-- ⚠️ PB-026：`create table if not exists` 遇到「同名但形狀不同」的既有表會**靜默
-- 跳過**，於是後面的索引與程式對著一張少了欄位的表建立，錯誤要等到執行期才出現。
-- 這一段把那個靜默跳過變成大聲失敗。
do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id','uuid'), ('departure_id','uuid'), ('staff_id','uuid'),
      ('role','USER-DEFINED'), ('created_at','timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'trip_departure_staff'
       and column_name  = r.col;
    if v_actual is null then
      raise exception 'trip_departure_staff.% 不存在——0092 的建表被靜默跳過了', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'trip_departure_staff.% 的型別是 %，預期 %——既有表與本 migration 形狀不一致',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.trip_departure_staff'::regclass
       and contype  = 'u'
       and pg_get_constraintdef(oid) like '%(tenant_id, departure_id, staff_id)%'
  ) then
    raise exception 'trip_departure_staff 缺少 (tenant_id, departure_id, staff_id) 唯一約束——同團同人可重複指派';
  end if;
end $$;

-- 「每團最多一位 PRIMARY」。這是 partial unique index 而不是應用層檢查，因為兩個
-- 管理者同時儲存時，應用層的「先查再寫」擋不住任何東西（#218 / #292 都踩過這個
-- 形狀）。指派程式仍會先查一次以便回出可讀的錯誤訊息，但真正的保證在這一行。
create unique index if not exists one_primary_staff_per_departure
  on public.trip_departure_staff (departure_id)
  where role = 'PRIMARY';

do $$
begin
  if not exists (
    select 1 from pg_index i
      join pg_class c on c.oid = i.indexrelid
     where c.relname = 'one_primary_staff_per_departure'
       and i.indisunique
       and i.indpred is not null
  ) then
    raise exception 'one_primary_staff_per_departure 不是 partial unique index——一團可以有兩位主導遊';
  end if;
end $$;

-- 撞班查詢的方向是「這位員工在這段期間被指派到哪些團」，起點是 staff 而不是
-- departure，所以唯一約束的前綴（tenant_id, departure_id）幫不上忙。
create index if not exists ix_trip_departure_staff_staff
  on public.trip_departure_staff (tenant_id, staff_id);

comment on table public.trip_departure_staff is
  '團次實際執行人員。每團最多一位 PRIMARY（partial unique index 保證），ASSISTANT 不限；PRIMARY 與 ASSISTANT 都占用該員工的時間。';

-- ----------------------------------------------------------------------- RLS
alter table public.trip_departure_staff enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
     where p.polrelid = 'public.trip_departure_staff'::regclass
       and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%is_tenant_member(tenant_id)%'
  ) then
    create policy trip_departure_staff_tenant on public.trip_departure_staff
      for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
  end if;
end $$;
