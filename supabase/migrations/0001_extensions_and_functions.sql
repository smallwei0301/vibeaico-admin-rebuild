-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0001（逐字轉錄，不可自行更動）
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
