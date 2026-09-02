-- 0022_issue_8_tour_rest_dml_acl.sql — #8-A route-boundary hardening
--
-- The core tour tables are written through authenticated server routes. Direct
-- PostgREST DML must not bypass the route's MANAGER and TOUR_MODULE checks.
-- requireTenantManager() performs those checks before handing the route a
-- server-only service-role client for its explicitly tenant-scoped mutation.
--
-- Keep SELECT available for authenticated route reads; RLS still limits those
-- reads to tenant members. The service_role grant is intentionally untouched.

revoke insert, update, delete, truncate on table public.trips
  from anon, authenticated;

revoke insert, update, delete, truncate on table public.trip_plans
  from anon, authenticated;

revoke insert, update, delete, truncate on table public.trip_departures
  from anon, authenticated;

revoke insert, update, delete, truncate on table public.trip_addons
  from anon, authenticated;
