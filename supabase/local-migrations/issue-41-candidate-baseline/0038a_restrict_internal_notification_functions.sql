-- Follow-up for TEST environments where 0038 was applied before the explicit
-- service_role revoke was added. The function owner keeps its implicit right,
-- so the booking trigger continues to work while PostgREST cannot expose these
-- internal entry points to service-role clients.

revoke execute on function public.enqueue_notification_event(uuid, text, text, text, text, jsonb)
  from service_role;
revoke execute on function public.enqueue_booking_notification_event()
  from service_role;
