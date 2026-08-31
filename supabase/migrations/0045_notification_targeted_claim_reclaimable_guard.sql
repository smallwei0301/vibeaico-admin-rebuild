-- 0045 — repair TEST drift in targeted notification delivery claims
--
-- TEST recorded 0044 before its final reclaimable guard. Keep the original
-- migration immutable and repair the live function with a forward migration.

create or replace function public.claim_notification_delivery_for_outbox(
  p_outbox_id uuid
) returns setof public.notification_deliveries
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_outbox_id is null then
    raise exception 'p_outbox_id is required';
  end if;

  return query
  with candidate as (
    select d.id
    from public.notification_deliveries d
    where d.outbox_id = p_outbox_id
      and (
        (d.status in ('PENDING', 'RETRY') and d.next_attempt_at <= pg_catalog.now())
        or (
          d.status = 'PROCESSING'
          and d.reclaimable
          and d.processing_started_at < pg_catalog.now() - interval '10 minutes'
        )
      )
    order by d.next_attempt_at, d.created_at
    for update skip locked
    limit 1
  )
  update public.notification_deliveries d
  set status = 'PROCESSING',
      claim_token = pg_catalog.gen_random_uuid(),
      processing_started_at = pg_catalog.now(),
      last_attempt_at = pg_catalog.now()
  from candidate
  where d.id = candidate.id
  returning d.*;
end;
$$;

revoke execute on function public.claim_notification_delivery_for_outbox(uuid)
  from public, anon, authenticated;
grant execute on function public.claim_notification_delivery_for_outbox(uuid)
  to service_role;
