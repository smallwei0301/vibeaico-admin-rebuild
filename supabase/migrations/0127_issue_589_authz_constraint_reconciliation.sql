-- #589 Stage 2 candidate — reconcile only the observed RLS/ACL and notified
-- constraint drift for booking_addons and owner_notify_recipients.
--
-- This migration is deliberately non-destructive. It never rewrites a row:
-- before replacing the canonical notified check it rejects every value outside
-- the six values owned by 0082. In particular, a legacy PENDING row blocks the
-- migration rather than being silently converted to NONE or deleted.
--
-- This is not a full G2 repair. It does not claim to reconcile unrelated
-- constraints, foreign keys, indexes, triggers, enum metadata, or storage.

-- The G3/G6 runner provides the single outer transaction and its 5s/60s
-- timeouts; this file must not commit it. The fixed order prevents a competing
-- reconciliation from taking these two table locks in the opposite order.
-- ENABLE does not alter a table's existing FORCE state.
lock table public.booking_addons, public.owner_notify_recipients in access exclusive mode;
alter table public.booking_addons enable row level security;
alter table public.owner_notify_recipients enable row level security;

-- Column-level grants and unrecognised table-grant roles cannot be safely
-- reconciled by this narrow migration. Stop before revoking any known grants.
do $$
declare
  v_unknown text;
begin
  select string_agg(format('%I.%I.%I', n.nspname, c.relname, a.attname), ', ' order by n.nspname, c.relname, a.attname)
    into v_unknown
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
   where a.attrelid in ('public.booking_addons'::regclass, 'public.owner_notify_recipients'::regclass)
     and a.attnum > 0 and not a.attisdropped and a.attacl is not null;
  if v_unknown is not null then
    raise exception 'column ACL reconciliation is not authorized: %', v_unknown;
  end if;

  select string_agg(format('%I.%I:%s', n.nspname, c.relname, coalesce(r.rolname, 'PUBLIC')), ', ' order by n.nspname, c.relname, coalesce(r.rolname, 'PUBLIC'))
    into v_unknown
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) as privilege
    left join pg_roles r on r.oid = privilege.grantee
   where c.oid in ('public.booking_addons'::regclass, 'public.owner_notify_recipients'::regclass)
     and privilege.grantee <> c.relowner
     and coalesce(r.rolname, 'PUBLIC') not in ('PUBLIC', 'anon', 'authenticated', 'service_role');
  if v_unknown is not null then
    raise exception 'table ACL has an unknown grantee: %', v_unknown;
  end if;
end
$$;

-- Do not blindly delete policies: an unexpected policy can be a security
-- control that this migration does not understand. Known legacy policy names
-- may be absent on a fresh canonical install, but any other name fails closed.
do $$
declare
  v_unknown text;
begin
  select string_agg(policyname, ', ' order by policyname) into v_unknown
    from pg_policies
   where schemaname = 'public'
     and tablename = 'booking_addons'
     and policyname not in (
       'p_booking_addons_s', 'p_booking_addons_i',
       'p_booking_addons_u', 'p_booking_addons_d'
     );
  if v_unknown is not null then
    raise exception 'booking_addons has unknown policy names: %', v_unknown;
  end if;

  select string_agg(policyname, ', ' order by policyname) into v_unknown
    from pg_policies
   where schemaname = 'public'
     and tablename = 'owner_notify_recipients'
     and policyname not in (
       'p_owner_notify_recipients_all',
       'p_owner_notify_recipients_s', 'p_owner_notify_recipients_i',
       'p_owner_notify_recipients_u', 'p_owner_notify_recipients_d'
     );
  if v_unknown is not null then
    raise exception 'owner_notify_recipients has unknown policy names: %', v_unknown;
  end if;
end
$$;

-- `notified` is historical data. Fail closed on all non-canonical values;
-- notably, observed legacy PENDING must be counted/repaired under a separate
-- authorized data plan rather than coerced by this schema reconciliation.
do $$
declare
  v_invalid text;
  v_type text;
  v_not_null boolean;
  v_default text;
begin
  select a.atttypid::regtype::text, a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
    into v_type, v_not_null, v_default
    from pg_attribute a
    left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
   where a.attrelid = 'public.booking_addons'::regclass
     and a.attname = 'notified' and a.attnum > 0 and not a.attisdropped;
  if v_type is distinct from 'text' or v_not_null is not true or v_default is distinct from '''NONE''::text' then
    raise exception 'booking_addons.notified must be text not null default NONE';
  end if;

  select string_agg(coalesce(notified, '<NULL>'), ', ' order by coalesce(notified, '<NULL>')) into v_invalid
    from (
      select distinct notified
        from public.booking_addons
       where notified is null
          or notified not in ('NONE', 'LINE', 'NO_LINE', 'NOT_CONFIGURED', 'QUOTA_EXCEEDED', 'FAILED')
    ) as invalid_values;
  if v_invalid is not null then
    raise exception 'booking_addons.notified contains non-canonical values: %', v_invalid;
  end if;
end
$$;

alter table public.booking_addons
  drop constraint if exists booking_addons_notified_check;
alter table public.booking_addons
  add constraint booking_addons_notified_check
  check (notified = any (array[
    'NONE'::text,
    'LINE'::text,
    'NO_LINE'::text,
    'NOT_CONFIGURED'::text,
    'QUOTA_EXCEEDED'::text,
    'FAILED'::text
  ]));

-- Browser roles can only read their own tenant's addons. Writes are limited to
-- the service-role RPC/admin path, whose database-side tenant checks remain in
-- 0121; explicit grants prevent a legacy PUBLIC table grant from bypassing the
-- intended client surface.
drop policy if exists p_booking_addons_i on public.booking_addons;
drop policy if exists p_booking_addons_u on public.booking_addons;
drop policy if exists p_booking_addons_d on public.booking_addons;
drop policy if exists p_booking_addons_s on public.booking_addons;
create policy p_booking_addons_s on public.booking_addons
  for select to authenticated
  using (is_tenant_member(tenant_id));
revoke all on table public.booking_addons from public, anon, authenticated;
grant select on table public.booking_addons to authenticated;
grant all on table public.booking_addons to service_role;

-- Owner-notify management remains tenant-authenticated CRUD. Rebuild the one
-- named policy so no legacy PUBLIC policy survives, while keeping the existing
-- runtime's authenticated dashboard flow and service-role webhook path.
drop policy if exists p_owner_notify_recipients_s on public.owner_notify_recipients;
drop policy if exists p_owner_notify_recipients_i on public.owner_notify_recipients;
drop policy if exists p_owner_notify_recipients_u on public.owner_notify_recipients;
drop policy if exists p_owner_notify_recipients_d on public.owner_notify_recipients;
drop policy if exists p_owner_notify_recipients_all on public.owner_notify_recipients;
create policy p_owner_notify_recipients_all on public.owner_notify_recipients
  for all to authenticated
  using (is_tenant_member(tenant_id))
  with check (is_tenant_member(tenant_id));
revoke all on table public.owner_notify_recipients from public, anon, authenticated;
grant select, insert, update, delete on table public.owner_notify_recipients to authenticated;
grant all on table public.owner_notify_recipients to service_role;
