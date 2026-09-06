-- 0026_tour_departures_addons_orders.sql — Phase 8b：團次／加購／旅遊訂單
--
-- 0016 只建了 trips 與 trip_plans，並在檔頭寫明「團次（trip_departures）、
-- 加購（trip_addons）、旅遊訂單（tour_orders）與導遊金流留在 Phase 8b」。
-- 這一檔就是那個 Phase 8b 的前段（issue #8）；導遊金流（tenant_payment_methods
-- 與綠界模組）仍留在 issue #9。
--
-- 依 10 分冊 §1（schema）、§2（名額原子扣減）、§3（訂單生命週期）。
-- 與 10 分冊原文的差異，逐條說明（不是筆誤，是對照現有程式碼後的調整）：
--
--   1. `trip_addons` 10 分冊 §1 沒有寫 schema（§5 的 2026-08-24 補記才承認
--      「原規格漏列」）。欄位依 `src/lib/types.ts` 的 `TripAddon` 型別與
--      `/tenant/trips/[id]` 加購分頁的表單欄位反推：name / price / unit /
--      stock（null = 不限量）/ active / sort_order。
--
--   2. `tour_orders.payment_method_id` **不加外鍵**。10 分冊 §1 註解寫
--      「→ tenant_payment_methods」，但那張表屬 10 分冊 §4（Phase 8c，issue #9），
--      現在不存在。加外鍵會讓這個 migration 直接失敗。等 #9 建表後再補
--      `alter table ... add constraint`。
--      同理 `payment_method_label` **不存在**：收款方式的顯示名稱只能來自
--      那張還沒有的表，現在編一個字串出來就是捏造已知，所以 mapper 一律回
--      空字串，畫面顯示「未設定」。
--
--   3. `traveler_user_id` 不加外鍵（10 分冊原文亦然）：旅客帳號在 auth.users，
--      跨 schema 外鍵在 Supabase 會讓 service-role 之外的操作變麻煩，
--      且 11 分冊的旅客共用帳號尚未實作。
--
--   4. 10 分冊 §1 的 `unit_price` 與 `total_amount` 之外，另存
--      `deposit_amount`（§1 自己在註解裡要求「tour_orders 加
--      `deposit_amount numeric not null default 0`」）與 `note`
--      （`TourOrder.note`，10 分冊把它塞在 `contact jsonb` 裡；這裡拆成獨立
--      欄位，因為後台列表與詳情都直接顯示它，塞進 jsonb 只會讓查詢變麻煩）。
--      `contact` 仍保留，供 11 分冊的公開 checkout 寫入完整快照。

-- ---------------------------------------------------------------- enums
create type departure_status   as enum ('OPEN','CLOSED','CANCELLED');
create type tour_order_status  as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED');
create type tour_payment_status as enum ('UNPAID','PAID','REFUNDED');
create type tour_order_source  as enum ('MIDAO','VIBEAI_SHOP','LINE','MANUAL');

-- --------------------------------------------------------------- 團次
create table trip_departures (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  trip_id      uuid not null references trips(id) on delete cascade,
  plan_id      uuid not null references trip_plans(id) on delete cascade,
  departs_on   date not null,
  start_time   time,
  capacity     int not null,
  seats_booked int not null default 0,
  status       departure_status not null default 'OPEN',
  note         text not null default '',
  created_at   timestamptz not null default now(),
  -- ★ 超賣的最後防線（10 分冊 §1）：即使應用層與 rpc 全部寫錯，DB 仍擋得住
  constraint trip_departures_seats_within_capacity
    check (seats_booked >= 0 and seats_booked <= capacity),
  unique (tenant_id, plan_id, departs_on, start_time)
);
create index trip_departures_tenant_trip_idx on trip_departures (tenant_id, trip_id, departs_on);

-- --------------------------------------------------------------- 加購
create table trip_addons (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  trip_id    uuid not null references trips(id) on delete cascade,
  name       text not null,
  price      numeric not null default 0,
  -- 與 trip_plans.price_type 同一組值（types.ts 的 PriceType）
  unit       text not null default 'PER_PERSON'
    check (unit in ('PER_PERSON','PER_GROUP')),
  stock      int,                                    -- null = 不限量
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (stock is null or stock >= 0)
);
create index trip_addons_trip_idx on trip_addons (tenant_id, trip_id, sort_order);

