-- 見 docs/integration/03-AUTH.md §2 / §4（Phase 2 輔助 SQL；分冊說「併入 0003 或
-- 新開 0010」，這裡選 0010 —— 0009 保留給分冊的選用 dev seed 編號）。
-- 兩個函式都是 security definer 讀 auth.users，且明確 revoke 掉 anon/authenticated，
-- 僅 service role 可呼叫（枚舉防護的查詢只發生在伺服器端）。

create or replace function email_exists(p_email text) returns boolean as $$
  select exists (select 1 from auth.users where lower(email) = lower(p_email));
$$ language sql stable security definer set search_path = public, auth;
revoke execute on function email_exists(text) from anon, authenticated; -- 僅 service role

create or replace function user_id_by_email(p_email text) returns uuid as $$
  select id from auth.users where lower(email) = lower(p_email) limit 1;
$$ language sql stable security definer set search_path = public, auth;
revoke execute on function user_id_by_email(text) from anon, authenticated;
