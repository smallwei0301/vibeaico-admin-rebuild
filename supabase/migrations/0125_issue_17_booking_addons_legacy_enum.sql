-- #17 compatibility precondition for the historical booking-addons shape.
--
-- The canonical 0121 migration owns the current text contract for
-- booking_addons.performance_mode. The historical TEST integration baseline
-- can instead provide that column as the public addon_performance_mode enum,
-- whose PRIMARY value is the legacy spelling of the current INHERIT mode.
-- The controlled release planner executes this bounded precondition immediately
-- before 0121, while keeping 0121 immutable and fail-closed.

do $$
declare
  v_type_schema text;
  v_type_name text;
begin
  if not exists (
    select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = 'booking_addons'
       and c.relkind in ('r', 'p')
  ) then
    return;
  end if;

  select n.nspname, t.typname
    into v_type_schema, v_type_name
    from pg_attribute a
    join pg_type t on t.oid = a.atttypid
    join pg_namespace n on n.oid = t.typnamespace
   where a.attrelid = 'public.booking_addons'::regclass
     and a.attname = 'performance_mode'
     and not a.attisdropped;

  if not found then
    return;
  end if;

  if v_type_schema = 'pg_catalog' and v_type_name = 'text' then
    return;
  end if;

  if v_type_schema <> 'public' or v_type_name <> 'addon_performance_mode' then
    raise exception 'booking_addons.performance_mode has incompatible type %.%',
      v_type_schema, v_type_name;
  end if;

  alter table public.booking_addons
    alter column performance_mode drop default;

  alter table public.booking_addons
    alter column performance_mode type text
    using case performance_mode::text
      when 'PRIMARY' then 'INHERIT'
      else performance_mode::text
    end;

  alter table public.booking_addons
    alter column performance_mode set default 'INHERIT';
end
$$;

alter table if exists public.booking_addons enable row level security;
