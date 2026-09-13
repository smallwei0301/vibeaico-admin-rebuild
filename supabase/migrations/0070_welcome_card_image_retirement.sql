-- #28⑥ — serialize welcome-card image cleanup with settings references.
-- Storage deletion and Postgres writes cannot share one transaction. The
-- retirement row plus the advisory lock closes the race where a cleanup check
-- passes and a concurrent manager restores the same URL before deletion.
create table if not exists public.welcome_card_image_retirements (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  image_url  text not null check (length(image_url) > 0),
  retired_at timestamptz not null default now(),
  primary key (tenant_id, image_url)
);

alter table public.welcome_card_image_retirements enable row level security;

create or replace function public.prevent_retired_welcome_card_image()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  old_url text := case when tg_op = 'UPDATE'
    then coalesce(old.notify->>'welcomeCardImageUrl', '') else '' end;
  next_url text := coalesce(new.notify->>'welcomeCardImageUrl', '');
  old_key integer;
  next_key integer;
begin
  -- Lock both sides in a stable order so URL swaps cannot deadlock. The
  -- cleanup RPC takes the same per-tenant/per-URL lock.
  if old_url <> '' and next_url <> '' and old_url <> next_url then
    old_key := hashtext(new.tenant_id::text || ':' || old_url);
    next_key := hashtext(new.tenant_id::text || ':' || next_url);
    if old_key <= next_key then
      perform pg_advisory_xact_lock(old_key);
      perform pg_advisory_xact_lock(next_key);
    else
      perform pg_advisory_xact_lock(next_key);
      perform pg_advisory_xact_lock(old_key);
    end if;
  elsif next_url <> '' then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text || ':' || next_url));
  elsif old_url <> '' then
    perform pg_advisory_xact_lock(hashtext(new.tenant_id::text || ':' || old_url));
  end if;

  if next_url <> '' and exists (
    select 1
      from public.welcome_card_image_retirements
     where tenant_id = new.tenant_id
       and image_url = next_url
  ) then
    raise exception 'welcome card image has been retired'
      using errcode = '23514',
            constraint = 'welcome_card_image_not_retired';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_prevent_retired_welcome_card_image on public.tenant_settings;
create trigger trg_prevent_retired_welcome_card_image
before insert or update of tenant_id, notify on public.tenant_settings
for each row execute function public.prevent_retired_welcome_card_image();

create or replace function public.retire_welcome_card_image(
  p_tenant_id uuid,
  p_image_url text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_url text;
begin
  if p_tenant_id is null or p_image_url is null or p_image_url = '' then
    return false;
  end if;

  perform pg_advisory_xact_lock(hashtext(p_tenant_id::text || ':' || p_image_url));

  select notify->>'welcomeCardImageUrl'
    into current_url
    from public.tenant_settings
   where tenant_id = p_tenant_id;
  if current_url = p_image_url then
    return false;
  end if;

  insert into public.welcome_card_image_retirements (tenant_id, image_url)
  values (p_tenant_id, p_image_url)
  on conflict (tenant_id, image_url) do nothing;
  return true;
end;
$$;

revoke execute on function public.retire_welcome_card_image(uuid, text) from public, anon, authenticated;
grant execute on function public.retire_welcome_card_image(uuid, text) to service_role;