-- ----------------------------------------------------------- 旅遊訂單
create table tour_orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  order_no          text not null,                   -- 'T' + yymmdd + 4 碼流水
  trip_id           uuid not null references trips(id) on delete restrict,
  plan_id           uuid not null references trip_plans(id) on delete restrict,
  departure_id      uuid not null references trip_departures(id) on delete restrict,
  customer_id       uuid references customers(id) on delete set null,
  traveler_user_id  uuid,
  customer_name     text not null default '',
  customer_phone    text not null default '',
  party_size        int not null check (party_size > 0),
  unit_price        numeric not null default 0,      -- 下單當下快照
  total_amount      numeric not null default 0,
  deposit_amount    numeric not null default 0,      -- 已收定金；待收尾款 = total - deposit
  contact           jsonb not null default '{}',     -- {name, phone, email, note} 快照
  note              text not null default '',
  status            tour_order_status not null default 'PENDING',
  payment_status    tour_payment_status not null default 'UNPAID',
  payment_method_id uuid,                            -- → tenant_payment_methods（#9 才建表，暫無 FK）
  payment_ref       text not null default '',
  source            tour_order_source not null,
  hold_expires_at   timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, order_no)
);
create index tour_orders_tenant_status_idx on tour_orders (tenant_id, status, created_at desc);
create index tour_orders_departure_idx on tour_orders (departure_id);
create index tour_orders_traveler_idx on tour_orders (traveler_user_id)
  where traveler_user_id is not null;

-- ------------------------------------------------- 名額原子扣減（10 §2）
--
-- 一句 UPDATE 完成「檢查餘額 + 扣名額」。並發下 Postgres 對同一列的 UPDATE
-- 會互相排隊，後到的那筆在取得鎖之後重讀最新的 seats_booked，因此
-- `seats_booked + p_count <= capacity` 這個條件不會被兩筆同時通過。
create or replace function reserve_seats(p_departure uuid, p_count int) returns void as $$
begin
  update trip_departures
     set seats_booked = seats_booked + p_count
   where id = p_departure and status = 'OPEN'
     and seats_booked + p_count <= capacity;
  if not found then
    raise exception 'SEATS_UNAVAILABLE' using errcode = 'P0001';
  end if;
end; $$ language plpgsql security definer set search_path = public;

create or replace function release_seats(p_departure uuid, p_count int) returns void as $$
begin
  update trip_departures set seats_booked = greatest(seats_booked - p_count, 0)
   where id = p_departure;
end; $$ language plpgsql security definer set search_path = public;

revoke execute on function reserve_seats(uuid, int) from anon, authenticated;
revoke execute on function release_seats(uuid, int) from anon, authenticated;

-- 訂單編號：'T' + yymmdd + 4 碼流水（租戶內、當日連號）。
-- unique (tenant_id, order_no) 是最後防線；同一秒兩筆並發時第二筆會撞唯一鍵，
-- 由 create_tour_order 的重試迴圈處理。
create or replace function next_tour_order_no(p_tenant uuid, p_day date) returns text as $$
declare
  v_prefix text := 'T' || to_char(p_day, 'YYMMDD');
  v_seq    int;
begin
  select coalesce(max(substring(order_no from 8 for 4)::int), 0) + 1
    into v_seq
    from tour_orders
   where tenant_id = p_tenant
     and order_no like v_prefix || '%'
     and substring(order_no from 8 for 4) ~ '^[0-9]{4}$';
  return v_prefix || lpad(v_seq::text, 4, '0');
end; $$ language plpgsql security definer set search_path = public;

-- 建單 + 佔名額，同一交易（10 §2 規約，寫法比照 09 分冊 subscribe_feature）。
-- 金額一律由後端依 trip_plans 現值計算——前端送來的價格不採信。
create or replace function create_tour_order(
  p_tenant         uuid,
  p_departure      uuid,
  p_party          int,
  p_customer_name  text,
  p_customer_phone text,
  p_source         tour_order_source,
  p_note           text default '',
  p_payment_method uuid default null,
  p_customer       uuid default null,
  p_hold_expires   timestamptz default null
) returns uuid as $$
declare
  v_dep     trip_departures%rowtype;
  v_plan    trip_plans%rowtype;
  v_total   numeric;
  v_deposit numeric;
  v_no      text;
  v_id      uuid;
  v_try     int := 0;
