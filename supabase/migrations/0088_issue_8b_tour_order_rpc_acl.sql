-- Phase 8b / #8-B: close SECURITY DEFINER RPC execute privileges.
--
-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Revoking only the
-- anon/authenticated roles is therefore insufficient because those roles still inherit
-- PUBLIC privileges. These four RPCs bypass RLS and can change seat/order state, so only
-- the server-side service_role may call them directly.

revoke all on function public.reserve_seats(uuid, integer) from public;
revoke all on function public.reserve_seats(uuid, integer) from anon, authenticated;
grant execute on function public.reserve_seats(uuid, integer) to service_role;

revoke all on function public.release_seats(uuid, integer) from public;
revoke all on function public.release_seats(uuid, integer) from anon, authenticated;
grant execute on function public.release_seats(uuid, integer) to service_role;

revoke all on function public.create_tour_order(
  uuid,
  text,
  uuid,
  integer,
  uuid,
  jsonb,
  public.tour_order_source,
  uuid,
  text,
  timestamptz
) from public;
revoke all on function public.create_tour_order(
  uuid,
  text,
  uuid,
  integer,
  uuid,
  jsonb,
  public.tour_order_source,
  uuid,
  text,
  timestamptz
) from anon, authenticated;
grant execute on function public.create_tour_order(
  uuid,
  text,
  uuid,
  integer,
  uuid,
  jsonb,
  public.tour_order_source,
  uuid,
  text,
  timestamptz
) to service_role;

revoke all on function public.cancel_tour_order(uuid, uuid, text) from public;
revoke all on function public.cancel_tour_order(uuid, uuid, text) from anon, authenticated;
grant execute on function public.cancel_tour_order(uuid, uuid, text) to service_role;
