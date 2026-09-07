-- Phase 8b / #8-B: tour orders, atomic seat reservation, and order lifecycle.
--
-- 這一支補的是 #8 驗收清單裡「單一根因」的那張表。在它之前，`main` 上：
--   * `tour_orders` 表與 `reserve_seats` rpc **完全不存在**（git grep 零命中）
--   * `/tenant/tour-orders` 頁早就接好四支寫入 service，端點卻全部 404
--     ——接線在、鏈路不通
--   * webhook 的「我的訂單」誠實回「準備中」，因為沒有任何地方查得到旅遊訂單
--
-- Contract: docs/integration/10-TOUR-DOMAIN.md §1.1（schema）、§2（名額原子扣減）、
-- §3（訂單生命週期與名額保留）。
--
-- 與 0066 一樣採「加法且可重入」寫法：TEST 可能已存在歷史 #37/#41 的同名物件，
-- 這裡一律 if-not-exists / create-or-replace，不 drop 任何既有欄位或政策。

-- ---------------------------------------------------------------- 列舉型別
-- 標籤是 canonical；既有列舉保留，只補缺少的標籤，永不移除標籤（同 0066 慣例）。
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_order_status'
  ) then
    create type public.tour_order_status as enum ('PENDING', 'CONFIRMED', 'COMPLETED', 'CANCELLED');
  else
    execute 'alter type public.tour_order_status add value if not exists ''PENDING''';
    execute 'alter type public.tour_order_status add value if not exists ''CONFIRMED''';
    execute 'alter type public.tour_order_status add value if not exists ''COMPLETED''';
    execute 'alter type public.tour_order_status add value if not exists ''CANCELLED''';
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_payment_status'
  ) then
    create type public.tour_payment_status as enum ('UNPAID', 'PAID', 'REFUNDED');
  else
    execute 'alter type public.tour_payment_status add value if not exists ''UNPAID''';
    execute 'alter type public.tour_payment_status add value if not exists ''PAID''';
    execute 'alter type public.tour_payment_status add value if not exists ''REFUNDED''';
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
     where n.nspname = 'public' and t.typname = 'tour_order_source'
  ) then
    create type public.tour_order_source as enum ('MIDAO', 'VIBEAI_SHOP', 'LINE', 'MANUAL');
  else
    execute 'alter type public.tour_order_source add value if not exists ''MIDAO''';
    execute 'alter type public.tour_order_source add value if not exists ''VIBEAI_SHOP''';
    execute 'alter type public.tour_order_source add value if not exists ''LINE''';
    execute 'alter type public.tour_order_source add value if not exists ''MANUAL''';
  end if;
end $$;

-- -------------------------------------------------------------- tour_orders
create table if not exists public.tour_orders (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references public.tenants(id) on delete cascade,
  order_no          text not null,
  trip_id           uuid not null references public.trips(id) on delete restrict,
  plan_id           uuid not null references public.trip_plans(id) on delete restrict,
  departure_id      uuid not null references public.trip_departures(id) on delete restrict,
  customer_id       uuid references public.customers(id) on delete set null,
  traveler_user_id  uuid,
  party_size        int not null check (party_size >= 1),
  unit_price        numeric not null,
  total_amount      numeric not null,
  deposit_amount    numeric not null default 0,
  contact           jsonb not null default '{}',
  status            public.tour_order_status not null default 'PENDING',
  payment_status    public.tour_payment_status not null default 'UNPAID',
  payment_method_id uuid,
  payment_ref       text not null default '',
  source            public.tour_order_source not null,
  -- `note` 不在 10 分冊 §1.1 的 SQL 區塊裡，但 `TourOrder`（src/lib/types.ts）有這個
  -- 欄位、手動建單視窗也有輸入框。少了它，店員打的備註會在送出時被靜默丟掉。
  note              text not null default '',
  hold_expires_at   timestamptz,
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (tenant_id, order_no)
);

