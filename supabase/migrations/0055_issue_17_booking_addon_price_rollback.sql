-- Issue #17 forward-only rollback correction.
-- 0054 is already recorded in TEST, so do not rewrite it. This migration only
-- replaces the delete RPC to preserve the current adjusted booking price while
-- preventing an add-on rollback from producing a negative receivable.

create or replace function public.delete_booking_addon_17(
  p_tenant_id uuid, p_booking_id uuid, p_addon_id uuid
) returns table (final_price numeric, duration_minutes integer, end_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_booking public.bookings%rowtype;
  v_addon public.booking_addons%rowtype;
begin
  if not public.tenant_role_at_least(p_tenant_id, 'MANAGER') then
    raise exception 'BOOKING_ADDON_FORBIDDEN';
  end if;

  select * into v_booking from public.bookings
    where id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_BOOKING_NOT_FOUND'; end if;
  if v_booking.status not in ('PENDING', 'CONFIRMED') then
    raise exception 'BOOKING_ADDON_STATUS_CONFLICT';
  end if;

  select * into v_addon from public.booking_addons
    where id = p_addon_id and booking_id = p_booking_id and tenant_id = p_tenant_id for update;
  if not found then raise exception 'BOOKING_ADDON_NOT_FOUND'; end if;

  if v_addon.applied_amount is null or v_addon.applied_amount < 0
     or v_addon.applied_minutes is null or v_addon.applied_minutes < 0 then
    raise exception 'BOOKING_ADDON_SNAPSHOT_CONFLICT';
  end if;
  if v_booking.duration_minutes < v_addon.applied_minutes
     or v_booking.end_at - make_interval(mins => v_addon.applied_minutes) <= v_booking.start_at then
    raise exception 'BOOKING_ADDON_DURATION_CONFLICT';
  end if;

  delete from public.booking_addons
  where id = p_addon_id and tenant_id = p_tenant_id;

  update public.bookings set
    -- Preserve any later price adjustment/discount. Roll back only the amount
    -- originally contributed by this add-on, with the Issue #17 non-negative
    -- receivable floor.
    final_price = greatest(public.bookings.final_price - v_addon.applied_amount, 0),
    duration_minutes = public.bookings.duration_minutes - v_addon.applied_minutes,
    end_at = public.bookings.end_at - make_interval(mins => v_addon.applied_minutes)
  where id = p_booking_id and tenant_id = p_tenant_id
  returning public.bookings.final_price, public.bookings.duration_minutes, public.bookings.end_at
  into final_price, duration_minutes, end_at;

  return next;
end $$;

-- Keep the 0054 ACL contract explicit after the replacement.
revoke all on function public.delete_booking_addon_17(uuid,uuid,uuid)
  from public, anon, service_role;
grant execute on function public.delete_booking_addon_17(uuid,uuid,uuid)
  to authenticated;
