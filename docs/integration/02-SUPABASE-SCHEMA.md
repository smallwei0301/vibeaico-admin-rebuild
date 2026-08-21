# 02 — Supabase 資料庫 Schema（Phase 1）

> 把本冊的 SQL 依編號順序建成 `supabase/migrations/000N_*.sql` 檔案，
> 然後依序在 Supabase SQL Editor 執行（或 `supabase db push`）。
> **執行順序不可顛倒。** 欄位名一律 snake_case；對外 API 回傳前用
> `src/server/mappers.ts` 轉 camelCase（鐵則 3）。

命名對照：`src/lib/types.ts` 的每個型別欄位 ↔ 此處同名 snake_case 欄位。
如兩邊不一致，以 types.ts 為準修 SQL，不要反過來改 types.ts。

---

## 0001 — extensions 與共用函式

```sql
create extension if not exists pgcrypto;     -- gen_random_uuid
create extension if not exists btree_gist;   -- 預約重疊排除約束

-- updated_at 自動更新
create or replace function set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

-- RLS 核心：目前登入者是否為該租戶成員
create or replace function is_tenant_member(tid uuid) returns boolean as $$
  select exists (
    select 1 from tenant_users
    where tenant_id = tid and user_id = auth.uid()
  );
$$ language sql stable security definer set search_path = public;

-- 角色門檻（OWNER > MANAGER > STAFF）
create or replace function tenant_role_at_least(tid uuid, min_role text) returns boolean as $$
  select exists (
    select 1 from tenant_users
    where tenant_id = tid and user_id = auth.uid()
      and case role when 'OWNER' then 2 when 'MANAGER' then 1 else 0 end
          >= case min_role when 'OWNER' then 2 when 'MANAGER' then 1 else 0 end
  );
$$ language sql stable security definer set search_path = public;
```

## 0002 — enums

```sql
create type tenant_role as enum ('OWNER','MANAGER','STAFF');
create type booking_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED','NO_SHOW');
create type payment_status as enum ('UNPAID','PAID_ONLINE','PAID_OFFLINE','REFUNDED');
create type booking_source as enum ('LINE','PUBLIC_PAGE','MANUAL','RECURRING');
create type product_order_status as enum ('PENDING','CONFIRMED','COMPLETED','CANCELLED');
create type coupon_status as enum ('DRAFT','PUBLISHED','PAUSED','EXPIRED');
create type discount_type as enum ('AMOUNT','PERCENT','GIFT');
create type gender_type as enum ('MALE','FEMALE','OTHER');       -- 空值以 null 表示，mapper 轉 ''
create type point_tx_type as enum ('TOPUP','CONSUME','TRANSFER_IN','TRANSFER_OUT','REFUND');
create type verification_purpose as enum ('REGISTER','RESET_PASSWORD');
```

`FeatureCode` 不做 enum（未來會加碼），用 text + check 即可。

## 0003 — 租戶與帳號

```sql
create table tenants (
  id          uuid primary key default gen_random_uuid(),
  shop_code   text not null unique check (shop_code ~ '^[a-z0-9-]+$'),
  name        text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger t_tenants_u before update on tenants for each row execute function set_updated_at();

create table tenant_users (
  tenant_id  uuid not null references tenants(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  role       tenant_role not null default 'OWNER',
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- 租戶設定：每組一個 jsonb（結構 = src/config/tenant-settings.ts 對應 schema 的 camelCase JSON）
-- ⚠️ line jsonb 內「不含」channelSecret / channelAccessToken —— 密文放獨立欄位
create table tenant_settings (
  tenant_id  uuid primary key references tenants(id) on delete cascade,
  basic      jsonb not null default '{}',
  business   jsonb not null default '{}',
  notify     jsonb not null default '{}',
  privacy    jsonb not null default '{}',
  points     jsonb not null default '{}',
  line       jsonb not null default '{}',
  line_channel_secret_enc       text not null default '',  -- encryptSecret() 產物
  line_channel_access_token_enc text not null default '',
  updated_at timestamptz not null default now()
);
create trigger t_tenant_settings_u before update on tenant_settings
  for each row execute function set_updated_at();

-- Email 驗證碼（註冊 / 忘記密碼），由 service role 讀寫，見 03 分冊
create table auth_verification_codes (
  id          uuid primary key default gen_random_uuid(),
  email       text not null,
  code        text not null,                 -- 6 位數字
  purpose     verification_purpose not null,
  expires_at  timestamptz not null,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index i_avc_lookup on auth_verification_codes (email, purpose, expires_at desc);

alter table tenants enable row level security;
alter table tenant_users enable row level security;
alter table tenant_settings enable row level security;
alter table auth_verification_codes enable row level security;  -- 無 policy＝僅 service role

create policy p_tenants_r on tenants for select using (is_tenant_member(id));
create policy p_tenants_w on tenants for update using (tenant_role_at_least(id,'OWNER'));
create policy p_tu_r on tenant_users for select using (is_tenant_member(tenant_id));
create policy p_ts_r on tenant_settings for select using (is_tenant_member(tenant_id));
create policy p_ts_w on tenant_settings for update using (tenant_role_at_least(tenant_id,'MANAGER'));
-- insert（開店）一律由 service role 做，不開放 policy
```

