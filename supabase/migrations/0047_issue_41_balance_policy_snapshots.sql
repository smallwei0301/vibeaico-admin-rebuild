-- 0047 — #41 balance deadline and cancellation-policy snapshots
--
-- Owner decisions 2026-08-31: a Plan supplies a configurable default; every
-- order snapshots the chosen rule. No refund percentage, forfeiture, automatic
-- cancellation, or payment-provider action is decided or implemented here.

alter table public.trip_plans
  add column if not exists balance_collection_mode text not null default 'DEADLINE',
  add column if not exists balance_due_hours integer default 48,
  add column if not exists cancellation_policy jsonb not null default jsonb_build_object(
    'source', 'MIDAO_TEMPLATE',
    'bands', jsonb_build_array(
      jsonb_build_object('minimumDaysBeforeDeparture', 8),
      jsonb_build_object('minimumDaysBeforeDeparture', 4),
      jsonb_build_object('minimumDaysBeforeDeparture', 0)
    )
  );

alter table public.trip_plans
  drop constraint if exists trip_plans_balance_collection_mode_check,
  add constraint trip_plans_balance_collection_mode_check
    check (balance_collection_mode in ('DEADLINE', 'ON_SITE')),
  drop constraint if exists trip_plans_balance_due_hours_check,
  add constraint trip_plans_balance_due_hours_check
    check (
      (balance_collection_mode = 'DEADLINE' and balance_due_hours is not null and balance_due_hours > 0)
      or (balance_collection_mode = 'ON_SITE' and balance_due_hours is null)
    );

alter table public.tour_orders
  add column if not exists balance_due numeric not null default 0,
  add column if not exists balance_due_at timestamptz,
  add column if not exists balance_collection_mode_snapshot text not null default 'DEADLINE',
  add column if not exists balance_due_hours_snapshot integer default 48,
  add column if not exists cancellation_policy_snapshot jsonb not null default jsonb_build_object(
    'source', 'MIDAO_TEMPLATE',
    'bands', jsonb_build_array(
      jsonb_build_object('minimumDaysBeforeDeparture', 8),
      jsonb_build_object('minimumDaysBeforeDeparture', 4),
      jsonb_build_object('minimumDaysBeforeDeparture', 0)
    )
  );

-- Existing rows predate the snapshot columns. Snapshot the rules that are in
-- force at this migration boundary before adding coupled constraints; a NULL
-- hours value with the DEADLINE default would make a clean install fail.
update public.tour_orders as o
set balance_due = greatest(o.total_amount - o.paid_amount, 0),
    balance_collection_mode_snapshot = p.balance_collection_mode,
    balance_due_hours_snapshot = p.balance_due_hours,
    cancellation_policy_snapshot = p.cancellation_policy
from public.trip_plans as p
where p.id = o.plan_id and p.tenant_id = o.tenant_id;

alter table public.tour_orders
  drop constraint if exists tour_orders_balance_collection_mode_snapshot_check,
  add constraint tour_orders_balance_collection_mode_snapshot_check
    check (balance_collection_mode_snapshot in ('DEADLINE', 'ON_SITE')),
  drop constraint if exists tour_orders_balance_due_hours_snapshot_check,
  add constraint tour_orders_balance_due_hours_snapshot_check
    check (
      (balance_collection_mode_snapshot = 'DEADLINE' and balance_due_hours_snapshot is not null and balance_due_hours_snapshot > 0)
      or (balance_collection_mode_snapshot = 'ON_SITE' and balance_due_hours_snapshot is null)
    ),
  drop constraint if exists tour_orders_balance_due_nonnegative_check,
  add constraint tour_orders_balance_due_nonnegative_check check (balance_due >= 0);

-- Keep every write path on the same lock order: departure first, then its
-- Plan. This proves the order's tenant/trip/plan lineage instead of trusting
-- service-role callers to send matching UUIDs.
create or replace function public.enforce_tour_order_lineage_41()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_departure public.trip_departures%rowtype;
  v_plan public.trip_plans%rowtype;
begin
  select * into v_departure
  from public.trip_departures
  where id = new.departure_id and tenant_id = new.tenant_id
  for key share;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;

  select * into v_plan
  from public.trip_plans
  where id = v_departure.plan_id and tenant_id = new.tenant_id
  for key share;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;

  if new.trip_id is distinct from v_departure.trip_id
     or new.plan_id is distinct from v_departure.plan_id
     or v_plan.trip_id is distinct from v_departure.trip_id then
    raise exception 'TOUR_ORDER_LINEAGE_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists t_tour_orders_a_lineage_guard_41 on public.tour_orders;
create trigger t_tour_orders_a_lineage_guard_41
  before insert or update of tenant_id, trip_id, plan_id, departure_id on public.tour_orders
  for each row execute function public.enforce_tour_order_lineage_41();

create or replace function public.snapshot_tour_order_balance_policy_41()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.trip_plans%rowtype;
begin
  select * into v_plan
  from public.trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;

  new.balance_collection_mode_snapshot := v_plan.balance_collection_mode;
  new.balance_due_hours_snapshot := v_plan.balance_due_hours;
  new.cancellation_policy_snapshot := v_plan.cancellation_policy;
  new.balance_due := greatest(new.total_amount - coalesce(new.paid_amount, 0), 0);
  new.balance_due_at := null;
  return new;
end;
$$;

drop trigger if exists t_tour_orders_balance_policy_snapshot_41 on public.tour_orders;
create trigger t_tour_orders_balance_policy_snapshot_41
  before insert on public.tour_orders
  for each row execute function public.snapshot_tour_order_balance_policy_41();

-- Formation is the only automatic point that starts a non-onsite balance clock.
-- A deadline merely marks the order for guide handling; it never cancels an
-- order, releases capacity, or infers a refund.
create or replace function public.start_formed_tour_order_balance_deadlines_41()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.formation_status = 'FORMED'
     and old.formation_status is distinct from new.formation_status then
    update public.tour_orders
    set balance_due = greatest(total_amount - paid_amount, 0),
        balance_due_at = case
          when balance_collection_mode_snapshot = 'DEADLINE'
            and total_amount > paid_amount
            then pg_catalog.now() + pg_catalog.make_interval(hours => balance_due_hours_snapshot)
          else null
        end
    where departure_id = new.id
      and tenant_id = new.tenant_id
      and status in ('CONFIRMED', 'COMPLETED')
      and payment_status not in ('REFUND_PENDING', 'REFUNDED');
  end if;
  return new;
end;
$$;

drop trigger if exists t_trip_departures_start_balance_deadlines_41 on public.trip_departures;
create trigger t_trip_departures_start_balance_deadlines_41
  after update of formation_status on public.trip_departures
  for each row execute function public.start_formed_tour_order_balance_deadlines_41();

revoke execute on function public.snapshot_tour_order_balance_policy_41()
  from public, anon, authenticated, service_role;
revoke execute on function public.start_formed_tour_order_balance_deadlines_41()
  from public, anon, authenticated, service_role;
revoke execute on function public.enforce_tour_order_lineage_41()
  from public, anon, authenticated, service_role;
