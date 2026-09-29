-- #37: the controlled Production writer creates 0131 as
-- production_migration_owner.  That role can SELECT the historical
-- trip_departure_staff table but cannot DELETE/INSERT rows in it.  A SECURITY
-- DEFINER function owned by that role therefore cannot complete an actual
-- reassignment.  The only admitted caller is service_role, which already has
-- table DML privileges and BYPASSRLS; execute the unchanged, tenant-checking
-- function body with that caller's privileges instead.
--
-- This is an immutable successor to 0131, not a rewrite of its applied TEST
-- bytes.  ALTER FUNCTION fails if the exact 0131 signature is absent.  The
-- existing PUBLIC/anon/authenticated revokes and service_role grant remain.
alter function public.replace_trip_departure_staff(uuid, uuid, uuid, uuid[])
  security invoker;
