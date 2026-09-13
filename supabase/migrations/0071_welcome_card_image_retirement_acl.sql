-- #152 — defense-in-depth for internal welcome-card retirement state.
-- 0070 is already part of TEST history, so harden it with a forward-only
-- migration instead of rewriting an applied migration.

alter function public.prevent_retired_welcome_card_image()
  set search_path = '';

alter function public.retire_welcome_card_image(uuid, text)
  set search_path = '';

revoke all on table public.welcome_card_image_retirements
  from public, anon, authenticated;

grant select, insert, delete on table public.welcome_card_image_retirements
  to service_role;

revoke execute on function public.prevent_retired_welcome_card_image()
  from public, anon, authenticated;

grant execute on function public.prevent_retired_welcome_card_image()
  to service_role;

revoke execute on function public.retire_welcome_card_image(uuid, text)
  from public, anon, authenticated;

grant execute on function public.retire_welcome_card_image(uuid, text)
  to service_role;
