-- #18 compatibility repair for the historical owner-notify recipient shape.
--
-- The disposable historical integration baseline can create
-- owner_notify_recipients before the two event switches were added to the
-- canonical 0116 migration. Reconcile only missing columns here, before 0116
-- performs its fail-closed shape assertion. A missing table is intentionally a
-- no-op because 0116 owns the canonical table creation.

alter table if exists public.owner_notify_recipients
  add column if not exists notify_new_booking boolean not null default true,
  add column if not exists notify_cancel boolean not null default true;
