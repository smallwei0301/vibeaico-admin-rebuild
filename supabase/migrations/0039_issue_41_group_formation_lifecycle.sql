-- 0039 — #41 shared-party formation lifecycle (source-only; do not apply here).
-- Prerequisites: 0016/0026 tour tables, 0034–0037 #37 tour write boundaries,
-- and 0038 #40 notification_outbox/enqueue_notification_event.

alter table trip_plans
  add column if not exists min_party_size integer,
  add column if not exists max_party_size integer,
  add column if not exists min_to_depart integer not null default 1,
  add column if not exists participation_mode text not null default 'SHARED',
  add column if not exists formation_deadline_days_before integer not null default 7;

-- Legacy min/max_participants meant a single order, never a group threshold.
update trip_plans
set min_party_size = greatest(coalesce(min_party_size, min_participants, 1), 1),
    max_party_size = greatest(coalesce(max_party_size, max_participants, 1), 1)
where min_party_size is null or max_party_size is null;
alter table trip_plans
  alter column min_party_size set not null,
  alter column max_party_size set not null,
  add constraint trip_plans_party_bounds_41 check (min_party_size >= 1 and max_party_size >= min_party_size and min_to_depart >= 1),
  add constraint trip_plans_participation_mode_41 check (participation_mode in ('SHARED', 'PRIVATE')),
  add constraint trip_plans_formation_deadline_days_41 check (formation_deadline_days_before between 0 and 90);

alter table tour_orders
  alter column payment_status drop default,
  alter column payment_status type text using payment_status::text,
  alter column payment_status set default 'UNPAID',
  add column if not exists upfront_required_amount numeric not null default 0,
  add column if not exists paid_amount numeric not null default 0,
  add column if not exists refunded_amount numeric not null default 0,
  add constraint tour_orders_payment_status_41 check (payment_status in ('UNPAID', 'PARTIAL', 'PAID', 'REFUND_PENDING', 'REFUNDED')),
  add constraint tour_orders_payment_amounts_41 check (upfront_required_amount >= 0 and paid_amount >= 0 and refunded_amount >= 0);
update tour_orders set paid_amount = case when payment_status in ('PAID','REFUNDED') then total_amount else paid_amount end,
  refunded_amount = case when payment_status = 'REFUNDED' then total_amount else refunded_amount end,
  upfront_required_amount = case when upfront_required_amount > 0 then upfront_required_amount when payment_status = 'PAID' then total_amount else deposit_amount end;

alter table trip_departures
  add column if not exists min_to_depart_snapshot integer,
  add column if not exists formation_deadline_at timestamptz,
  add column if not exists formation_status text not null default 'COLLECTING',
  add column if not exists formed_at timestamptz,
  add column if not exists formed_by text,
  add column if not exists formed_participants integer,
  add column if not exists formation_decided_at timestamptz,
  add column if not exists formation_decision text,
  add column if not exists formation_decision_note text not null default '';
update trip_departures set min_to_depart_snapshot = 1 where min_to_depart_snapshot is null;
alter table trip_departures alter column min_to_depart_snapshot set not null;
alter table trip_departures
  add constraint trip_departures_formation_snapshot_41 check (min_to_depart_snapshot between 1 and capacity),
  add constraint trip_departures_formation_status_41 check (formation_status in ('COLLECTING','FORMED','REVIEW_REQUIRED','AT_RISK','FAILED')),
  add constraint trip_departures_formed_by_41 check (formed_by is null or formed_by in ('SYSTEM','GUIDE_OVERRIDE'));
create index trip_departures_formation_deadline_41 on trip_departures (formation_deadline_at) where status = 'OPEN' and formation_status = 'COLLECTING';