begin
  if p_party is null or p_party < 1 then
    raise exception 'PARTY_INVALID' using errcode = 'P0001';
  end if;

  -- FOR UPDATE：把同一團次的並發建單排成序列，讓下面的計價與 reserve_seats
  -- 讀到的是同一份、已鎖住的列。
  select * into v_dep from trip_departures
   where id = p_departure and tenant_id = p_tenant for update;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_plan from trip_plans
   where id = v_dep.plan_id and tenant_id = p_tenant;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_party > v_plan.max_participants then
    raise exception 'PARTY_OVER_MAX' using errcode = 'P0001';
  end if;

  perform reserve_seats(p_departure, p_party);

  v_total := case when v_plan.price_type = 'PER_PERSON'
                  then v_plan.base_price * p_party
                  else v_plan.base_price end;

  v_deposit := case v_plan.deposit_mode
    when 'DEPOSIT_FIXED' then
      case when v_plan.price_type = 'PER_PERSON'
           then v_plan.deposit_value * p_party
           else v_plan.deposit_value end
    when 'DEPOSIT_PERCENT' then round(v_total * v_plan.deposit_value / 100)
    else 0
  end;

  loop
    v_try := v_try + 1;
    v_no := next_tour_order_no(p_tenant, (now() at time zone 'Asia/Taipei')::date);
    begin
      insert into tour_orders (
        tenant_id, order_no, trip_id, plan_id, departure_id, customer_id,
        customer_name, customer_phone, party_size, unit_price, total_amount,
        deposit_amount, contact, note, status, payment_status,
        payment_method_id, source, hold_expires_at
      ) values (
        p_tenant, v_no, v_dep.trip_id, v_dep.plan_id, p_departure, p_customer,
        coalesce(p_customer_name, ''), coalesce(p_customer_phone, ''), p_party,
        v_plan.base_price, v_total, v_deposit,
        jsonb_build_object('name', coalesce(p_customer_name, ''),
                           'phone', coalesce(p_customer_phone, ''),
                           'note', coalesce(p_note, '')),
        coalesce(p_note, ''), 'PENDING', 'UNPAID',
        p_payment_method, p_source, p_hold_expires
      ) returning id into v_id;
      return v_id;
    exception when unique_violation then
      if v_try >= 5 then raise; end if;
    end;
  end loop;
end; $$ language plpgsql security definer set search_path = public;

revoke execute on function next_tour_order_no(uuid, date) from anon, authenticated;
revoke execute on function create_tour_order(
  uuid, uuid, int, text, text, tour_order_source, text, uuid, uuid, timestamptz
) from anon, authenticated;

-- ------------------------------------------------------------------ RLS
alter table trip_departures enable row level security;
alter table trip_addons     enable row level security;
alter table tour_orders     enable row level security;

create policy p_trip_departures_s on trip_departures for select using (is_tenant_member(tenant_id));
create policy p_trip_departures_i on trip_departures for insert with check (is_tenant_member(tenant_id));
create policy p_trip_departures_u on trip_departures for update using (is_tenant_member(tenant_id));
create policy p_trip_departures_d on trip_departures for delete using (is_tenant_member(tenant_id));

create policy p_trip_addons_s on trip_addons for select using (is_tenant_member(tenant_id));
create policy p_trip_addons_i on trip_addons for insert with check (is_tenant_member(tenant_id));
create policy p_trip_addons_u on trip_addons for update using (is_tenant_member(tenant_id));
create policy p_trip_addons_d on trip_addons for delete using (is_tenant_member(tenant_id));

create policy p_tour_orders_s on tour_orders for select using (is_tenant_member(tenant_id));
create policy p_tour_orders_i on tour_orders for insert with check (is_tenant_member(tenant_id));
create policy p_tour_orders_u on tour_orders for update using (is_tenant_member(tenant_id));
create policy p_tour_orders_d on tour_orders for delete using (is_tenant_member(tenant_id));
