-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0003（逐字轉錄，不可自行更動）
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
