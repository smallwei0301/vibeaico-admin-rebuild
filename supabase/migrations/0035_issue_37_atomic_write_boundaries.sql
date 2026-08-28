-- 0035_issue_37_atomic_write_boundaries.sql — issue #37 Sol audit repair
--
-- Source-only.  This migration is intentionally NOT applied by this change.
-- It makes every availability-sensitive write cross one database transaction:
-- advisory locks serialize a staff member's booking/departure writes, the
-- database checks the same four occupancy sources as the UI, then it writes.

create or replace function public.lock_staff_availability(
  p_tenant uuid,
  p_staff_ids uuid[]
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
begin
  for v_staff_id in
    select distinct staff_id
      from unnest(coalesce(p_staff_ids, array[]::uuid[])) as staff_id
     where staff_id is not null
     order by staff_id
  loop
    -- Every availability writer uses this same deterministic lock key.  It
    -- closes the check-then-write race across bookings and departure staff.
    perform pg_advisory_xact_lock(hashtext(p_tenant::text || ':' || v_staff_id::text));
  end loop;
end;
$$;

create or replace function public.assert_staff_available(
  p_tenant uuid,
  p_staff_ids uuid[],
  p_start timestamptz,
  p_end timestamptz,
  p_exclude_booking uuid default null,
  p_exclude_departure uuid default null
) returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_staff_id uuid;
  v_policy text;
  v_local_start date := (p_start at time zone 'Asia/Taipei')::date;
  v_local_end date := (p_end at time zone 'Asia/Taipei')::date;
begin
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'AVAILABILITY_INTERVAL_INVALID' using errcode = 'P0001';
  end if;

  perform public.lock_staff_availability(p_tenant, p_staff_ids);

  for v_staff_id in
    select distinct staff_id
      from unnest(coalesce(p_staff_ids, array[]::uuid[])) as staff_id
     where staff_id is not null
  loop
    select availability_policy into v_policy
      from staff
     where tenant_id = p_tenant and id = v_staff_id and active and bookable;
    if not found then
      raise exception 'STAFF_NOT_ASSIGNABLE:%', v_staff_id using errcode = 'P0001';
    end if;

    if v_policy = 'EXPLICIT_ONLY' and not exists (
      select 1 from shifts s
       where s.tenant_id = p_tenant and s.staff_id = v_staff_id
         and ((s.work_date + s.start_time) at time zone 'Asia/Taipei') <= p_start
         and ((s.work_date + s.end_time) at time zone 'Asia/Taipei') >= p_end
    ) then
      raise exception 'AVAILABILITY_SHIFT:%', v_staff_id using errcode = 'P0001';
    end if;

    if exists (
      select 1 from bookings b
       where b.tenant_id = p_tenant and b.staff_id = v_staff_id
         and b.status in ('PENDING', 'CONFIRMED')
         and b.id is distinct from p_exclude_booking
         and b.start_at < p_end and b.end_at > p_start
    ) then
      raise exception 'AVAILABILITY_BOOKING:%', v_staff_id using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from block_times bt
       where bt.tenant_id = p_tenant
         and (bt.staff_id is null or bt.staff_id = v_staff_id)
         and (
           (bt.recurrence = 'SINGLE' and bt.start_at < p_end and bt.end_at > p_start)
           or (
             bt.recurrence = 'WEEKLY'
             and exists (
               select 1
                 from generate_series(v_local_start - 1, v_local_end, interval '1 day') as d(day)
                where extract(dow from d.day) = bt.day_of_week
                  and ((d.day::date + (bt.start_at at time zone 'Asia/Taipei')::time)
                         at time zone 'Asia/Taipei') < p_end
                  and ((d.day::date + (bt.end_at at time zone 'Asia/Taipei')::time)
                         at time zone 'Asia/Taipei') > p_start
             )
           )
         )
    ) then
      raise exception 'AVAILABILITY_BLOCK:%', v_staff_id using errcode = 'P0001';
    end if;

    if exists (
      select 1
        from trip_departure_staff ds
        join trip_departures d on d.tenant_id = ds.tenant_id and d.id = ds.departure_id
        join trip_plans p on p.tenant_id = d.tenant_id and p.id = d.plan_id
       where ds.tenant_id = p_tenant and ds.staff_id = v_staff_id
         and d.status <> 'CANCELLED'
         and d.id is distinct from p_exclude_departure
         and ((d.departs_on + coalesce(d.start_time, time '00:00')) at time zone 'Asia/Taipei') < p_end
         and case when d.start_time is null
                  then ((d.departs_on + 1)::timestamp at time zone 'Asia/Taipei')
                  else ((d.departs_on + d.start_time) at time zone 'Asia/Taipei')
                       + make_interval(mins => p.duration_minutes)
             end > p_start
    ) then
      raise exception 'AVAILABILITY_DEPARTURE:%', v_staff_id using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

