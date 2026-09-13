-- 0082 — Issue #197 historical drift reconciliation, slice 2.
--
-- Read-only verification on 2026-09-07 confirmed TEST and Production expose the
-- exact same contracts below, while current-main migrations still cannot create
-- them from a fresh database. This migration makes the repository reproducible;
-- it is intentionally idempotent and is NOT authorization to mutate TEST or
-- Production.
--
-- Verified live contract:
--   bug_reports.attachment_path            text not null default ''
--   booking_addons.applied_amount          numeric not null default 0
--   booking_addons.applied_minutes         integer not null default 0
--   booking_addons.notified                text not null default 'NONE'
--   bookings.coupon_discount               numeric null
--   bookings.points_redeemed               integer null
--   tenants.owner_notify_max_recipients    integer not null default 3
--
-- Two live constraints are also canonicalized:
--   booking_addons_notified_check
--   tenants_owner_notify_max_recipients_check
--
-- bookings_view is rebuilt after the bookings columns are added. The live view
-- exposes b.* plus customer/service/staff display data and customer_points. A
-- plain CREATE OR REPLACE is unsafe when b.* gains columns because PostgreSQL
-- can reject changed view-column positions; drop + create matches the historical
-- repair pattern and keeps security_invoker=true.

alter table public.bug_reports
  add column if not exists attachment_path text not null default '';

alter table public.booking_addons
  add column if not exists applied_amount numeric not null default 0,
  add column if not exists applied_minutes integer not null default 0,
  add column if not exists notified text not null default 'NONE';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'booking_addons_notified_check'
      and conrelid = 'public.booking_addons'::regclass
  ) then
    alter table public.booking_addons
      add constraint booking_addons_notified_check
      check (notified = any (array[
        'NONE'::text,
        'LINE'::text,
        'NO_LINE'::text,
        'NOT_CONFIGURED'::text,
        'QUOTA_EXCEEDED'::text,
        'FAILED'::text
      ]));
  end if;
end
$$;

alter table public.bookings
  add column if not exists coupon_discount numeric,
  add column if not exists points_redeemed integer;

drop view if exists public.bookings_view;
create view public.bookings_view with (security_invoker = true) as
select b.id,
       b.tenant_id,
       b.booking_no,
       b.customer_id,
       b.service_id,
       b.staff_id,
       b.start_at,
       b.end_at,
       b.duration_minutes,
       b.price,
       b.final_price,
       b.status,
       b.payment_status,
       b.source,
       b.note,
       b.cancel_reason,
       b.custom_fields,
       b.created_at,
       b.updated_at,
       b.reminder_sent_at,
       b.coupon_discount,
       b.points_redeemed,
       c.name as customer_name,
       c.phone as customer_phone,
       s.name as service_name,
       st.name as staff_name,
       c.points as customer_points
from public.bookings b
join public.customers c on c.id = b.customer_id
join public.services s on s.id = b.service_id
left join public.staff st on st.id = b.staff_id;

alter table public.tenants
  add column if not exists owner_notify_max_recipients integer not null default 3;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'tenants_owner_notify_max_recipients_check'
      and conrelid = 'public.tenants'::regclass
  ) then
    alter table public.tenants
      add constraint tenants_owner_notify_max_recipients_check
      check (owner_notify_max_recipients >= 1 and owner_notify_max_recipients <= 20);
  end if;
end
$$;
