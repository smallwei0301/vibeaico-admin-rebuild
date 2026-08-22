-- 見 docs/integration/02-SUPABASE-SCHEMA.md §0001（逐字轉錄；僅補一行修規格缺陷，見下）
--
-- ⚠️ 偏離分冊原文的一行：check_function_bodies = off。
--   is_tenant_member / tenant_role_at_least 是 language sql 函式，body 參照
--   0003 才建立的 tenant_users；Postgres 對 SQL 函式在 CREATE 當下就驗證 body
--   （check_function_bodies 預設 on），照分冊順序在乾淨資料庫執行 0001 必然
--   報 42P01。關掉本 session 的 body 檢查即可（Supabase 官方 db dump 也是
--   同樣做法），函式在首次被呼叫時仍會正常解析。已回寫 02 分冊。
set check_function_bodies = off;

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