create or replace function public.save_trip_departure_with_staff(
  p_tenant uuid,
  p_trip_id uuid,
  p_plan_id uuid,
  p_departure_id uuid,
  p_departs_on date,
  p_start_time time,
  p_capacity integer,
  p_status text,
  p_note text,
  p_primary_staff_id uuid default null,
  p_assistant_staff_ids uuid[] default null
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_current trip_departures%rowtype;
  v_duration integer;
  v_primary uuid := p_primary_staff_id;
  v_assistants uuid[];
  v_existing_staff uuid[] := array[]::uuid[];
  v_staff_ids uuid[];
  v_assignable_count integer;
  v_start timestamptz;
  v_end timestamptz;
  v_result_id uuid;
begin
  if not tenant_role_at_least(p_tenant, 'MANAGER') then
    raise exception 'TENANT_MANAGER_REQUIRED' using errcode = '42501';
  end if;
  if p_status not in ('OPEN', 'CLOSED', 'CANCELLED') or p_capacity < 1 then
    raise exception 'DEPARTURE_INVALID' using errcode = 'P0001';
  end if;
  if p_departure_id is null and not exists (
    select 1 from trip_plans where tenant_id = p_tenant and id = p_plan_id and trip_id = p_trip_id
  ) then
    raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
  end if;

  if p_departure_id is not null then
    select * into v_current from trip_departures
      where tenant_id = p_tenant and id = p_departure_id for update;
    if not found then raise exception 'DEPARTURE_NOT_FOUND' using errcode = 'P0002'; end if;
    if v_current.plan_id <> p_plan_id then
      raise exception 'PLAN_NOT_FOUND' using errcode = 'P0002';
    end if;
    if p_capacity < v_current.seats_booked then
      raise exception 'DEPARTURE_CAPACITY_BELOW_BOOKED' using errcode = 'P0001';
    end if;
    select coalesce(array_agg(staff_id order by staff_id), array[]::uuid[]) into v_existing_staff
      from trip_departure_staff where tenant_id = p_tenant and departure_id = p_departure_id;
    if v_primary is null then
      select staff_id into v_primary from trip_departure_staff
       where tenant_id = p_tenant and departure_id = p_departure_id and role = 'PRIMARY';
    end if;
    if p_assistant_staff_ids is null then
      select coalesce(array_agg(staff_id order by staff_id), array[]::uuid[]) into v_assistants
        from trip_departure_staff where tenant_id = p_tenant and departure_id = p_departure_id and role = 'ASSISTANT';
    else
      v_assistants := p_assistant_staff_ids;
    end if;
  else
    v_assistants := coalesce(p_assistant_staff_ids, array[]::uuid[]);
  end if;

  select count(*) into v_assignable_count from staff
   where tenant_id = p_tenant and active and bookable;
  if p_status = 'OPEN' and v_assignable_count = 0 then
    raise exception 'GUIDE_ONBOARDING_REQUIRED' using errcode = 'P0001';
  end if;
  if p_status = 'OPEN' and v_primary is null and v_assignable_count = 1 then
    select id into v_primary from staff where tenant_id = p_tenant and active and bookable limit 1;
  end if;
  if p_status = 'OPEN' and v_primary is null then
    raise exception 'PRIMARY_STAFF_REQUIRED' using errcode = 'P0001';
  end if;
  if v_primary is null then
    v_staff_ids := v_assistants;
  else
    v_staff_ids := array_append(coalesce(v_assistants, array[]::uuid[]), v_primary);
  end if;
  if cardinality(v_staff_ids) <> cardinality(array(select distinct x from unnest(v_staff_ids) as x)) then
    raise exception 'DEPARTURE_STAFF_DUPLICATE' using errcode = 'P0001';
  end if;

  -- Lock both the old and prospective staff.  This matters when a CLOSED
  -- departure changes time or people just as a booking is being written.
  perform lock_staff_availability(p_tenant, v_existing_staff || coalesce(v_staff_ids, array[]::uuid[]));
  select duration_minutes into v_duration from trip_plans where tenant_id = p_tenant and id = p_plan_id;
  v_start := ((p_departs_on + coalesce(p_start_time, time '00:00')) at time zone 'Asia/Taipei');
  v_end := case when p_start_time is null
                then ((p_departs_on + 1)::timestamp at time zone 'Asia/Taipei')
                else v_start + make_interval(mins => v_duration) end;
  if p_status <> 'CANCELLED' and cardinality(v_staff_ids) > 0 then
    perform assert_staff_available(p_tenant, v_staff_ids, v_start, v_end, null, p_departure_id);
  end if;

  if p_departure_id is null then
    insert into trip_departures (tenant_id, trip_id, plan_id, departs_on, start_time, capacity, status, note)
      values (p_tenant, p_trip_id, p_plan_id, p_departs_on, p_start_time, p_capacity, p_status::departure_status, coalesce(p_note, ''))
      returning id into v_result_id;
  else
    update trip_departures set departs_on = p_departs_on, start_time = p_start_time,
      capacity = p_capacity, status = p_status::departure_status, note = coalesce(p_note, '')
      where tenant_id = p_tenant and id = p_departure_id returning id into v_result_id;
  end if;
  delete from trip_departure_staff where tenant_id = p_tenant and departure_id = v_result_id;
  if v_primary is not null then
    insert into trip_departure_staff (tenant_id, departure_id, staff_id, role)
      values (p_tenant, v_result_id, v_primary, 'PRIMARY');
  end if;
  insert into trip_departure_staff (tenant_id, departure_id, staff_id, role)
    select p_tenant, v_result_id, assistant_id, 'ASSISTANT'::departure_staff_role
      from unnest(coalesce(v_assistants, array[]::uuid[])) as assistant_id;
  return v_result_id;
exception when unique_violation then
  raise exception 'DEPARTURE_DUPLICATE' using errcode = '23505';
end;
$$;

create or replace function public.create_trip_departures_batch_with_staff(
  p_tenant uuid, p_trip_id uuid, p_plan_id uuid, p_from date, p_to date,
  p_weekdays smallint[], p_start_time time, p_capacity integer,
  p_primary_staff_id uuid default null, p_assistant_staff_ids uuid[] default null
) returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_day date;
  v_id uuid;
  v_created uuid[] := array[]::uuid[];
  v_skipped integer := 0;
  v_conflicts jsonb := '[]'::jsonb;
begin
  if p_to < p_from then raise exception 'DEPARTURE_DATE_RANGE_INVALID' using errcode = 'P0001'; end if;
  for v_day in select d::date from generate_series(p_from, p_to, interval '1 day') as d
                 where extract(dow from d) = any(p_weekdays) loop
    begin
      if exists (select 1 from trip_departures where tenant_id = p_tenant and plan_id = p_plan_id
                   and departs_on = v_day and start_time is not distinct from p_start_time) then
        v_skipped := v_skipped + 1;
      else
        v_id := save_trip_departure_with_staff(p_tenant, p_trip_id, p_plan_id, null, v_day,
          p_start_time, p_capacity, 'OPEN', '', p_primary_staff_id, p_assistant_staff_ids);
        v_created := array_append(v_created, v_id);
      end if;
    exception when others then
      if sqlstate in ('P0001', '23505') then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'date', v_day, 'staffId', coalesce(p_primary_staff_id::text, ''),
          'staffName', '', 'reason', sqlerrm));
      else
        raise;
      end if;
    end;
  end loop;
  return jsonb_build_object('createdIds', to_jsonb(v_created), 'skipped', v_skipped, 'conflicts', v_conflicts);
