-- 0036_issue_37_rpc_execute_privileges.sql — issue #37 source-only security repair
--
-- PostgreSQL grants new functions EXECUTE to PUBLIC by default.  0035 revoked
-- anon directly, but anon still inherited PUBLIC.  Keep the invoker-security
-- and tenant/role guards in 0035; this migration only narrows callable roles.

revoke execute on function public.lock_staff_availability(uuid, uuid[]) from public;
revoke execute on function public.assert_staff_available(uuid, uuid[], timestamptz, timestamptz, uuid, uuid) from public;
revoke execute on function public.save_trip_departure_with_staff(uuid, uuid, uuid, uuid, date, time, integer, text, text, uuid, uuid[]) from public;
revoke execute on function public.create_trip_departures_batch_with_staff(uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]) from public;
revoke execute on function public.create_booking_with_availability(uuid, uuid, uuid, uuid, timestamptz, text) from public;
revoke execute on function public.update_booking_with_availability(uuid, uuid, timestamptz, uuid, text) from public;
revoke execute on function public.complete_tour_order_with_performance(uuid, uuid) from public;

revoke execute on function public.lock_staff_availability(uuid, uuid[]) from anon;
revoke execute on function public.assert_staff_available(uuid, uuid[], timestamptz, timestamptz, uuid, uuid) from anon;
revoke execute on function public.save_trip_departure_with_staff(uuid, uuid, uuid, uuid, date, time, integer, text, text, uuid, uuid[]) from anon;
revoke execute on function public.create_trip_departures_batch_with_staff(uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]) from anon;
revoke execute on function public.create_booking_with_availability(uuid, uuid, uuid, uuid, timestamptz, text) from anon;
revoke execute on function public.update_booking_with_availability(uuid, uuid, timestamptz, uuid, text) from anon;
revoke execute on function public.complete_tour_order_with_performance(uuid, uuid) from anon;

grant execute on function public.lock_staff_availability(uuid, uuid[]) to authenticated;
grant execute on function public.assert_staff_available(uuid, uuid[], timestamptz, timestamptz, uuid, uuid) to authenticated;
grant execute on function public.save_trip_departure_with_staff(uuid, uuid, uuid, uuid, date, time, integer, text, text, uuid, uuid[]) to authenticated;
grant execute on function public.create_trip_departures_batch_with_staff(uuid, uuid, uuid, date, date, smallint[], time, integer, uuid, uuid[]) to authenticated;
grant execute on function public.create_booking_with_availability(uuid, uuid, uuid, uuid, timestamptz, text) to authenticated;
grant execute on function public.update_booking_with_availability(uuid, uuid, timestamptz, uuid, text) to authenticated;
grant execute on function public.complete_tour_order_with_performance(uuid, uuid) to authenticated;
