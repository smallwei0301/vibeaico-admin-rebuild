-- 0040 — #41 GUIDE 散客併團、成團截止與付款／狀態生命週期
--
-- Prerequisites: 0016/0026（Trip/Departure/TourOrder）、0034–0037（#37）與
-- 0038 (#40 notification outbox)、0039 (#50 keyword image bucket)。這是 source-only migration；不得套用到
-- Production。新 API／callback 必須在同一交易內更新 TourOrder，下面的 trigger
-- 會安全地重算 formation，而實際派送仍只由 #40 worker 處理。

-- ---------------------------------------------------------------- Plan rules
alter table trip_plans
  add column if not exists min_party_size integer,
  add column if not exists max_party_size integer,
  add column if not exists min_to_depart integer not null default 1,
  add column if not exists participation_mode text not null default 'SHARED',
  add column if not exists formation_deadline_days_before integer not null default 7;

-- 舊欄位 min/max_participants 只描述單筆訂單，絕不可用它猜既有團次的成團門檻。
-- 因此 min_to_depart 的歷史值維持安全預設 1；導遊可在新 Plan/Departure 明確設定。
update trip_plans
set min_party_size = greatest(coalesce(min_party_size, min_participants, 1), 1),
    max_party_size = greatest(coalesce(max_party_size, max_participants, 1), 1),
    participation_mode = case
      when booking_type in ('INSTANT', 'REQUEST') then 'PRIVATE'
      else 'SHARED'
    end
where min_party_size is null or max_party_size is null or participation_mode = 'SHARED';

alter table trip_plans
  alter column min_party_size set default 1,
  alter column min_party_size set not null,
  alter column max_party_size set default 10,
  alter column max_party_size set not null;

alter table trip_plans
  drop constraint if exists trip_plans_party_bounds,
  add constraint trip_plans_party_bounds check (
    min_party_size >= 1 and max_party_size >= min_party_size and min_to_depart >= 1
  ),
  drop constraint if exists trip_plans_participation_mode_check,
  add constraint trip_plans_participation_mode_check
    check (participation_mode in ('SHARED', 'PRIVATE')),
  drop constraint if exists trip_plans_formation_deadline_days_check,
  add constraint trip_plans_formation_deadline_days_check
    check (formation_deadline_days_before between 0 and 90);

create or replace function public.enforce_trip_plan_participation_mode_41()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.booking_type in ('INSTANT', 'REQUEST') then
    new.participation_mode := 'PRIVATE';
  end if;
  return new;
end;
$$;
drop trigger if exists t_trip_plans_participation_mode_41 on trip_plans;
create trigger t_trip_plans_participation_mode_41
  before insert or update of booking_type, participation_mode on trip_plans
  for each row execute function public.enforce_trip_plan_participation_mode_41();

-- ---------------------------------------------------------- Payment snapshots
-- payment_status 原本是 enum，不能安全地在同一 migration 加新 enum 值又立刻
-- 用於 constraint／trigger；改為受限 text，保留原本三個值並加入 PARTIAL、
-- REFUND_PENDING。外部 API 仍必須以 TypeScript contract 驗證字面值。
alter table tour_orders
  alter column payment_status drop default,
  alter column payment_status type text using payment_status::text,
  alter column payment_status set default 'UNPAID',
  add column if not exists upfront_required_amount numeric not null default 0,
  add column if not exists paid_amount numeric not null default 0,
  add column if not exists refunded_amount numeric not null default 0,
  add column if not exists deposit_mode_snapshot text;

update tour_orders o
set paid_amount = case
      when payment_status = 'PAID' then total_amount
      when payment_status = 'REFUNDED' then total_amount
      else paid_amount
    end,
    refunded_amount = case
      when payment_status = 'REFUNDED' then total_amount
      else refunded_amount
    end,
    upfront_required_amount = case
      when upfront_required_amount > 0 then upfront_required_amount
      when p.deposit_mode = 'NONE' then 0
      when p.deposit_mode = 'FULL' then total_amount
      else deposit_amount
    end,
    deposit_mode_snapshot = coalesce(o.deposit_mode_snapshot, p.deposit_mode)
from trip_plans p
where p.id = o.plan_id and p.tenant_id = o.tenant_id;

alter table tour_orders alter column deposit_mode_snapshot set not null;

alter table tour_orders
  drop constraint if exists tour_orders_payment_status_check,
  add constraint tour_orders_payment_status_check
    check (payment_status in ('UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED')),
  drop constraint if exists tour_orders_deposit_mode_snapshot_check,
  add constraint tour_orders_deposit_mode_snapshot_check
    check (deposit_mode_snapshot in ('NONE', 'DEPOSIT_FIXED', 'DEPOSIT_PERCENT', 'FULL')),
  drop constraint if exists tour_orders_payment_amounts_nonnegative,
  add constraint tour_orders_payment_amounts_nonnegative
    check (
      upfront_required_amount >= 0 and upfront_required_amount <= total_amount
      and paid_amount >= 0 and paid_amount <= total_amount
      and refunded_amount >= 0 and refunded_amount <= paid_amount
      and (payment_status <> 'PARTIAL'
        or (paid_amount > 0 and paid_amount >= upfront_required_amount))
      and (payment_status <> 'PAID' or paid_amount = total_amount)
    );

-- --------------------------------------------------------- Departure snapshot
alter table trip_departures
  add column if not exists min_to_depart_snapshot integer,
  add column if not exists formation_deadline_at timestamptz,
  add column if not exists formation_status text not null default 'COLLECTING',
  add column if not exists formed_at timestamptz,
  add column if not exists formed_by text,
  add column if not exists formed_participants integer,
  add column if not exists formation_risk_accepted_participants integer,
  add column if not exists formation_decided_at timestamptz,
  add column if not exists formation_decided_by uuid,
  add column if not exists formation_decision text,
  add column if not exists formation_decision_note text not null default '';

-- 歷史團次沒有足夠資訊可回推真正最低成團；保守保持 1，重新編輯後才改用 Plan。
update trip_departures
set min_to_depart_snapshot = 1
where min_to_depart_snapshot is null;
alter table trip_departures alter column min_to_depart_snapshot set not null;

alter table trip_departures
  drop constraint if exists trip_departures_formation_snapshot_check,
  add constraint trip_departures_formation_snapshot_check
    check (min_to_depart_snapshot >= 1 and min_to_depart_snapshot <= capacity),
  drop constraint if exists trip_departures_formation_status_check,
  add constraint trip_departures_formation_status_check
    check (formation_status in ('COLLECTING', 'FORMED', 'REVIEW_REQUIRED', 'AT_RISK', 'FAILED')),
  drop constraint if exists trip_departures_formed_by_check,
  add constraint trip_departures_formed_by_check
    check (formed_by is null or formed_by in ('SYSTEM', 'GUIDE_OVERRIDE')),
  drop constraint if exists trip_departures_formation_risk_accepted_check,
  add constraint trip_departures_formation_risk_accepted_check
    check (formation_risk_accepted_participants is null
      or formation_risk_accepted_participants between 0 and capacity);

create index if not exists trip_departures_formation_deadline_idx
  on trip_departures (formation_deadline_at)
  where formation_status = 'COLLECTING' and status = 'OPEN';

-- 新團次一律 snapshot。既有資料保留 formation_deadline_at=null，避免為歷史團次
-- 捏造一個已過期的 deadline；管理者重新編輯時才依最新 Plan 明確補值。
create or replace function public.snapshot_trip_departure_formation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_plan trip_plans%rowtype;
  v_departure_at timestamptz;
  v_timezone text;
begin
  select * into v_plan
  from trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  if new.min_to_depart_snapshot is null then
    new.min_to_depart_snapshot := v_plan.min_to_depart;
  end if;

  select coalesce(nullif(basic->>'timezone', ''), 'Asia/Taipei') into v_timezone
  from tenant_settings where tenant_id = new.tenant_id;
  v_timezone := coalesce(v_timezone, 'Asia/Taipei');
  v_departure_at := (new.departs_on + coalesce(new.start_time, time '00:00'))
    at time zone v_timezone;
  if new.formation_deadline_at is null then
    new.formation_deadline_at := v_departure_at
      - make_interval(days => v_plan.formation_deadline_days_before);
  end if;
  if new.formation_deadline_at <= now() or new.formation_deadline_at > v_departure_at then
    raise exception 'FORMATION_DEADLINE_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists t_trip_departures_formation_snapshot on trip_departures;
create trigger t_trip_departures_formation_snapshot
  before insert or update of departs_on, start_time, formation_deadline_at, min_to_depart_snapshot, capacity
  on trip_departures
  for each row execute function public.snapshot_trip_departure_formation();

-- 訂單保留下單當下的收款規則；Plan 日後修改不得重新定義舊訂單。
create or replace function public.snapshot_tour_order_payment_policy()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare v_plan trip_plans%rowtype;
begin
  select * into v_plan from trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;

  -- Normal checkout may not choose a different policy or upfront amount than its Plan.
  new.deposit_mode_snapshot := v_plan.deposit_mode;
  new.upfront_required_amount := case v_plan.deposit_mode
    when 'NONE' then 0
    when 'DEPOSIT_FIXED' then v_plan.deposit_value
    when 'DEPOSIT_PERCENT' then round(new.total_amount * v_plan.deposit_value / 100, 2)
    when 'FULL' then new.total_amount
  end;
  if new.upfront_required_amount < 0 or new.upfront_required_amount > new.total_amount then
    raise exception 'UPFRONT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
drop trigger if exists t_tour_orders_payment_policy_snapshot on tour_orders;
create trigger t_tour_orders_payment_policy_snapshot
  before insert on tour_orders
  for each row execute function public.snapshot_tour_order_payment_policy();

-- -------------------------------------------------------- Atomic formation
create table if not exists tour_formation_decisions (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  departure_id   uuid not null references trip_departures(id) on delete cascade,
  previous_status text not null,
  next_status     text not null,
  decision        text not null,
  actor_user_id   uuid,
  participants    integer not null,
  note            text not null default '',
  created_at      timestamptz not null default now()
);
alter table tour_formation_decisions enable row level security;
revoke all on table tour_formation_decisions from anon, authenticated;

create or replace function public.qualifying_tour_participants(p_departure uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(o.party_size), 0)::integer
  from tour_orders o
  where o.departure_id = p_departure
    and o.status in ('CONFIRMED', 'COMPLETED')
    and o.payment_status not in ('REFUND_PENDING', 'REFUNDED')
    and case o.deposit_mode_snapshot
      when 'NONE' then true
      when 'DEPOSIT_FIXED' then o.payment_status in ('PARTIAL', 'PAID')
        and o.paid_amount >= o.upfront_required_amount
      when 'DEPOSIT_PERCENT' then o.payment_status in ('PARTIAL', 'PAID')
        and o.paid_amount >= o.upfront_required_amount
      when 'FULL' then o.payment_status = 'PAID' and o.paid_amount >= o.total_amount
      else false
    end;
$$;

create or replace function public.refresh_departure_formation(p_departure uuid)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dep trip_departures%rowtype;
  v_participants integer;
begin
  select * into v_dep from trip_departures where id = p_departure for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_participants := public.qualifying_tour_participants(v_dep.id);

  if v_dep.formation_status = 'FORMED'
     and v_participants >= v_dep.min_to_depart_snapshot
     and v_dep.formation_risk_accepted_participants is not null then
    update trip_departures
    set formation_risk_accepted_participants = null
    where id = v_dep.id;
    v_dep.formation_risk_accepted_participants := null;
  end if;

  if v_dep.formation_status = 'COLLECTING'
     and v_participants >= v_dep.min_to_depart_snapshot then
    update trip_departures
    set formation_status = 'FORMED', formed_at = now(), formed_by = 'SYSTEM',
        formed_participants = v_participants, formation_decided_at = now(),
        formation_decision = 'SYSTEM_THRESHOLD'
    where id = v_dep.id;
    insert into tour_formation_decisions (
      tenant_id, departure_id, previous_status, next_status, decision, participants
    ) values (v_dep.tenant_id, v_dep.id, 'COLLECTING', 'FORMED', 'SYSTEM_THRESHOLD', v_participants);
    perform public.enqueue_notification_event(
      v_dep.tenant_id, 'TOUR_GROUP_FORMED', 'TOUR_DEPARTURE', v_dep.id::text,
      'tour-group-formed:' || v_dep.id::text,
      jsonb_build_object('departureId', v_dep.id::text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
    return 'FORMED';
  end if;

  if v_dep.formation_status = 'FORMED'
     and v_participants < v_dep.min_to_depart_snapshot
     and (v_dep.formation_risk_accepted_participants is null
       or v_participants < v_dep.formation_risk_accepted_participants) then
    update trip_departures
    set formation_status = 'AT_RISK', formation_decided_at = now(),
        formation_decision = 'SYSTEM_AT_RISK'
    where id = v_dep.id;
    insert into tour_formation_decisions (
      tenant_id, departure_id, previous_status, next_status, decision, participants
    ) values (v_dep.tenant_id, v_dep.id, 'FORMED', 'AT_RISK', 'SYSTEM_AT_RISK', v_participants);
    perform public.enqueue_notification_event(
      v_dep.tenant_id, 'TOUR_GROUP_AT_RISK', 'TOUR_DEPARTURE', v_dep.id::text,
      'tour-group-at-risk:' || v_dep.id::text || ':' || v_participants::text,
      jsonb_build_object('departureId', v_dep.id::text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
    return 'AT_RISK';
  end if;
  return v_dep.formation_status;
end;
$$;

-- Payment callback / 匯款人工確認只需更新同一筆 TourOrder；此 trigger 會在同一交易
-- 安全地 lock Departure、重算資格並產生冪等 event。callback 重放不會二次成團。
create or replace function public.refresh_tour_order_formation_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.departure_id is not null then
    perform public.refresh_departure_formation(new.departure_id);
  end if;
  return new;
end;
$$;
drop trigger if exists t_tour_orders_refresh_formation on tour_orders;
create trigger t_tour_orders_refresh_formation
  after insert or update of status, payment_status on tour_orders
  for each row execute function public.refresh_tour_order_formation_trigger();

-- deadline cron calls this function. 不足只進 REVIEW_REQUIRED，絕不自動取消／退款。
create or replace function public.review_expired_tour_formations(p_now timestamptz default now())
returns integer
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dep trip_departures%rowtype;
  v_participants integer;
  v_changed integer := 0;
begin
  for v_dep in
    select * from trip_departures
    where status = 'OPEN' and formation_status = 'COLLECTING'
      and formation_deadline_at is not null and formation_deadline_at <= p_now
    for update skip locked
  loop
    v_participants := public.qualifying_tour_participants(v_dep.id);
    if v_participants >= v_dep.min_to_depart_snapshot then
      perform public.refresh_departure_formation(v_dep.id);
      v_changed := v_changed + 1;
    else
      update trip_departures set formation_status = 'REVIEW_REQUIRED',
        formation_decided_at = p_now, formation_decision = 'SYSTEM_DEADLINE_REVIEW'
      where id = v_dep.id;
      insert into tour_formation_decisions (
        tenant_id, departure_id, previous_status, next_status, decision, participants
      ) values (v_dep.tenant_id, v_dep.id, 'COLLECTING', 'REVIEW_REQUIRED',
                'SYSTEM_DEADLINE_REVIEW', v_participants);
      perform public.enqueue_notification_event(
        v_dep.tenant_id, 'TOUR_GROUP_REVIEW_REQUIRED', 'TOUR_DEPARTURE', v_dep.id::text,
        'tour-group-review-required:' || v_dep.id::text,
        jsonb_build_object('departureId', v_dep.id::text, 'participants', v_participants,
                           'minToDepart', v_dep.min_to_depart_snapshot)
      );
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

-- 導遊只能處理系統無法自己決定的分支。所有狀態、audit、退款待辦
-- 與 logical event 都在同一交易完成，不由 API 分段寫入。
create or replace function public.decide_tour_formation(
  p_tenant uuid,
  p_departure uuid,
  p_decision text,
  p_actor_user uuid,
  p_new_deadline timestamptz default null,
  p_note text default ''
) returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_dep trip_departures%rowtype;
  v_previous text;
  v_next text;
  v_participants integer;
  v_departure_at timestamptz;
  v_timezone text;
begin
  select * into v_dep from trip_departures
  where id = p_departure and tenant_id = p_tenant for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from tenant_users
    where tenant_id = p_tenant and user_id = p_actor_user
      and role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'FORMATION_ACTOR_FORBIDDEN' using errcode = 'P0001';
  end if;
  v_previous := v_dep.formation_status;
  v_participants := public.qualifying_tour_participants(v_dep.id);
  select coalesce(nullif(basic->>'timezone', ''), 'Asia/Taipei') into v_timezone
  from tenant_settings where tenant_id = v_dep.tenant_id;
  v_departure_at := (v_dep.departs_on + coalesce(v_dep.start_time, time '00:00'))
    at time zone coalesce(v_timezone, 'Asia/Taipei');

  if p_decision = 'STILL_FORM' and v_previous = 'REVIEW_REQUIRED' then
    v_next := 'FORMED';
    update trip_departures set formation_status = v_next, formed_at = now(),
      formed_by = 'GUIDE_OVERRIDE', formed_participants = v_participants,
      formation_risk_accepted_participants = v_participants,
      formation_decided_at = now(), formation_decided_by = p_actor_user,
      formation_decision = p_decision, formation_decision_note = coalesce(p_note, '')
    where id = v_dep.id;
    perform public.enqueue_notification_event(
      v_dep.tenant_id, 'TOUR_GROUP_FORMED', 'TOUR_DEPARTURE', v_dep.id::text,
      'tour-group-formed:' || v_dep.id::text,
      jsonb_build_object('departureId', v_dep.id::text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
  elsif p_decision = 'EXTEND' and v_previous = 'REVIEW_REQUIRED' then
    if p_new_deadline is null or p_new_deadline <= now() or p_new_deadline > v_departure_at then
      raise exception 'FORMATION_DEADLINE_INVALID' using errcode = 'P0001';
    end if;
    v_next := 'COLLECTING';
    update trip_departures set formation_status = v_next,
      formation_deadline_at = p_new_deadline, formation_decided_at = now(),
      formation_decided_by = p_actor_user, formation_decision = p_decision,
      formation_decision_note = coalesce(p_note, '') where id = v_dep.id;
  elsif p_decision = 'CONTINUE' and v_previous = 'AT_RISK' then
    v_next := 'FORMED';
    update trip_departures set formation_status = v_next,
      formation_risk_accepted_participants = v_participants,
      formation_decided_at = now(), formation_decided_by = p_actor_user,
      formation_decision = p_decision, formation_decision_note = coalesce(p_note, '')
    where id = v_dep.id;
  elsif p_decision = 'CANCEL' and v_previous in ('REVIEW_REQUIRED', 'AT_RISK') then
    v_next := 'FAILED';
    update trip_departures set status = 'CANCELLED', seats_booked = 0,
      formation_status = v_next, formation_decided_at = now(),
      formation_decided_by = p_actor_user, formation_decision = p_decision,
      formation_decision_note = coalesce(p_note, '') where id = v_dep.id;
    update tour_orders set status = 'CANCELLED',
      payment_status = case when paid_amount > refunded_amount then 'REFUND_PENDING' else payment_status end,
      updated_at = now()
    where tenant_id = p_tenant and departure_id = p_departure
      and status in ('PENDING', 'CONFIRMED');
    perform public.enqueue_notification_event(
      v_dep.tenant_id, 'TOUR_GROUP_CANCELLED', 'TOUR_DEPARTURE', v_dep.id::text,
      'tour-group-cancelled:' || v_dep.id::text,
      jsonb_build_object(
        'departureId', v_dep.id::text,
        'refundPending', exists (
          select 1 from tour_orders where tenant_id = p_tenant and departure_id = p_departure
            and payment_status = 'REFUND_PENDING'
        )
      )
    );
  else
    raise exception 'FORMATION_DECISION_INVALID' using errcode = 'P0001';
  end if;

  insert into tour_formation_decisions (
    tenant_id, departure_id, previous_status, next_status, decision,
    actor_user_id, participants, note
  ) values (
    v_dep.tenant_id, v_dep.id, v_previous, v_next, p_decision,
    p_actor_user, v_participants, coalesce(p_note, '')
  );
  return v_next;
end;
$$;

revoke execute on function public.snapshot_trip_departure_formation() from public, anon, authenticated;
revoke execute on function public.enforce_trip_plan_participation_mode_41() from public, anon, authenticated;
revoke execute on function public.snapshot_tour_order_payment_policy() from public, anon, authenticated;
revoke execute on function public.qualifying_tour_participants(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_departure_formation(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_tour_order_formation_trigger() from public, anon, authenticated;
revoke execute on function public.review_expired_tour_formations(timestamptz) from public, anon, authenticated;
revoke execute on function public.decide_tour_formation(uuid, uuid, text, uuid, timestamptz, text) from public, anon, authenticated;
grant execute on function public.review_expired_tour_formations(timestamptz) to service_role;
grant execute on function public.decide_tour_formation(uuid, uuid, text, uuid, timestamptz, text) to service_role;
