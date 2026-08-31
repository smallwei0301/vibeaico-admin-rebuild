-- 0052 — NONE has no upfront receipt requirement: confirm it on creation so
-- qualifying_tour_participants can count it without pretending money arrived.
create or replace function public.confirm_none_tour_order_41()
returns pg_catalog.trigger
language plpgsql security definer set search_path = ''
as $$
begin
  if new.deposit_mode_snapshot = 'NONE' then
    new.status := 'CONFIRMED';
    new.payment_status := 'UNPAID';
    new.hold_expires_at := null;
  end if;
  return new;
end;
$$;
drop trigger if exists t_tour_orders_z_none_auto_confirm_41 on public.tour_orders;
create trigger t_tour_orders_z_none_auto_confirm_41
  before insert on public.tour_orders
  for each row execute function public.confirm_none_tour_order_41();
revoke execute on function public.confirm_none_tour_order_41()
  from public, anon, authenticated, service_role;
