-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0005（逐字轉錄，不可自行更動）

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