## 0004 — 核心業務表

每張表的 RLS policy 都是同一個樣板，SQL 檔尾端用 DO 迴圈一次套：

```sql
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
```

## 0005 — LINE、行銷、其他

```sql
-- 加入官方帳號的 LINE 使用者（不一定已綁定顧客）
create table line_users (
  tenant_id    uuid not null references tenants(id) on delete cascade,
  line_user_id text not null,
  display_name text not null default '',
  picture_url  text not null default '',
  followed     boolean not null default true,   -- 封鎖/解除追蹤時設 false
  customer_id  uuid references customers(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  primary key (tenant_id, line_user_id)
);

-- 推播訊息（行銷推廣）
create table marketing_pushes (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  title        text not null,
  content      jsonb not null default '{}',     -- 訊息內容（text / image / flex）
  audience     jsonb not null default '{}',     -- 篩選條件（tags / level / all）
  scheduled_at timestamptz,
  sent_at      timestamptz,
  sent_count   int not null default 0,
  status       text not null default 'DRAFT',   -- DRAFT/SCHEDULED/SENT/CANCELLED
  created_at   timestamptz not null default now()
);

-- 每月推播用量（免費額度 200 則，src/config/features.ts）
create table push_quota_usage (
  tenant_id uuid not null references tenants(id) on delete cascade,
  month     text not null,                      -- 'YYYY-MM'
  used      int not null default 0,
  primary key (tenant_id, month)
);

create table keyword_replies (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  keywords   text[] not null default '{}',      -- 完全比對，任一命中即回覆
  reply_type text not null default 'TEXT',      -- TEXT / IMAGE / FLEX
  content    jsonb not null default '{}',
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);

create table campaigns (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenants(id) on delete cascade,
  name       text not null,
  keyword    text not null default '',          -- LINE 輸入關鍵字觸發
  content    jsonb not null default '{}',
  start_at   timestamptz,
  end_at     timestamptz,
  status     text not null default 'DRAFT',     -- DRAFT/PUBLISHED/PAUSED/ENDED
  created_at timestamptz not null default now()
);

create table portfolios (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  title         text not null,
  image_url     text not null,
  description   text not null default '',
  active        boolean not null default true,
  line_featured boolean not null default false,
  sort_order    int not null default 0,
  created_at    timestamptz not null default now()
);

-- 顧客訊息（後台 1:1 聊天）
create table chat_messages (
  id           uuid primary key default gen_random_uuid(),
  tenant_id    uuid not null references tenants(id) on delete cascade,
  line_user_id text not null,
  direction    text not null,                   -- IN（顧客→店）/ OUT（店→顧客）
  message_type text not null default 'text',
  content      jsonb not null default '{}',
  read_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index i_chat on chat_messages (tenant_id, line_user_id, created_at desc);

-- 班表
create table shift_templates (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  name      text not null,
  start_time time not null,
  end_time   time not null,
  color      text not null default '#4A90D9'
);

create table shifts (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  staff_id    uuid not null references staff(id) on delete cascade,
  work_date   date not null,
  template_id uuid references shift_templates(id) on delete set null,
  start_time  time not null,
  end_time    time not null,
  unique (tenant_id, staff_id, work_date, start_time)
);

create table staff_leaves (
  id        uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  staff_id  uuid not null references staff(id) on delete cascade,
  start_at  timestamptz not null,
  end_at    timestamptz not null,
  reason    text not null default ''
);

create table recurring_bookings (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid not null references tenants(id) on delete cascade,
  customer_id uuid not null references customers(id) on delete cascade,
  service_id  uuid not null references services(id) on delete restrict,
  staff_id    uuid references staff(id) on delete set null,
  rule        jsonb not null,                   -- {weekday, time, intervalWeeks, until}
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
```

> `clinic_queue_*`、`payment_methods`、`external_calendars`、`donations`、
> `bug_reports`、`support_chat` 屬 Phase 5+ 的長尾功能：**先不建表**，等 04 分冊
> §B 對應端點要實作時，依同樣模式（tenant_id + RLS 樣板）補 migration。

## 0006 — RLS 樣板（一次套到所有業務表）