create or replace function public.snapshot_trip_departure_formation_41() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p trip_plans%rowtype; departure_at timestamptz;
begin
  select * into p from trip_plans where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  new.min_to_depart_snapshot := coalesce(new.min_to_depart_snapshot, p.min_to_depart);
  departure_at := (new.departs_on + coalesce(new.start_time, time '00:00')) at time zone 'Asia/Taipei';
  new.formation_deadline_at := coalesce(new.formation_deadline_at, departure_at - make_interval(days => p.formation_deadline_days_before));
  if new.min_to_depart_snapshot > new.capacity or new.formation_deadline_at <= now() or new.formation_deadline_at > departure_at then
    raise exception 'FORMATION_DEADLINE_OR_CAPACITY_INVALID' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger t_trip_departures_formation_snapshot_41 before insert on trip_departures for each row execute function public.snapshot_trip_departure_formation_41();

-- Protect every legacy and future order writer: party bounds and all parents must share a tenant.
create or replace function public.guard_tour_order_formation_41() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p trip_plans%rowtype; d trip_departures%rowtype;
begin
  select * into p from trip_plans where id = new.plan_id and tenant_id = new.tenant_id;
  select * into d from trip_departures where id = new.departure_id and tenant_id = new.tenant_id;
  if not found or p.id is null or p.trip_id <> new.trip_id or d.plan_id <> new.plan_id or d.trip_id <> new.trip_id then raise exception 'TOUR_ORDER_TENANT_PARENT_MISMATCH' using errcode = 'P0002'; end if;
  if new.party_size < p.min_party_size or new.party_size > p.max_party_size then raise exception 'PARTY_SIZE_OUT_OF_BOUNDS' using errcode = 'P0001'; end if;
  return new;
end $$;
create trigger t_tour_orders_formation_guard_41 before insert or update of tenant_id, trip_id, plan_id, departure_id, party_size on tour_orders for each row execute function public.guard_tour_order_formation_41();

create table tour_formation_decisions (
  id uuid primary key default gen_random_uuid(), tenant_id uuid not null references tenants(id) on delete cascade,
  departure_id uuid not null references trip_departures(id) on delete cascade, previous_status text not null, next_status text not null,
  decision text not null, participants integer not null, created_at timestamptz not null default now()
);
alter table tour_formation_decisions enable row level security;
revoke all on tour_formation_decisions from anon, authenticated;
grant all on table tour_formation_decisions to service_role;

create or replace function public.qualifying_tour_participants_41(p_departure uuid) returns integer language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(sum(o.party_size),0)::integer from tour_orders o join trip_plans p on p.id=o.plan_id and p.tenant_id=o.tenant_id
  where o.departure_id=p_departure and o.status in ('CONFIRMED','COMPLETED') and o.payment_status <> 'REFUNDED'
  and (p.deposit_mode='NONE' or (p.deposit_mode in ('DEPOSIT_FIXED','DEPOSIT_PERCENT') and o.payment_status in ('PARTIAL','PAID')) or (p.deposit_mode='FULL' and o.payment_status='PAID'))
$$;

