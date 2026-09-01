-- 0017 建立的 service-role-only quota RPC：
-- Supabase baseline 可能對 anon/authenticated 設有 schema-wide EXECUTE default，
-- 因此要用 forward migration 明確撤銷，不能只 revoke public。
revoke all on function public.consume_push_quota(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_push_quota(uuid, text, integer, integer)
  to service_role;
