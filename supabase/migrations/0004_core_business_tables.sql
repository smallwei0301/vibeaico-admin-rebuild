-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0004（逐字轉錄，不可自行更動）
-- 每張表的 RLS policy 都是同一個樣板，見 0006 的 DO 迴圈一次套。

create table membership_levels (
  id                    uuid primary key default gen_random_uuid(),
  tenant_id             uuid not null references tenants(id) on delete cascade,
  name                  text not null,
  color                 text not null default '#C9A961',
  threshold_spent       numeric not null default 0,
  discount_percent      numeric not null default 0,
  point_rate_multiplier numeric not null default 1,
  sort_order            int not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table customers (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  name                text not null,
  phone               text not null default '',
  email               text not null default '',
  gender              gender_type,
  birthday            date,
  note                text not null default '',
  line_user_id        text,                          -- LINE userId（U 開頭），綁定後填入
  line_display_name   text,
  membership_level_id uuid references membership_levels(id) on delete set null,
  tags                text[] not null default '{}',
  points              int not null default 0,        -- 顧客個人點數
  active              boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index i_customers_t on customers (tenant_id, created_at desc);
create index i_customers_phone on customers (tenant_id, phone);
create unique index u_customers_line on customers (tenant_id, line_user_id)
  where line_user_id is not null;

create table service_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);

create table services (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  category_id      uuid references service_categories(id) on delete set null,
  name             text not null,
  description      text not null default '',
  duration_minutes int not null default 60,
  price            numeric not null default 0,
  image_url        text not null default '',
  active           boolean not null default true,
  line_featured    boolean not null default false,
  sort_order       int not null default 0,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create table staff (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  phone      text not null default '',
  email      text not null default '',
  title      text not null default '',
  avatar_url text not null default '',
  bookable   boolean not null default true,
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table staff_services (          -- Staff.serviceIds
  staff_id   uuid not null references staff(id) on delete cascade,
  service_id uuid not null references services(id) on delete cascade,
  tenant_id  uuid not null references tenants(id) on delete cascade,
  primary key (staff_id, service_id)
);

create table bookings (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  booking_no       text not null,                    -- 'B' + yymmdd + 4 碼流水，API 產生
  customer_id      uuid not null references customers(id) on delete restrict,
  service_id       uuid not null references services(id) on delete restrict,
  staff_id         uuid references staff(id) on delete set null,
  start_at         timestamptz not null,
  end_at           timestamptz not null,
  duration_minutes int not null,
  price            numeric not null default 0,
  final_price      numeric not null default 0,
  status           booking_status not null default 'PENDING',
  payment_status   payment_status not null default 'UNPAID',
  source           booking_source not null default 'MANUAL',
  note             text not null default '',
  cancel_reason    text,
  custom_fields    jsonb not null default '{}',      -- 預約自訂欄位的填答
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (tenant_id, booking_no),
  check (end_at > start_at),
  -- 同一員工時段不可重疊（僅計 PENDING/CONFIRMED；未指定員工不擋）
  constraint x_bookings_overlap exclude using gist (
    tenant_id with =, staff_id with =, tstzrange(start_at, end_at) with &&
  ) where (status in ('PENDING','CONFIRMED') and staff_id is not null)
);
create index i_bookings_range on bookings (tenant_id, start_at);
create index i_bookings_status on bookings (tenant_id, status, start_at desc);

create table block_times (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  staff_id   uuid references staff(id) on delete cascade,  -- null = 全店
  start_at   timestamptz not null,
  end_at     timestamptz not null,
  reason     text not null default '',
  created_at timestamptz not null default now(),
  check (end_at > start_at)
);

-- ---- 商品 ----
create table product_categories (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);

create table products (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  category_id   uuid references product_categories(id) on delete set null,
  name          text not null,
  description   text not null default '',
  price         numeric not null default 0,
  stock         int not null default 0,
  safety_stock  int not null default 0,
  image_url     text not null default '',
  active        boolean not null default true,
  line_featured boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table inventory_logs (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  product_id uuid not null references products(id) on delete cascade,
  delta      int not null,                    -- +進貨 / -售出、調整
  reason     text not null default '',        -- MANUAL / ORDER / ADJUST…
  stock_after int not null,
  created_at timestamptz not null default now()
);

create table product_orders (
  id             uuid primary key default gen_random_uuid(),
  tenant_id      uuid not null references tenants(id) on delete cascade,
  order_no       text not null,
  customer_id    uuid not null references customers(id) on delete restrict,
  total_amount   numeric not null default 0,
  status         product_order_status not null default 'PENDING',
  payment_status payment_status not null default 'UNPAID',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (tenant_id, order_no)
);

create table product_order_items (
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null references product_orders(id) on delete cascade,
  tenant_id    uuid not null references tenants(id) on delete cascade,
  product_id   uuid not null references products(id) on delete restrict,
  product_name text not null,                 -- 下單當下快照
  quantity     int not null,
  price        numeric not null               -- 單價快照
);

-- ---- 票券 ----
create table coupons (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  name              text not null,
  description       text not null default '',
  discount_type     discount_type not null,
  discount_value    numeric not null default 0,
  total_quantity    int not null default 0,     -- 0 = 不限量
  start_at          timestamptz,
  end_at            timestamptz,
  status            coupon_status not null default 'DRAFT',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table coupon_instances (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  coupon_id   uuid not null references coupons(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  code        text not null,                   -- 8 碼核銷代碼
  issued_at   timestamptz not null default now(),
  redeemed_at timestamptz,
  unique (tenant_id, code)
);
-- Coupon.issuedQuantity / redeemedQuantity 用 count 即時算（見 04 分冊）

-- ---- 點數（店家平台點數錢包，/tenant/points） ----
create table tenant_point_transactions (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  type          point_tx_type not null,
  amount        int not null,                  -- 正負皆可
  balance_after int not null,
  description   text not null default '',
  created_at    timestamptz not null default now()
);

-- ---- 顧客點數異動（累點 / 折抵） ----
create table customer_point_logs (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  customer_id  uuid not null references customers(id) on delete cascade,
  delta        int not null,
  reason       text not null default '',       -- EARN_BOOKING / REDEEM / MANUAL…
  points_after int not null,
  created_at   timestamptz not null default now()
);

-- ---- 功能商店 ----
create table feature_subscriptions (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  code       text not null,                    -- src/config/features.ts FEATURE_CODES
  active     boolean not null default true,
  expires_at timestamptz,                      -- null = 永久
  created_at timestamptz not null default now(),
  primary key (tenant_id, code)
);

-- clinic_queue_*、payment_methods、external_calendars、donations、
-- bug_reports、support_chat 屬 Phase 5+ 的長尾功能：先不建表，等 04 分冊
-- §B 對應端點要實作時，依同樣模式（tenant_id + RLS 樣板）補 migration。
