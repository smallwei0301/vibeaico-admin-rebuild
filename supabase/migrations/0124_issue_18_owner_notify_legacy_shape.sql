-- #18 compatibility precondition for the historical owner-notify recipient shape.
--
-- The disposable historical integration baseline can create
-- owner_notify_recipients before the two event switches were added to the
-- canonical 0116 migration. The controlled release planner executes this
-- idempotent precondition immediately before 0116, even though its identity is
-- newer, so the existing 0116 migration remains immutable and fail-closed.
-- A missing table is intentionally a no-op because 0116 owns table creation.

alter table if exists public.owner_notify_recipients
  add column if not exists notify_new_booking boolean not null default true,
  add column if not exists notify_cancel boolean not null default true;

alter table if exists public.owner_notify_recipients enable row level security;
