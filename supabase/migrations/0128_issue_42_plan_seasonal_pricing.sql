-- issue #42：季節定價（seasons）的持久化子模型。
--
-- 這是 TripPlan 的子表，不是第二個 TripPlan。資料須與同一 tenant 的 plan
-- 一起存在；兩欄各自指向正確資料但彼此屬於不同 tenant 的組合必須被資料庫拒絕。
-- 季節可跨年（例如 12/1 至 2/28），因此不強制 start <= end；但每一個月/日
-- 組合本身必須是有效的公曆日期。2/29 合法，以支援閏年。
--
-- 本 migration 只建立資料模型與讀取隔離，不改既有 departure/order 的價格
-- snapshot，也不決定季節重疊時的產品優先順序；那些是寫入/計價規則的責任。

create table if not exists public.trip_plan_seasons (
  id             uuid not null default gen_random_uuid(),
  tenant_id      uuid not null,
  plan_id        uuid not null,
  name           text not null,
  start_month    integer not null,
  start_day      integer not null,
  end_month      integer not null,
  end_day        integer not null,
  price_override numeric,
  active         boolean not null default true,
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint trip_plan_seasons_pkey primary key (id),
  constraint trip_plan_seasons_tenant_fkey
    foreign key (tenant_id) references public.tenants(id) on delete cascade,
  constraint trip_plan_seasons_tenant_plan_fkey
    foreign key (tenant_id, plan_id) references public.trip_plans(tenant_id, id) on delete cascade,
  constraint trip_plan_seasons_name_nonblank_check check (name !~ '^[[:space:]]*$'),
  constraint trip_plan_seasons_start_date_valid_check check (
    start_month between 1 and 12
    and start_day between 1 and case start_month
      when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
  ),
  constraint trip_plan_seasons_end_date_valid_check check (
    end_month between 1 and 12
    and end_day between 1 and case end_month
      when 2 then 29 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
  ),
  constraint trip_plan_seasons_price_override_nonnegative_check
    check (price_override is null or price_override >= 0)
);

-- `create table if not exists` 對同名但形狀不同的表會靜默跳過。以下明確
-- 驗證欄位、預設值與關鍵約束，避免把 schema drift 偽裝成成功。
do $$
declare
  r record;
  v_type text;
  v_not_null boolean;
  v_default text;
  v_constraint_type "char";
  v_constraint_def text;
begin
  for r in
    select * from (values
      ('id', 'uuid', true),
      ('tenant_id', 'uuid', true),
      ('plan_id', 'uuid', true),
      ('name', 'text', true),
      ('start_month', 'integer', true),
      ('start_day', 'integer', true),
      ('end_month', 'integer', true),
      ('end_day', 'integer', true),
      ('price_override', 'numeric', false),
      ('active', 'boolean', true),
      ('sort_order', 'integer', true),
      ('created_at', 'timestamp with time zone', true),
      ('updated_at', 'timestamp with time zone', true)
    ) as expected(column_name, expected_type, expected_not_null)
  loop
    select a.atttypid::regtype::text, a.attnotnull
      into v_type, v_not_null
      from pg_attribute a
     where a.attrelid = 'public.trip_plan_seasons'::regclass
       and a.attname = r.column_name
       and a.attnum > 0
       and not a.attisdropped;
    if v_type is null or v_type is distinct from r.expected_type or v_not_null is distinct from r.expected_not_null then
      raise exception 'trip_plan_seasons.% has unexpected type/nullability', r.column_name;
    end if;
  end loop;

  for r in
    select * from (values
      ('id', 'gen_random_uuid()'),
      ('active', 'true'),
      ('sort_order', '0'),
      ('created_at', 'now()'),
      ('updated_at', 'now()')
    ) as expected(column_name, expected_default)
  loop
    select pg_get_expr(d.adbin, d.adrelid)
      into v_default
      from pg_attrdef d
      join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
     where d.adrelid = 'public.trip_plan_seasons'::regclass
       and a.attname = r.column_name;
    if v_default is distinct from r.expected_default then
      raise exception 'trip_plan_seasons.% has unexpected default', r.column_name;
    end if;
  end loop;

  for r in
    select * from (values
      ('trip_plan_seasons_pkey', 'p', 'PRIMARY KEY (id)'),
      ('trip_plan_seasons_tenant_fkey', 'f', 'FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE'),
      ('trip_plan_seasons_tenant_plan_fkey', 'f', 'FOREIGN KEY (tenant_id, plan_id) REFERENCES trip_plans(tenant_id, id) ON DELETE CASCADE'),
      ('trip_plan_seasons_name_nonblank_check', 'c', 'name !~'),
      ('trip_plan_seasons_start_date_valid_check', 'c', 'start_month'),
      ('trip_plan_seasons_end_date_valid_check', 'c', 'end_month'),
      ('trip_plan_seasons_price_override_nonnegative_check', 'c', 'price_override')
    ) as expected(constraint_name, expected_type, required_fragment)
  loop
    select c.contype, pg_get_constraintdef(c.oid)
      into v_constraint_type, v_constraint_def
      from pg_constraint c
     where c.conrelid = 'public.trip_plan_seasons'::regclass
       and c.conname = r.constraint_name;
    if v_constraint_type is null or v_constraint_type is distinct from r.expected_type
       or v_constraint_def is null or v_constraint_def not like '%' || r.required_fragment || '%' then
      raise exception 'trip_plan_seasons constraint % has unexpected shape', r.constraint_name;
    end if;
  end loop;
end $$;

create index if not exists trip_plan_seasons_tenant_plan_sort_idx
  on public.trip_plan_seasons (tenant_id, plan_id, sort_order);

create trigger t_trip_plan_seasons_u before update on public.trip_plan_seasons
  for each row execute function public.set_updated_at();

alter table public.trip_plan_seasons enable row level security;

create policy p_trip_plan_seasons_select on public.trip_plan_seasons
  for select to authenticated
  using (is_tenant_member(tenant_id));
