-- 0015 — persist fields previously fabricated by coupons/membership-levels pages
--
-- The pages used mode-local EXTRAS values for fields that are part of the
-- product contract. These columns are nullable/false-safe so existing rows
-- remain honest after migration; this migration only covers the two bounded pages.

alter table coupons
  add column if not exists min_order_amount numeric,
  add column if not exists max_discount_amount numeric,
  add column if not exists gift_item text not null default '',
  add column if not exists limit_per_customer int,
  add column if not exists private_mode boolean not null default false;

alter table membership_levels
  add column if not exists description text not null default '',
  add column if not exists active boolean not null default true,
  add column if not exists is_default boolean not null default false;

create unique index if not exists u_membership_levels_default
  on membership_levels (tenant_id)
  where is_default = true;

-- Setting a new default must replace the old default in the same transaction;
-- doing this in a trigger also keeps concurrent API writers behind the unique
-- index instead of leaving the endpoint with a clear-then-insert race.
create or replace function public.set_membership_level_default()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.is_default then
    update public.membership_levels
       set is_default = false
     where tenant_id = new.tenant_id
       and id <> new.id
       and is_default = true;
  end if;
  return new;
end;
$$;

revoke all on function public.set_membership_level_default() from public;

drop trigger if exists membership_levels_default_trigger on membership_levels;
create trigger membership_levels_default_trigger
before insert or update of tenant_id, is_default on membership_levels
for each row execute function public.set_membership_level_default();