-- ---------------------------------------------------------- 實收金額
-- `payment_status = 'PAID'` 必須代表**錢真的收齊了**，不能只是翻一個旗標。
--
-- 這一段是被 CI 抓出來的：整合測試的 local-isolated 會套用 historical overlay，
-- 而 overlay 的 `tour_orders` 帶著 `#41` 加上的
-- `check (payment_status <> 'PAID' or paid_amount = total_amount)`。
-- 初版的 confirm-payment 只寫 `payment_status = 'PAID'`、沒有寫金額，於是 23514。
--
-- **那個約束是對的，繞過它才是錯的**：一筆「已付款」而實收 0 元的訂單，正是本專案
-- 一直在修的那種假宣稱——畫面說收到錢了，資料庫裡沒有任何金額佐證。所以 canonical
-- 這邊把同一個不變量補上，而不是把測試改成接受它。
--
-- ⚠️ 只補 `paid_amount` 一欄。overlay 的完整付款模型（upfront_required_amount /
-- refunded_amount / deposit_mode_snapshot / PARTIAL 與 REFUND_PENDING 狀態）屬 #41
-- 的散客併團生命週期，不在本切片範圍；把它整包搬過來會變成兩個 issue 各寫一半。
alter table public.tour_orders
  add column if not exists paid_amount numeric not null default 0;

-- 約束只在 historical 版本不存在時才建：兩邊同時掛會變成同一條規則有兩份定義，
-- 日後只改了一邊就會出現「兩個約束互相矛盾」的死結。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_payment_amounts_nonnegative'
  ) and not exists (
    select 1 from pg_constraint
     where conrelid = 'public.tour_orders'::regclass
       and conname = 'tour_orders_paid_amount_consistent'
  ) then
    alter table public.tour_orders
      add constraint tour_orders_paid_amount_consistent
      check (
        paid_amount >= 0
        and paid_amount <= total_amount
        and (payment_status <> 'PAID' or paid_amount = total_amount)
      );
  end if;
end $$;

create index if not exists i_tour_orders on public.tour_orders (tenant_id, status, created_at desc);
create index if not exists i_tour_orders_traveler on public.tour_orders (traveler_user_id)
  where traveler_user_id is not null;
-- 逾期釋位 cron 只掃「PENDING 且已過期」，沒有這個索引就得全表掃描。
create index if not exists i_tour_orders_hold on public.tour_orders (hold_expires_at)
  where hold_expires_at is not null;

-- ------------------------------------------------------------ 名額原子扣減
-- 10 分冊 §2：**禁止在應用層算庫存**。「先 select 剩餘名額、再 update」在兩個請求
-- 同時搶最後一席時兩邊都會讀到 1、兩邊都成功，於是超賣。下面這個 update 把「檢查」
-- 與「扣減」放進同一個語句，由 Postgres 的 row lock 保證只有一個會 found。
create or replace function public.reserve_seats(p_departure uuid, p_count int)
returns void as $$
begin
  update public.trip_departures
     set seats_booked = seats_booked + p_count
   where id = p_departure and status = 'OPEN'
     and seats_booked + p_count <= capacity;
  if not found then
    raise exception 'SEATS_UNAVAILABLE' using errcode = 'P0001';
  end if;
end; $$ language plpgsql security definer set search_path = public;

create or replace function public.release_seats(p_departure uuid, p_count int)
returns void as $$
begin
  update public.trip_departures
     set seats_booked = greatest(seats_booked - p_count, 0)
   where id = p_departure;
end; $$ language plpgsql security definer set search_path = public;

-- 建立訂單與扣名額**必須同一交易**（10 分冊 §2）。分成兩次呼叫的話，扣完名額後
-- 建單失敗會留下一個沒有訂單卻被佔住的席次，而且沒有任何地方查得到它——名額就這樣
-- 慢慢漏光，店家只會看到「明明沒人報名卻顯示滿團」。plpgsql 函式本身就是一個交易。
create or replace function public.create_tour_order(
  p_tenant        uuid,
  p_order_no      text,
  p_departure     uuid,
  p_party_size    int,
  p_customer      uuid,
  p_contact       jsonb,
  p_source        public.tour_order_source,
  p_payment_method uuid,
  p_note          text,
  p_hold_expires  timestamptz
) returns uuid as $$
declare
  v_dep     record;
  v_plan    record;
  v_unit    numeric;
  v_total   numeric;
  v_deposit numeric;
  v_id      uuid;
