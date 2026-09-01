-- 0031_trip_plan_limit_lock_repair.sql — issue #8: repair already-applied 0030.
--
-- TEST environments may already have 0030.  This forward migration closes
-- its install race and changes the trigger's parent lock to the FK-compatible
-- strength without editing migration history.  Re-running is safe: the table
-- lock is transaction-scoped and CREATE OR REPLACE preserves the trigger's
-- function identity/signature while replacing its implementation.

lock table public.trip_plans in share row exclusive mode;

-- Recheck under the write-blocking table lock before changing live trigger
-- code.  If a writer raced the original 0030 preflight, fail loudly rather
-- than claiming a database-wide invariant over legacy 101+ rows.
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
      message = format('0031 trip-plan preflight failed: trip %s has %s plans (limit 100)', v_trip_id, v_plan_count),
      hint = 'Repair this legacy trip to at most 100 plans, then rerun migration 0031. No trigger changes were applied.';
  end if;
end;
$$;

create or replace function public.enforce_trip_plan_limit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform 1
    from public.trips t
   where t.tenant_id = new.tenant_id
     and t.id = new.trip_id
   for no key update;

  if not found then
    raise exception 'TRIP_PLAN_PARENT_NOT_FOUND' using errcode = '23503';
  end if;

  if (
    select count(*)
      from public.trip_plans tp
     where tp.tenant_id = new.tenant_id
       and tp.trip_id = new.trip_id
  ) > 100 then
    raise exception 'TRIP_PLAN_LIMIT: a trip may have at most 100 plans'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_trip_plan_limit() from public;
revoke all on function public.enforce_trip_plan_limit() from anon;
revoke all on function public.enforce_trip_plan_limit() from authenticated;
revoke all on function public.enforce_trip_plan_limit() from service_role;