```sql
do $$
declare t text;
begin
  foreach t in array array[
    'membership_levels','customers','service_categories','services','staff','staff_services',
    'bookings','block_times','product_categories','products','inventory_logs',
    'product_orders','product_order_items','coupons','coupon_instances',
    'tenant_point_transactions','customer_point_logs','feature_subscriptions',
    'line_users','marketing_pushes','push_quota_usage','keyword_replies','campaigns',
    'portfolios','chat_messages','shift_templates','shifts','staff_leaves','recurring_bookings'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('create policy p_%s_all on %I for all using (is_tenant_member(tenant_id)) with check (is_tenant_member(tenant_id))', t, t);
  end loop;
end $$;

-- 例外收緊：功能訂閱與點數錢包只有平台（service role）能寫
drop policy p_feature_subscriptions_all on feature_subscriptions;
create policy p_fs_r on feature_subscriptions for select using (is_tenant_member(tenant_id));
drop policy p_tenant_point_transactions_all on tenant_point_transactions;
create policy p_tpt_r on tenant_point_transactions for select using (is_tenant_member(tenant_id));
```

## 0007 — 查詢用 view（帶名稱的預約列表）

```sql
-- security_invoker：以呼叫者權限套 RLS，不會繞過隔離
create view bookings_view with (security_invoker = true) as
select b.*,
       c.name  as customer_name,
       c.phone as customer_phone,
       s.name  as service_name,
       st.name as staff_name
from bookings b
join customers c  on c.id = b.customer_id
join services  s  on s.id = b.service_id
left join staff st on st.id = b.staff_id;
```

顧客列表的統計欄位（`bookingCount`、`totalSpent`、`lastVisitAt`、`atRisk`）同理：

```sql
create view customers_view with (security_invoker = true) as
select c.*,
       ml.name as membership_level_name,
       coalesce(bs.cnt, 0)  as booking_count,
       coalesce(bs.spent, 0) as total_spent,
       bs.last_visit_at,
       (bs.last_visit_at is not null and bs.last_visit_at < now() - interval '60 days') as at_risk
from customers c
left join membership_levels ml on ml.id = c.membership_level_id
left join lateral (
  select count(*) filter (where b.status = 'COMPLETED') as cnt,
         coalesce(sum(b.final_price) filter (where b.status = 'COMPLETED'), 0) as spent,
         max(b.start_at) filter (where b.status = 'COMPLETED') as last_visit_at
  from bookings b where b.customer_id = c.id
) bs on true;
```

## 0008 — Storage buckets

```sql
insert into storage.buckets (id, name, public) values
  ('service-images',  'service-images',  true),
  ('product-images',  'product-images',  true),
  ('portfolio-images','portfolio-images',true),
  ('staff-avatars',   'staff-avatars',   true),
  ('richmenu-assets', 'richmenu-assets', true)
on conflict (id) do nothing;

-- 上傳規則：路徑第一段必須是自己所屬租戶的 id（{tenant_id}/{filename}）
create policy p_storage_write on storage.objects for insert to authenticated
  with check (
    bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets')
    and is_tenant_member((storage.foldername(name))[1]::uuid)
  );
create policy p_storage_read on storage.objects for select using (
  bucket_id in ('service-images','product-images','portfolio-images','staff-avatars','richmenu-assets')
);
```

## 0009 —（選用）本機開發 seed

只在開發環境跑；production 靠註冊流程建店。

```sql
-- 需先在 Supabase Auth 手動建一個測試帳號並把 uuid 貼進來
-- select id from auth.users where email = 'dev@example.com';
do $$
declare uid uuid := '<<測試帳號的 auth.users.id>>';
        tid uuid;
begin
  insert into tenants (shop_code, name) values ('demo-shop', '示範美學工作室') returning id into tid;
  insert into tenant_users (tenant_id, user_id, role) values (tid, uid, 'OWNER');
  insert into tenant_settings (tenant_id, basic) values
    (tid, jsonb_build_object('tenantName','示範美學工作室','shopCode','demo-shop'));
  insert into feature_subscriptions (tenant_id, code) values
    (tid,'BASIC_REPORT'),(tid,'MEMBERSHIP_SYSTEM'),(tid,'COUPON_SYSTEM'),(tid,'PRODUCT_SALES');
end $$;
```

---

## 本冊驗收

- [ ] 全部 migration 執行成功，Supabase Table Editor 可見上述資料表
- [ ] 任一業務表的 RLS 已啟用（Table Editor 顯示 "RLS enabled"）
- [ ] 用 anon key + 未登入呼叫 `select * from customers` 回空（RLS 生效驗證）
- [ ] `bookings` 插入兩筆同員工重疊時段，第二筆被 `x_bookings_overlap` 擋下
- [ ] `bookings_view` / `customers_view` 查得到 join 欄位
