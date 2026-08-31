-- 0041 — #41 follow-up: harden already-applied SECURITY DEFINER functions.
-- Recreate every #41 definer function because ALTER FUNCTION alone would leave
-- the previously parsed bodies dependent on public in search_path.

create or replace function public.enforce_trip_plan_participation_mode_41()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.booking_type in ('INSTANT', 'REQUEST') then
    new.participation_mode := 'PRIVATE';
  end if;
  return new;
end;
$$;

create or replace function public.snapshot_trip_departure_formation()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_plan public.trip_plans%rowtype;
  v_departure_at pg_catalog.timestamptz;
  v_timezone pg_catalog.text;
begin
  select * into v_plan from public.trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  if new.min_to_depart_snapshot is null then
    new.min_to_depart_snapshot := v_plan.min_to_depart;
  end if;
  select coalesce(nullif(basic->>'timezone', ''), 'Asia/Taipei') into v_timezone
  from public.tenant_settings where tenant_id = new.tenant_id;
  v_timezone := coalesce(v_timezone, 'Asia/Taipei');
  v_departure_at := (new.departs_on + coalesce(new.start_time, '00:00'::pg_catalog.time))
    at time zone v_timezone;
  if new.formation_deadline_at is null then
    new.formation_deadline_at := v_departure_at
      - pg_catalog.make_interval(days => v_plan.formation_deadline_days_before);
  end if;
  if new.formation_deadline_at <= pg_catalog.now() or new.formation_deadline_at > v_departure_at then
    raise exception 'FORMATION_DEADLINE_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.snapshot_tour_order_payment_policy()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
declare v_plan public.trip_plans%rowtype;
begin
  select * into v_plan from public.trip_plans
  where id = new.plan_id and tenant_id = new.tenant_id;
  if not found then raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002'; end if;
  new.deposit_mode_snapshot := v_plan.deposit_mode;
  new.upfront_required_amount := case v_plan.deposit_mode
    when 'NONE' then 0
    when 'DEPOSIT_FIXED' then v_plan.deposit_value
    when 'DEPOSIT_PERCENT' then pg_catalog.round(new.total_amount * v_plan.deposit_value / 100, 2)
    when 'FULL' then new.total_amount
  end;
  if new.upfront_required_amount < 0 or new.upfront_required_amount > new.total_amount then
    raise exception 'UPFRONT_AMOUNT_INVALID' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create or replace function public.qualifying_tour_participants(p_departure pg_catalog.uuid)
returns pg_catalog.int4
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(pg_catalog.sum(o.party_size), 0)::pg_catalog.int4
  from public.tour_orders o
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

create or replace function public.enqueue_formation_notification_41(
  p_tenant pg_catalog.uuid,
  p_event_name pg_catalog.text,
  p_aggregate_type pg_catalog.text,
  p_aggregate_id pg_catalog.text,
  p_idempotency_key pg_catalog.text,
  p_payload pg_catalog.jsonb
) returns pg_catalog.void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_catalog.to_regprocedure(
    'public.enqueue_notification_event(uuid,text,text,text,text,jsonb)'
  ) is not null then
    execute 'select public.enqueue_notification_event($1, $2, $3, $4, $5, $6)'
      using p_tenant, p_event_name, p_aggregate_type, p_aggregate_id,
        p_idempotency_key, p_payload;
  end if;
end;
$$;

create or replace function public.refresh_departure_formation(p_departure pg_catalog.uuid)
returns pg_catalog.text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep public.trip_departures%rowtype;
  v_participants pg_catalog.int4;
