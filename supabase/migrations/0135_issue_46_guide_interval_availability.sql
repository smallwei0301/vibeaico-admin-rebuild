-- #46 SOURCE_PREPARE only. Owner: 2026-08-27-guide-availability-policy.md.
-- This read-only predicate reserves nothing. Writers still require atomic common
-- occupancy exclusion and departure duration snapshots before INSTANT activation.
begin;

alter table public.staff add column if not exists availability_policy text
  not null default 'DEFAULT_AVAILABLE';

do $$
begin
  if not exists (select 1 from information_schema.columns where table_schema='public'
    and table_name='staff' and column_name='availability_policy' and data_type='text'
    and is_nullable='NO' and column_default='''DEFAULT_AVAILABLE''::text') then
    raise exception 'staff.availability_policy incompatible shape';
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.staff'::regclass
    and conname='staff_availability_policy_check') then
    alter table public.staff add constraint staff_availability_policy_check
      check (availability_policy in ('DEFAULT_AVAILABLE','EXPLICIT_ONLY'));
  elsif not exists (select 1 from pg_catalog.pg_constraint where conrelid='public.staff'::regclass
    and conname='staff_availability_policy_check' and contype='c' and convalidated
    and pg_catalog.pg_get_constraintdef(oid) =
      'CHECK ((availability_policy = ANY (ARRAY[''DEFAULT_AVAILABLE''::text, ''EXPLICIT_ONLY''::text])))') then
    raise exception 'staff_availability_policy_check incompatible definition';
  end if;
end $$;

create or replace function public.guide_staff_interval_available(
  p_tenant uuid, p_staff uuid, p_start timestamptz, p_end timestamptz
) returns boolean
language plpgsql stable security invoker set search_path = pg_catalog, public
as $$
declare
  v_policy text;
  v_basic jsonb;
  v_zone text;
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
  if v_zone is null or v_zone='' or not exists
    (select 1 from pg_catalog.pg_timezone_names where name=v_zone) then return false; end if;
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
      case when d.start_time is null or pl.duration_minutes is null or pl.duration_minutes<=0
        then (d.departs_on+1)::timestamp else null::timestamp end,
      case when d.start_time is not null and pl.duration_minutes>0
        then make_interval(mins=>pl.duration_minutes) else null::interval end,
      d.start_time is null or pl.duration_minutes is null or pl.duration_minutes<=0,
      d.tenant_id=p_tenant and pl.tenant_id=p_tenant and pl.trip_id=d.trip_id
      from public.trip_departure_staff ds
      left join public.trip_departures d on d.id=ds.departure_id
      left join public.trip_plans pl on pl.id=d.plan_id
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
      -- finds the +11/-12 offsets of Kwajalein's 1969 23-hour backward change.
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
comment on function public.guide_staff_interval_available(uuid,uuid,timestamptz,timestamptz)
  is '#46 internal read-only availability; no lock/reservation or INSTANT activation authority';
commit;
