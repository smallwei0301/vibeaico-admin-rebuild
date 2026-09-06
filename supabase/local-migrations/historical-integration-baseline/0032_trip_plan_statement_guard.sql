-- 0032_trip_plan_statement_guard.sql — issue #8: bounded batch plan guard.
--
-- 0030/0031 can already be present in TEST.  This forward migration replaces
-- their row-level count trigger with transition-table statement triggers, so
-- importing 99/100 plans does one parent lock/count per affected trip rather
-- than one growing scan per inserted plan.  It is safe to rerun.

lock table public.trip_plans in share row exclusive mode;

do $$
declare
  v_trip_id uuid;
  v_plan_count bigint;
begin
  select tp.trip_id, count(*)
    into v_trip_id, v_plan_count
    from public.trip_plans tp
   group by tp.trip_id
  having count(*) > 100
   order by tp.trip_id
   limit 1;

  if found then
    raise exception using
      errcode = 'P0001',
      message = format('0032 trip-plan preflight failed: trip %s has %s plans (limit 100)', v_trip_id, v_plan_count),
      hint = 'Repair this legacy trip to at most 100 plans, then rerun migration 0032. No trigger changes were applied.';
  end if;
end;
$$;

create or replace function public.enforce_trip_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_target record;
begin
  -- Both statement triggers name their NEW transition relation identically.
  -- Slug order matches import_trips_atomic's pre-lock order, avoiding a
  -- cross-writer parent-lock inversion for multi-trip statements.
  for v_target in
    select n.tenant_id, n.trip_id
      from new_trip_plans n
      join public.trips t on t.tenant_id = n.tenant_id and t.id = n.trip_id
     group by n.tenant_id, n.trip_id, t.slug
     order by n.tenant_id, t.slug, n.trip_id
  loop
    perform 1
      from public.trips t
     where t.tenant_id = v_target.tenant_id
       and t.id = v_target.trip_id
     for no key update;

    if not found then
      raise exception 'TRIP_PLAN_PARENT_NOT_FOUND' using errcode = '23503';
    end if;

    if (
      select count(*)
        from public.trip_plans tp
       where tp.tenant_id = v_target.tenant_id
         and tp.trip_id = v_target.trip_id
    ) > 100 then
      raise exception 'TRIP_PLAN_LIMIT: a trip may have at most 100 plans'
        using errcode = 'P0001';
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.enforce_trip_plan_limit() from public;
revoke all on function public.enforce_trip_plan_limit() from anon;
revoke all on function public.enforce_trip_plan_limit() from authenticated;
revoke all on function public.enforce_trip_plan_limit() from service_role;

-- A transition table cannot be combined with UPDATE OF columns in PostgreSQL,
-- so the UPDATE trigger is statement-wide but still constant-work per
-- distinct destination trip.  It enforces a plan moved into a full trip.
drop trigger if exists trip_plan_limit_guard on public.trip_plans;
drop trigger if exists trip_plan_limit_guard_update on public.trip_plans;
create trigger trip_plan_limit_guard
after insert on public.trip_plans
referencing new table as new_trip_plans
for each statement execute function public.enforce_trip_plan_limit();
create trigger trip_plan_limit_guard_update
after update on public.trip_plans
referencing new table as new_trip_plans
for each statement execute function public.enforce_trip_plan_limit();
