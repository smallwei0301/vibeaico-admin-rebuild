-- #589 Phase A — richmenu-assets retirement contract.
--
-- Storage deletion cannot share a transaction with `tenant_settings` writes.
-- This migration records an irreversible retirement only while the URL has no
-- current reference, then prevents a stale background/Flex editor from writing
-- that exact URL back after its Storage object has been removed.
--
-- Identity boundary: Postgres deliberately compares the persisted URL string
-- byte-for-byte. It does not attempt URL decoding, query/fragment stripping, or
-- origin validation. Phase B must call this RPC only with the canonical value
-- returned by tenantOwnedPublicStorageUrl(url, 'richmenu-assets', tenantId);
-- that existing parser rejects external, other-bucket, and other-tenant paths.

create table public.richmenu_asset_retirements (
  tenant_id  uuid not null references public.tenants(id) on delete cascade,
  image_url  text not null check (image_url <> ''),
  retired_at timestamptz not null default now(),
  primary key (tenant_id, image_url)
);

alter table public.richmenu_asset_retirements enable row level security;

-- One ordered, exact-string reference set for both the write trigger and
-- retirement RPC. Unknown JSON shape is rejected rather than treated as an
-- empty reference set: PB-052 says an irreversible cleanup must fail closed.
create or replace function public.richmenu_asset_references(p_line jsonb)
returns table(image_url text)
language plpgsql
immutable
set search_path = ''
as $$
begin
  if p_line is null or jsonb_typeof(p_line) <> 'object' then
    raise exception 'richmenu line JSON must be an object'
      using errcode = '22023';
  end if;

  if p_line ? 'richMenuBgImageUrl'
     and jsonb_typeof(p_line->'richMenuBgImageUrl') <> 'string' then
    raise exception 'richmenu background image URL must be a string'
      using errcode = '22023';
  end if;

  if p_line ? 'flexCards'
     and jsonb_typeof(p_line->'flexCards') <> 'array' then
    raise exception 'richmenu flexCards must be an array'
      using errcode = '22023';
  end if;

  if p_line ? 'flexCards'
     and exists (
       select 1
         from jsonb_array_elements(p_line->'flexCards') as card
        where jsonb_typeof(card) <> 'object'
           or (
             card ? 'imageUrl'
             and jsonb_typeof(card->'imageUrl') <> 'string'
           )
     ) then
    raise exception 'richmenu flexCards entries must be objects with string imageUrl values'
      using errcode = '22023';
  end if;

  return query
  with refs(image_url) as (
    select p_line->>'richMenuBgImageUrl'
    union all
    select card->>'imageUrl'
      from jsonb_array_elements(
        case when jsonb_typeof(p_line->'flexCards') = 'array'
          then p_line->'flexCards'
          else '[]'::jsonb
        end
      ) as card
  )
  select distinct refs.image_url
    from refs
   where refs.image_url is not null
     and refs.image_url <> ''
   order by refs.image_url;
end;
$$;

create or replace function public.prevent_retired_richmenu_asset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_image_url text;
begin
  -- Every writer takes all prospective URL locks in the same lexical order.
  -- A retirement RPC takes the same single tenant+URL lock before its reread.
  for v_image_url in
    select image_url
      from public.richmenu_asset_references(new.line)
     order by image_url
  loop
    perform pg_advisory_xact_lock(
      hashtext(new.tenant_id::text || ':' || v_image_url)
    );
  end loop;

  if exists (
    select 1
      from public.richmenu_asset_references(new.line) as candidate
      join public.richmenu_asset_retirements as retired
        on retired.tenant_id = new.tenant_id
       and retired.image_url = candidate.image_url
  ) then
    raise exception 'richmenu asset has been retired'
      using errcode = '23514',
            constraint = 'richmenu_asset_not_retired';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_prevent_retired_richmenu_asset on public.tenant_settings;
