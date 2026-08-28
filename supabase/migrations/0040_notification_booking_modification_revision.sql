-- 0040 — #40 booking modification notification follow-up
--
-- 0038 is already recorded in TEST migration history. Keep it immutable and
-- apply this forward-only repair so TEST and fresh installs share the same
-- booking event contract.

alter table bookings
  add column if not exists notification_revision bigint not null default 0;

-- This revision is transaction-local state: a rollback restores it, so a
-- retry of the same transaction reuses the same idempotency key. A later,
-- distinct schedule or staff edit receives the next durable revision.
create or replace function public.bump_booking_notification_revision()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.start_at is distinct from old.start_at
     or new.staff_id is distinct from old.staff_id then
    new.notification_revision := old.notification_revision + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists t_bookings_notification_revision on bookings;
create trigger t_bookings_notification_revision
  before update of start_at, staff_id on bookings
  for each row execute function public.bump_booking_notification_revision();

create or replace function public.enqueue_booking_notification_event()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CREATED', 'BOOKING', new.id::text,
      'booking-created:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'CANCELLED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_CANCELLED', 'BOOKING', new.id::text,
      'booking-cancelled:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_CANCELLED', 'BOOKING', new.id::text,
      'booking-line-cancelled:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'CONFIRMED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_CONFIRMED', 'BOOKING', new.id::text,
      'booking-line-confirmed:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'COMPLETED' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_COMPLETED', 'BOOKING', new.id::text,
      'booking-line-completed:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is distinct from old.status and new.status = 'NO_SHOW' then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_NO_SHOW', 'BOOKING', new.id::text,
      'booking-line-no-show:' || new.id::text, jsonb_build_object('bookingId', new.id::text)
    );
  elsif new.status is not distinct from old.status and (
    new.start_at is distinct from old.start_at or new.staff_id is distinct from old.staff_id
  ) then
    perform public.enqueue_notification_event(
      new.tenant_id, 'BOOKING_LINE_MODIFIED', 'BOOKING', new.id::text,
      'booking-line-modified:' || new.id::text || ':v' || new.notification_revision::text,
      jsonb_build_object('bookingId', new.id::text)
    );
  end if;
  return new;
end;
$$;

drop trigger if exists t_bookings_notification_outbox on bookings;
create trigger t_bookings_notification_outbox
  after insert or update of status, start_at, staff_id on bookings
  for each row execute function public.enqueue_booking_notification_event();

-- Neither trigger function is an API RPC. Trigger invocation remains owned by
-- PostgreSQL while every API-facing role is explicitly denied direct EXECUTE.
revoke execute on function public.bump_booking_notification_revision() from public, anon, authenticated;
revoke execute on function public.enqueue_booking_notification_event() from public, anon, authenticated;