-- One locked departure row is the concurrency boundary. The FORM update predicate is compare-and-set;
-- #40's unique outbox key makes a provider callback replay produce no second logical event.
create or replace function public.refresh_departure_formation_41(p_tenant uuid, p_departure uuid) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare d trip_departures%rowtype; n integer;
begin
  select * into d from trip_departures where id=p_departure and tenant_id=p_tenant for update;
  if not found then raise exception 'FORMATION_TENANT_NOT_FOUND' using errcode = 'P0002'; end if;
  n := public.qualifying_tour_participants_41(d.id);
  if d.formation_status='COLLECTING' and n >= d.min_to_depart_snapshot then
    update trip_departures set formation_status='FORMED', formed_at=now(), formed_by='SYSTEM', formed_participants=n, formation_decided_at=now(), formation_decision='SYSTEM_THRESHOLD' where id=d.id and formation_status='COLLECTING';
    insert into tour_formation_decisions(tenant_id,departure_id,previous_status,next_status,decision,participants) values(d.tenant_id,d.id,'COLLECTING','FORMED','SYSTEM_THRESHOLD',n);
    perform public.enqueue_notification_event(d.tenant_id,'TOUR_GROUP_FORMED','TOUR_DEPARTURE',d.id::text,'tour-group-formed:'||d.id::text,jsonb_build_object('departureId',d.id::text,'participants',n,'minToDepart',d.min_to_depart_snapshot));
    return 'FORMED';
  end if;
  if d.formation_status='FORMED' and n < d.min_to_depart_snapshot then
    update trip_departures set formation_status='AT_RISK', formation_decided_at=now(), formation_decision='SYSTEM_AT_RISK' where id=d.id and formation_status='FORMED';
    insert into tour_formation_decisions(tenant_id,departure_id,previous_status,next_status,decision,participants) values(d.tenant_id,d.id,'FORMED','AT_RISK','SYSTEM_AT_RISK',n);
    perform public.enqueue_notification_event(d.tenant_id,'TOUR_GROUP_AT_RISK','TOUR_DEPARTURE',d.id::text,'tour-group-at-risk:'||d.id::text,jsonb_build_object('departureId',d.id::text,'participants',n,'minToDepart',d.min_to_depart_snapshot));
    return 'AT_RISK';
  end if;
  return d.formation_status;
end $$;

create or replace function public.refresh_tour_order_formation_41() returns trigger language plpgsql security definer set search_path = public, pg_temp as $$ begin
  perform public.refresh_departure_formation_41(new.tenant_id,new.departure_id); return new;
end $$;
create trigger t_tour_orders_refresh_formation_41 after update of status, payment_status on tour_orders for each row execute function public.refresh_tour_order_formation_41();

create or replace function public.review_expired_tour_formations_41(p_now timestamptz default now()) returns integer language plpgsql security definer set search_path = public, pg_temp as $$
declare d trip_departures%rowtype; n integer; changed integer:=0;
begin
  for d in select * from trip_departures where status='OPEN' and formation_status='COLLECTING' and formation_deadline_at <= p_now for update skip locked loop
    n:=public.qualifying_tour_participants_41(d.id);
    if n < d.min_to_depart_snapshot then
      update trip_departures set formation_status='REVIEW_REQUIRED',formation_decided_at=p_now,formation_decision='SYSTEM_DEADLINE_REVIEW' where id=d.id and formation_status='COLLECTING';
      insert into tour_formation_decisions(tenant_id,departure_id,previous_status,next_status,decision,participants) values(d.tenant_id,d.id,'COLLECTING','REVIEW_REQUIRED','SYSTEM_DEADLINE_REVIEW',n);
      perform public.enqueue_notification_event(d.tenant_id,'TOUR_GROUP_REVIEW_REQUIRED','TOUR_DEPARTURE',d.id::text,'tour-group-review-required:'||d.id::text,jsonb_build_object('departureId',d.id::text,'participants',n)); changed:=changed+1;
    end if;
  end loop; return changed;
end $$;

-- TODO(#41): payment deadlines, refund execution, and recipient/channel policy require their own
-- decided interfaces. This migration creates logical events only; it does not claim delivery or refunds.
revoke execute on function public.snapshot_trip_departure_formation_41() from public, anon, authenticated;
revoke execute on function public.guard_tour_order_formation_41() from public, anon, authenticated;
revoke execute on function public.qualifying_tour_participants_41(uuid) from public, anon, authenticated;
revoke execute on function public.refresh_departure_formation_41(uuid,uuid) from public, anon, authenticated;
revoke execute on function public.refresh_tour_order_formation_41() from public, anon, authenticated;
revoke execute on function public.review_expired_tour_formations_41(timestamptz) from public, anon, authenticated;
grant execute on function public.qualifying_tour_participants_41(uuid) to service_role;
grant execute on function public.refresh_departure_formation_41(uuid,uuid) to service_role;
grant execute on function public.review_expired_tour_formations_41(timestamptz) to service_role;