begin
  -- 團次與方案都必須屬於同一個租戶：這支函式是 security definer，繞過了 RLS，
  -- 所以租戶隔離必須在這裡自己做，不能倚賴呼叫端。
  select d.id, d.trip_id, d.plan_id into v_dep
    from public.trip_departures d
   where d.id = p_departure and d.tenant_id = p_tenant;
  if not found then
    raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002';
  end if;

  select p.price_per_person, p.deposit_mode, p.deposit_value, p.min_party, p.max_party
    into v_plan
    from public.trip_plans p
   where p.id = v_dep.plan_id and p.tenant_id = p_tenant;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_party_size < v_plan.min_party or p_party_size > v_plan.max_party then
    raise exception 'PARTY_SIZE_OUT_OF_RANGE' using errcode = 'P0003';
  end if;

  v_unit  := v_plan.price_per_person;
  v_total := v_unit * p_party_size;
  v_deposit := case v_plan.deposit_mode
    when 'DEPOSIT_FIXED'   then least(v_plan.deposit_value, v_total)
    when 'DEPOSIT_PERCENT' then round(v_total * v_plan.deposit_value / 100.0)
    else 0
  end;

  -- 先扣名額再建單：扣不到就 raise，整個交易回滾，不會留下 PENDING 的空單。
  perform public.reserve_seats(p_departure, p_party_size);

  insert into public.tour_orders (
    tenant_id, order_no, trip_id, plan_id, departure_id, customer_id,
    party_size, unit_price, total_amount, deposit_amount, contact,
    source, payment_method_id, note, hold_expires_at
  ) values (
    p_tenant, p_order_no, v_dep.trip_id, v_dep.plan_id, p_departure, p_customer,
    p_party_size, v_unit, v_total, v_deposit, coalesce(p_contact, '{}'::jsonb),
    p_source, p_payment_method, coalesce(p_note, ''), p_hold_expires
  ) returning id into v_id;

  return v_id;
end; $$ language plpgsql security definer set search_path = public;

-- 取消／過期釋放名額也要同交易改訂單狀態（10 分冊 §2）。分開做的話，釋放成功但
-- 訂單沒改成 CANCELLED，下一輪 cron 會再釋放一次同一筆——名額憑空多出來。
create or replace function public.cancel_tour_order(
  p_tenant uuid,
  p_order  uuid,
  p_reason text
) returns boolean as $$
declare
  v_order record;
begin
  select id, departure_id, party_size, status into v_order
    from public.tour_orders
   where id = p_order and tenant_id = p_tenant
   for update;
  if not found then
    return false;
  end if;
  -- 已取消／已完成的單不重複釋放名額。這個守門就是上面那段註解說的「再釋放一次」。
  if v_order.status in ('CANCELLED', 'COMPLETED') then
    return false;
  end if;

  update public.tour_orders
     set status = 'CANCELLED',
         cancel_reason = coalesce(p_reason, ''),
         updated_at = now()
   where id = p_order and tenant_id = p_tenant;

  perform public.release_seats(v_order.departure_id, v_order.party_size);
  return true;
end; $$ language plpgsql security definer set search_path = public;

-- 這四支都是 security definer（繞過 RLS），只能由 server route 的 service_role
-- 呼叫。任何前端持有的 anon／authenticated token 都不得直接執行——否則顧客可以
-- 自己扣別家店的名額。
revoke execute on function public.reserve_seats(uuid, int) from anon, authenticated;
revoke execute on function public.release_seats(uuid, int) from anon, authenticated;
revoke execute on function public.create_tour_order(
  uuid, text, uuid, int, uuid, jsonb, public.tour_order_source, uuid, text, timestamptz
) from anon, authenticated;
revoke execute on function public.cancel_tour_order(uuid, uuid, text) from anon, authenticated;

-- --------------------------------------------------------------- RLS / ACL
alter table public.tour_orders enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy p
     where p.polrelid = 'public.tour_orders'::regclass
       and coalesce(pg_get_expr(p.polqual, p.polrelid), '') ilike '%is_tenant_member(tenant_id)%'
  ) then
    create policy p_tour_orders_all on public.tour_orders
      for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id));
  end if;
end $$;

-- 同 0068：訂單一律走帶 MANAGER ＋ TOUR_MODULE 檢查的 server route，
-- 直接 PostgREST DML 不得繞過那兩道閘門。SELECT 保留（RLS 仍限制在租戶成員）。
revoke insert, update, delete, truncate on table public.tour_orders
  from anon, authenticated;