end;
$$;

create or replace function public.create_booking_with_availability(
  p_tenant uuid, p_customer_id uuid, p_service_id uuid, p_staff_id uuid,
  p_start timestamptz, p_note text default ''
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_service services%rowtype;
  v_booking_id uuid;
  v_prefix text := 'B' || to_char(now() at time zone 'Asia/Taipei', 'YYMMDD');
  v_booking_no text;
begin
  if not is_tenant_member(p_tenant) then raise exception 'TENANT_MEMBER_REQUIRED' using errcode = '42501'; end if;
  select * into v_service from services where tenant_id = p_tenant and id = p_service_id;
  if not found then raise exception 'SERVICE_NOT_FOUND' using errcode = 'P0002'; end if;
  if not exists (select 1 from customers where tenant_id = p_tenant and id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_staff_id is not null then
    perform assert_staff_available(p_tenant, array[p_staff_id], p_start,
      p_start + make_interval(mins => v_service.duration_minutes));
  end if;
  perform pg_advisory_xact_lock(hashtext('booking-number:' || p_tenant::text));
  select v_prefix || lpad((coalesce(max(substring(booking_no from 8)::integer), 0) + 1)::text, 4, '0')
    into v_booking_no from bookings where tenant_id = p_tenant and booking_no like v_prefix || '%';
  insert into bookings (tenant_id, booking_no, customer_id, service_id, staff_id, start_at, end_at,
    duration_minutes, price, final_price, source, note)
    values (p_tenant, v_booking_no, p_customer_id, p_service_id, p_staff_id, p_start,
      p_start + make_interval(mins => v_service.duration_minutes), v_service.duration_minutes,
      v_service.price, v_service.price, 'MANUAL', coalesce(p_note, '')) returning id into v_booking_id;
  return v_booking_id;
end;
$$;

create or replace function public.update_booking_with_availability(
  p_tenant uuid, p_booking_id uuid, p_start timestamptz, p_staff_id uuid, p_note text
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_booking bookings%rowtype;
begin
  if not is_tenant_member(p_tenant) then raise exception 'TENANT_MEMBER_REQUIRED' using errcode = '42501'; end if;
  select * into v_booking from bookings where tenant_id = p_tenant and id = p_booking_id for update;
  if not found then raise exception 'BOOKING_NOT_FOUND' using errcode = 'P0002'; end if;
  if p_staff_id is not null then
    perform assert_staff_available(p_tenant, array[p_staff_id], p_start,
      p_start + make_interval(mins => v_booking.duration_minutes), p_booking_id);
  end if;
  update bookings set start_at = p_start,
    end_at = p_start + make_interval(mins => v_booking.duration_minutes),
    staff_id = p_staff_id, note = coalesce(p_note, ''), updated_at = now()
    where tenant_id = p_tenant and id = p_booking_id;
  return p_booking_id;
end;
$$;

create or replace function public.complete_tour_order_with_performance(
  p_tenant uuid, p_order_id uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_order tour_orders%rowtype;
  v_primary uuid;
begin
  if not tenant_role_at_least(p_tenant, 'MANAGER') then raise exception 'TENANT_MANAGER_REQUIRED' using errcode = '42501'; end if;
  -- CAS is deliberately the first write: only CONFIRMED may enter this
  -- transaction, and a second completion cannot rewrite frozen snapshots.
  update tour_orders set status = 'COMPLETED', updated_at = now()
   where tenant_id = p_tenant and id = p_order_id and status = 'CONFIRMED'
   returning * into v_order;
  if not found then
    if exists (select 1 from tour_orders where tenant_id = p_tenant and id = p_order_id) then
      raise exception 'TOUR_ORDER_COMPLETE_STATE' using errcode = 'P0001';
    end if;
    raise exception 'TOUR_ORDER_NOT_FOUND' using errcode = 'P0002';
  end if;
  select staff_id into v_primary from trip_departure_staff
   where tenant_id = p_tenant and departure_id = v_order.departure_id and role = 'PRIMARY';
  if exists (select 1 from tour_order_addons where tenant_id = p_tenant and order_id = p_order_id
             and performance_mode = 'PRIMARY') and v_primary is null then
    raise exception 'TOUR_ORDER_PRIMARY_STAFF_REQUIRED' using errcode = 'P0001';
  end if;
  update tour_order_addons set
    performance_staff_id = case performance_mode
      when 'PRIMARY' then v_primary
      when 'SPECIFIC_STAFF' then specific_staff_id
      else null end,
    performance_amount = case when performance_mode = 'NONE' then null else applied_amount end,
    performance_frozen_at = now()
   where tenant_id = p_tenant and order_id = p_order_id and performance_frozen_at is null;
  if exists (select 1 from tour_order_addons where tenant_id = p_tenant and order_id = p_order_id
             and performance_frozen_at is null) then
    raise exception 'TOUR_ORDER_ADDON_SNAPSHOT_INCOMPLETE' using errcode = 'P0001';
  end if;
  return p_order_id;
end;
$$;

-- RPCs remain invoker-security and enforce tenant membership/manager role;
-- direct anonymous calls are not useful and should not be exposed implicitly.
revoke execute on function public.lock_staff_availability(uuid, uuid[]) from anon;
revoke execute on function public.assert_staff_available(uuid, uuid[], timestamptz, timestamptz, uuid, uuid) from anon;
revoke execute on function public.save_trip_departure_with_staff(uuid, uuid, uuid, uuid, date, time, integer, text, text, uuid, uuid[]) from anon;
revoke execute on function public.create_trip_departures_batch_with_staff(uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]) from anon;
revoke execute on function public.create_booking_with_availability(uuid, uuid, uuid, uuid, timestamptz, text) from anon;
revoke execute on function public.update_booking_with_availability(uuid, uuid, timestamptz, uuid, text) from anon;
revoke execute on function public.complete_tour_order_with_performance(uuid, uuid) from anon;
