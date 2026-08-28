-- 0037_issue_37_batch_error_classification.sql — issue #37 batch conflict boundary
--
-- 0035 allowed every P0001 from a per-date save to look like an availability
-- conflict.  That accidentally converted onboarding, missing-primary and
-- invalid-configuration errors into a successful batch response.  Keep
-- per-date partial success only for genuine occupancy/duplicate conflicts.
-- Re-raise every other error so PostgreSQL rolls back the whole RPC call and
-- no half-created departures survive a configuration failure.

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
  if p_to < p_from then
    raise exception 'DEPARTURE_DATE_RANGE_INVALID' using errcode = 'P0001';
  end if;

  for v_day in
    select d::date
      from generate_series(p_from, p_to, interval '1 day') as d
     where extract(dow from d) = any(p_weekdays)
  loop
    begin
      if exists (
        select 1
          from trip_departures
         where tenant_id = p_tenant
           and plan_id = p_plan_id
           and departs_on = v_day
           and start_time is not distinct from p_start_time
      ) then
        v_skipped := v_skipped + 1;
      else
        v_id := save_trip_departure_with_staff(
          p_tenant, p_trip_id, p_plan_id, null, v_day, p_start_time,
          p_capacity, 'OPEN', '', p_primary_staff_id, p_assistant_staff_ids
        );
        v_created := array_append(v_created, v_id);
      end if;
    exception when others then
      -- Only save_trip_departure_with_staff's explicit, per-date conflict
      -- codes are eligible for partial success.  Do not broaden this branch:
      -- GUIDE_ONBOARDING_REQUIRED, PRIMARY_STAFF_REQUIRED, malformed input,
      -- cross-tenant staff and all unknown failures must abort and roll back.
      if sqlstate = 'P0001' and (
        sqlerrm like 'AVAILABILITY_%'
        or sqlerrm = 'DEPARTURE_DUPLICATE'
      ) then
        v_conflicts := v_conflicts || jsonb_build_array(jsonb_build_object(
          'date', v_day,
          'staffId', coalesce(p_primary_staff_id::text, ''),
          'staffName', '',
          'reason', sqlerrm
        ));
      else
        raise;
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'createdIds', to_jsonb(v_created),
    'skipped', v_skipped,
    'conflicts', v_conflicts
  );
end;
$$;

revoke execute on function public.create_trip_departures_batch_with_staff(
  uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]
) from public;
grant execute on function public.create_trip_departures_batch_with_staff(
  uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]
) to authenticated;