create trigger trg_prevent_retired_richmenu_asset
before insert or update of tenant_id, line on public.tenant_settings
for each row execute function public.prevent_retired_richmenu_asset();

create or replace function public.retire_richmenu_asset(
  p_tenant_id uuid,
  p_image_url text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_image_url is null or p_image_url = '' then
    return false;
  end if;

  perform pg_advisory_xact_lock(
    hashtext(p_tenant_id::text || ':' || p_image_url)
  );

  -- This reread happens after the same lock used by the trigger. If a current
  -- background or any Flex card still references the URL, no retirement row is
  -- created and the caller must not remove Storage.
  if exists (
    select 1
      from public.tenant_settings as settings
     where settings.tenant_id = p_tenant_id
       and exists (
         select 1
           from public.richmenu_asset_references(settings.line) as current_ref
          where current_ref.image_url = p_image_url
       )
  ) then
    return false;
  end if;

  insert into public.richmenu_asset_retirements (tenant_id, image_url)
  values (p_tenant_id, p_image_url)
  on conflict (tenant_id, image_url) do nothing;

  if not found then
    return false;
  end if;

  return true;
end;
$$;

-- Internal bookkeeping: no caller, including service_role, may write the
-- retirement table directly. The server's service role can make the decision
-- only through the lock-and-reread RPC below.
revoke all on table public.richmenu_asset_retirements from public;
revoke all on table public.richmenu_asset_retirements from anon, authenticated;
revoke all on table public.richmenu_asset_retirements from service_role;

revoke all on function public.richmenu_asset_references(jsonb) from public;
revoke all on function public.richmenu_asset_references(jsonb) from anon, authenticated;
grant execute on function public.richmenu_asset_references(jsonb) to service_role;

revoke all on function public.prevent_retired_richmenu_asset() from public;
revoke all on function public.prevent_retired_richmenu_asset() from anon, authenticated;
grant execute on function public.prevent_retired_richmenu_asset() to service_role;

revoke all on function public.retire_richmenu_asset(uuid, text) from public;
revoke all on function public.retire_richmenu_asset(uuid, text) from anon, authenticated;
grant execute on function public.retire_richmenu_asset(uuid, text) to service_role;

-- PB-028/033: verify both sides of the privilege boundary in the same
-- migration. Source-level GRANT text alone cannot prove that PUBLIC did not
-- inherit EXECUTE, or that service_role still has the server path.
do $$
declare
  v_acl text;
  v_function regprocedure;
begin
  for v_function in
    select fn
      from (values
        ('public.richmenu_asset_references(jsonb)'::regprocedure),
        ('public.prevent_retired_richmenu_asset()'::regprocedure),
        ('public.retire_richmenu_asset(uuid, text)'::regprocedure)
      ) as functions(fn)
  loop
    select p.proacl::text
      into v_acl
      from pg_proc as p
     where p.oid = v_function;

    if v_acl is null
       or v_acl ~ '(^|,)\{?=X'
       or v_acl like '%anon=X%'
       or v_acl like '%authenticated=X%'
       or v_acl !~ '(^|,)\{?service_role=X'
    then
      raise exception 'richmenu function ACL is not service_role-only: % => %', v_function, v_acl;
    end if;

  end loop;

  select c.relacl::text
    into v_acl
    from pg_class as c
    join pg_namespace as n on n.oid = c.relnamespace
   where n.nspname = 'public'
     and c.relname = 'richmenu_asset_retirements';

  if v_acl is null
     or v_acl ~ '(^|,)\{?='
     or v_acl like '%anon=%'
     or v_acl like '%authenticated=%'
     or v_acl like '%service_role=%'
  then
    raise exception 'richmenu retirement table ACL is not private to its security definer owner: %', v_acl;
  end if;
end;
$$;

alter function public.richmenu_asset_references(jsonb) set search_path = '';
alter function public.prevent_retired_richmenu_asset() set search_path = '';
alter function public.retire_richmenu_asset(uuid, text) set search_path = '';
