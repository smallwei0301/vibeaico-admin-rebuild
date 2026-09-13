-- 0083 — persist the four staff fields the staff page was fabricating locally.
--
-- Same defect family as 0080 (issue #35): the page declared STAFF_EXTRAS_LOCAL_SHOP /
-- _GUIDE / _CLINIC records keyed by mock ids (s_1, s_2, …) and merged them into rows
-- that otherwise came from the database. On a real tenant the ids are uuids, so every
-- staff member silently fell back to DEFAULT_EXTRAS — a blank display name, a blank
-- bio, maxConcurrentBookings = 1 and visible = true — displayed next to their real
-- name and title. Those are not "unknown" placeholders; they read as settled values.
--
-- Unlike 0081, this is NOT a drift reconciliation: these four columns were verified
-- absent from BOTH projects before writing this file:
--
--   select column_name from information_schema.columns
--    where table_schema='public' and table_name='staff'
--      and column_name in ('display_name','bio','max_concurrent_bookings','visible');
--   -- egehnijjpgijmccagxac (Production) -> [] (2026-09-07)
--
-- So this migration really does add columns and requires an explicit, per-instance
-- Owner authorization before it is applied to Production.
--
-- Every statement is additive and idempotent. Defaults are chosen so existing rows
-- stay truthful without a backfill:
--
--   display_name             '' = "no separate display name; use staff.name"
--   bio                      '' = "no bio written yet"
--   max_concurrent_bookings  1  = one booking at a time, the safest reading of an
--                                 unset value (a larger number would let the system
--                                 double-book a person who never opted into it)
--   visible                  true = keep current behaviour; staff are already shown
--
-- max_concurrent_bookings is constrained to >= 1: 0 would silently make a staff
-- member unbookable through a field whose name does not say that, and negative
-- values are meaningless.

alter table public.staff
  add column if not exists display_name text not null default '';

alter table public.staff
  add column if not exists bio text not null default '';

alter table public.staff
  add column if not exists max_concurrent_bookings integer not null default 1;

alter table public.staff
  add column if not exists visible boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'staff_max_concurrent_bookings_chk'
      and conrelid = 'public.staff'::regclass
  ) then
    alter table public.staff
      add constraint staff_max_concurrent_bookings_chk
      check (max_concurrent_bookings >= 1);
  end if;
end
$$;

comment on column public.staff.display_name is
  'Public-facing name shown to customers. Empty string = fall back to staff.name.';
comment on column public.staff.bio is
  'Free-text introduction shown on the storefront. Empty string = none written.';
comment on column public.staff.max_concurrent_bookings is
  'How many bookings this person can hold in the same slot. Always >= 1.';
comment on column public.staff.visible is
  'Whether this staff member is shown on the customer-facing storefront.';
