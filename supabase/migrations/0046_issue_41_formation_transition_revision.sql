-- 0046 — #41 formation event epochs
--
-- This is deliberately forward-only: 0040/0041 may already have produced
-- outbox rows, so rewriting either migration would not repair an installed
-- database.  A persisted revision distinguishes recurring state transitions
-- without changing the meaning of an existing event key.

alter table public.trip_departures
  add column if not exists formation_transition_revision pg_catalog.int8 not null default 0;

alter table public.trip_departures
  drop constraint if exists trip_departures_formation_transition_revision_check,
  add constraint trip_departures_formation_transition_revision_check
    check (formation_transition_revision >= 0);

-- The departure row is already locked by the #41 lifecycle routines.  Keeping
-- the increment in a BEFORE trigger also covers future lifecycle callers and
-- makes an EXTEND/CONTINUE transition consume an epoch even when it emits no
-- notification itself.
create or replace function public.bump_formation_transition_revision_41()
returns pg_catalog.trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.formation_status is distinct from old.formation_status then
    new.formation_transition_revision := old.formation_transition_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists t_trip_departures_formation_transition_revision_41 on public.trip_departures;
create trigger t_trip_departures_formation_transition_revision_41
  before update of formation_status on public.trip_departures
  for each row execute function public.bump_formation_transition_revision_41();

-- #40 remains optional.  If its outbox function is present, append the stored
-- transition epoch to each lifecycle key.  A later REVIEW_REQUIRED after
-- EXTEND and a later AT_RISK after CONTINUE therefore cannot conflict with an
-- earlier event for the same departure/count.  The revision is also copied to
-- the payload for consumer-side ordering and diagnostics.
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
declare
  v_revision pg_catalog.int8;
  v_key pg_catalog.text := p_idempotency_key;
  v_payload pg_catalog.jsonb := coalesce(p_payload, '{}'::pg_catalog.jsonb);
begin
  if p_aggregate_type = 'TOUR_DEPARTURE' then
    select formation_transition_revision into v_revision
    from public.trip_departures
    where id = p_aggregate_id::pg_catalog.uuid;

    if found then
      v_key := p_idempotency_key || ':r' || v_revision::pg_catalog.text;
      v_payload := v_payload || pg_catalog.jsonb_build_object(
        'formationTransitionRevision', v_revision
      );
    end if;
  end if;

  if pg_catalog.to_regprocedure(
    'public.enqueue_notification_event(uuid,text,text,text,text,jsonb)'
  ) is null then
    raise exception 'NOTIFICATION_OUTBOX_UNAVAILABLE' using errcode = 'P0001';
  end if;
  execute 'select public.enqueue_notification_event($1, $2, $3, $4, $5, $6)'
    using p_tenant, p_event_name, p_aggregate_type, p_aggregate_id,
      v_key, v_payload;
end;
$$;

revoke execute on function public.bump_formation_transition_revision_41()
  from public, anon, authenticated, service_role;
revoke execute on function public.enqueue_formation_notification_41(
  pg_catalog.uuid, pg_catalog.text, pg_catalog.text, pg_catalog.text,
  pg_catalog.text, pg_catalog.jsonb
) from public, anon, authenticated, service_role;
revoke execute on function public.qualifying_tour_participants(pg_catalog.uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.refresh_departure_formation(pg_catalog.uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.refresh_tour_order_formation_trigger()
  from public, anon, authenticated, service_role;
revoke execute on function public.review_expired_tour_formations(pg_catalog.timestamptz)
  from public, anon, authenticated;
revoke execute on function public.decide_tour_formation(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid,
  pg_catalog.timestamptz, pg_catalog.text
) from public, anon, authenticated;
grant execute on function public.review_expired_tour_formations(pg_catalog.timestamptz)
  to service_role;
grant execute on function public.decide_tour_formation(
  pg_catalog.uuid, pg_catalog.uuid, pg_catalog.text, pg_catalog.uuid,
  pg_catalog.timestamptz, pg_catalog.text
) to service_role;