begin
  select * into v_dep from public.trip_departures where id = p_departure for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  v_participants := public.qualifying_tour_participants(v_dep.id);
  if v_dep.formation_status = 'FORMED'
     and v_participants >= v_dep.min_to_depart_snapshot
     and v_dep.formation_risk_accepted_participants is not null then
    update public.trip_departures set formation_risk_accepted_participants = null where id = v_dep.id;
    v_dep.formation_risk_accepted_participants := null;
  end if;
  if v_dep.formation_status = 'COLLECTING'
     and v_participants >= v_dep.min_to_depart_snapshot then
    update public.trip_departures
    set formation_status = 'FORMED', formed_at = pg_catalog.now(), formed_by = 'SYSTEM',
        formed_participants = v_participants, formation_decided_at = pg_catalog.now(),
        formation_decision = 'SYSTEM_THRESHOLD'
    where id = v_dep.id;
    insert into public.tour_formation_decisions (
      tenant_id, departure_id, previous_status, next_status, decision, participants
    ) values (v_dep.tenant_id, v_dep.id, 'COLLECTING', 'FORMED', 'SYSTEM_THRESHOLD', v_participants);
    perform public.enqueue_formation_notification_41(
      v_dep.tenant_id, 'TOUR_GROUP_FORMED', 'TOUR_DEPARTURE', v_dep.id::pg_catalog.text,
      'tour-group-formed:' || v_dep.id::pg_catalog.text,
      pg_catalog.jsonb_build_object('departureId', v_dep.id::pg_catalog.text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
    return 'FORMED';
  end if;
  if v_dep.formation_status = 'FORMED'
     and v_participants < v_dep.min_to_depart_snapshot
     and (v_dep.formation_risk_accepted_participants is null
       or v_participants < v_dep.formation_risk_accepted_participants) then
    update public.trip_departures
    set formation_status = 'AT_RISK', formation_decided_at = pg_catalog.now(),
        formation_decision = 'SYSTEM_AT_RISK'
    where id = v_dep.id;
    insert into public.tour_formation_decisions (
      tenant_id, departure_id, previous_status, next_status, decision, participants
    ) values (v_dep.tenant_id, v_dep.id, 'FORMED', 'AT_RISK', 'SYSTEM_AT_RISK', v_participants);
    perform public.enqueue_formation_notification_41(
      v_dep.tenant_id, 'TOUR_GROUP_AT_RISK', 'TOUR_DEPARTURE', v_dep.id::pg_catalog.text,
      'tour-group-at-risk:' || v_dep.id::pg_catalog.text || ':' || v_participants::pg_catalog.text,
      pg_catalog.jsonb_build_object('departureId', v_dep.id::pg_catalog.text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
    return 'AT_RISK';
  end if;
  return v_dep.formation_status;
end;
$$;

create or replace function public.refresh_tour_order_formation_trigger()
returns pg_catalog.trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and old.departure_id is distinct from new.departure_id
     and old.departure_id is not null then
    perform public.refresh_departure_formation(old.departure_id);
  end if;
  if new.departure_id is not null then
    perform public.refresh_departure_formation(new.departure_id);
  end if;
  return new;
end;
$$;

create or replace function public.review_expired_tour_formations(p_now pg_catalog.timestamptz default pg_catalog.now())
returns pg_catalog.int4
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep public.trip_departures%rowtype;
  v_participants pg_catalog.int4;
  v_changed pg_catalog.int4 := 0;
begin
  for v_dep in
    select * from public.trip_departures
    where status = 'OPEN' and formation_status = 'COLLECTING'
      and formation_deadline_at is not null and formation_deadline_at <= p_now
    for update skip locked
  loop
    v_participants := public.qualifying_tour_participants(v_dep.id);
    if v_participants >= v_dep.min_to_depart_snapshot then
      perform public.refresh_departure_formation(v_dep.id);
      v_changed := v_changed + 1;
    else
      update public.trip_departures set formation_status = 'REVIEW_REQUIRED',
        formation_decided_at = p_now, formation_decision = 'SYSTEM_DEADLINE_REVIEW'
      where id = v_dep.id;
      insert into public.tour_formation_decisions (
        tenant_id, departure_id, previous_status, next_status, decision, participants
      ) values (v_dep.tenant_id, v_dep.id, 'COLLECTING', 'REVIEW_REQUIRED',
                'SYSTEM_DEADLINE_REVIEW', v_participants);
      perform public.enqueue_formation_notification_41(
        v_dep.tenant_id, 'TOUR_GROUP_REVIEW_REQUIRED', 'TOUR_DEPARTURE', v_dep.id::pg_catalog.text,
        'tour-group-review-required:' || v_dep.id::pg_catalog.text,
        pg_catalog.jsonb_build_object('departureId', v_dep.id::pg_catalog.text, 'participants', v_participants,
                           'minToDepart', v_dep.min_to_depart_snapshot)
      );
      v_changed := v_changed + 1;
    end if;
  end loop;
  return v_changed;
end;
$$;

create or replace function public.decide_tour_formation(
  p_tenant pg_catalog.uuid,
  p_departure pg_catalog.uuid,
  p_decision pg_catalog.text,
  p_actor_user pg_catalog.uuid,
  p_new_deadline pg_catalog.timestamptz default null,
  p_note pg_catalog.text default ''
) returns pg_catalog.text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_dep public.trip_departures%rowtype;
  v_previous pg_catalog.text;
  v_next pg_catalog.text;
  v_participants pg_catalog.int4;
  v_departure_at pg_catalog.timestamptz;
  v_timezone pg_catalog.text;
begin
  select * into v_dep from public.trip_departures
  where id = p_departure and tenant_id = p_tenant for update;
  if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (
    select 1 from public.tenant_users
    where tenant_id = p_tenant and user_id = p_actor_user
      and role in ('OWNER', 'MANAGER')
  ) then
    raise exception 'FORMATION_ACTOR_FORBIDDEN' using errcode = 'P0001';
  end if;
  v_previous := v_dep.formation_status;
  v_participants := public.qualifying_tour_participants(v_dep.id);
  select coalesce(nullif(basic->>'timezone', ''), 'Asia/Taipei') into v_timezone
  from public.tenant_settings where tenant_id = v_dep.tenant_id;
  v_departure_at := (v_dep.departs_on + coalesce(v_dep.start_time, '00:00'::pg_catalog.time))
    at time zone coalesce(v_timezone, 'Asia/Taipei');
  if p_decision = 'STILL_FORM' and v_previous = 'REVIEW_REQUIRED' then
    v_next := 'FORMED';
    update public.trip_departures set formation_status = v_next, formed_at = pg_catalog.now(),
      formed_by = 'GUIDE_OVERRIDE', formed_participants = v_participants,
      formation_risk_accepted_participants = v_participants,
      formation_decided_at = pg_catalog.now(), formation_decided_by = p_actor_user,
      formation_decision = p_decision, formation_decision_note = coalesce(p_note, '')
    where id = v_dep.id;
    perform public.enqueue_formation_notification_41(
      v_dep.tenant_id, 'TOUR_GROUP_FORMED', 'TOUR_DEPARTURE', v_dep.id::pg_catalog.text,
      'tour-group-formed:' || v_dep.id::pg_catalog.text,
      pg_catalog.jsonb_build_object('departureId', v_dep.id::pg_catalog.text, 'participants', v_participants,
                         'minToDepart', v_dep.min_to_depart_snapshot)
    );
  elsif p_decision = 'EXTEND' and v_previous = 'REVIEW_REQUIRED' then
    if p_new_deadline is null or p_new_deadline <= pg_catalog.now() or p_new_deadline > v_departure_at then
      raise exception 'FORMATION_DEADLINE_INVALID' using errcode = 'P0001';
    end if;
    v_next := 'COLLECTING';
    update public.trip_departures set formation_status = v_next,
      formation_deadline_at = p_new_deadline, formation_decided_at = pg_catalog.now(),
      formation_decided_by = p_actor_user, formation_decision = p_decision,
      formation_decision_note = coalesce(p_note, '') where id = v_dep.id;
  elsif p_decision = 'CONTINUE' and v_previous = 'AT_RISK' then
    v_next := 'FORMED';
    update public.trip_departures set formation_status = v_next,
      formation_risk_accepted_participants = v_participants,
      formation_decided_at = pg_catalog.now(), formation_decided_by = p_actor_user,
      formation_decision = p_decision, formation_decision_note = coalesce(p_note, '')
    where id = v_dep.id;
  elsif p_decision = 'CANCEL' and v_previous in ('REVIEW_REQUIRED', 'AT_RISK') then
    v_next := 'FAILED';
    update public.trip_departures set status = 'CANCELLED', seats_booked = 0,
      formation_status = v_next, formation_decided_at = pg_catalog.now(),
      formation_decided_by = p_actor_user, formation_decision = p_decision,
      formation_decision_note = coalesce(p_note, '') where id = v_dep.id;
    update public.tour_orders set status = 'CANCELLED',
      payment_status = case when paid_amount > refunded_amount then 'REFUND_PENDING' else payment_status end,
      updated_at = pg_catalog.now()
    where tenant_id = p_tenant and departure_id = p_departure
      and status in ('PENDING', 'CONFIRMED');
    perform public.enqueue_formation_notification_41(
      v_dep.tenant_id, 'TOUR_GROUP_CANCELLED', 'TOUR_DEPARTURE', v_dep.id::pg_catalog.text,
      'tour-group-cancelled:' || v_dep.id::pg_catalog.text,
      pg_catalog.jsonb_build_object(
        'departureId', v_dep.id::pg_catalog.text,
        'refundPending', exists (
          select 1 from public.tour_orders where tenant_id = p_tenant and departure_id = p_departure
            and payment_status = 'REFUND_PENDING'
        )
      )
    );
  else
    raise exception 'FORMATION_DECISION_INVALID' using errcode = 'P0001';
  end if;
  insert into public.tour_formation_decisions (
    tenant_id, departure_id, previous_status, next_status, decision,
    actor_user_id, participants, note
  ) values (
    v_dep.tenant_id, v_dep.id, v_previous, v_next, p_decision,
    p_actor_user, v_participants, coalesce(p_note, '')
  );
  return v_next;
end;
$$;

revoke execute on function public.snapshot_trip_departure_formation() from public, anon, authenticated, service_role;
revoke execute on function public.enforce_trip_plan_participation_mode_41() from public, anon, authenticated, service_role;
revoke execute on function public.snapshot_tour_order_payment_policy() from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_formation_notification_41(pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.text, pg_catalog.jsonb) from public, anon, authenticated, service_role;
revoke execute on function public.qualifying_tour_participants(pg_catalog.uuid) from public, anon, authenticated, service_role;
revoke execute on function public.refresh_departure_formation(pg_catalog.uuid) from public, anon, authenticated, service_role;
revoke execute on function public.refresh_tour_order_formation_trigger() from public, anon, authenticated, service_role;
revoke execute on function public.review_expired_tour_formations(pg_catalog.timestamptz) from public, anon, authenticated;
revoke execute on function public.decide_tour_formation(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid, pg_catalog.timestamptz, pg_catalog.text) from public, anon, authenticated;
grant execute on function public.review_expired_tour_formations(pg_catalog.timestamptz) to service_role;
grant execute on function public.decide_tour_formation(pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid, pg_catalog.timestamptz, pg_catalog.text) to service_role;
