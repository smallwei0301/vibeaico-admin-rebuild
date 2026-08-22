-- 0012 — Phase 5 需要的兩個 DB 物件（04 分冊 §B-4 / §B-6）
--   1. transfer_tenant_points()：跨店點數轉移，OUT/IN 兩筆交易在同一個
--      function（同一交易）內完成（04 §B-4「需在一個 postgres function 內完成」）。
--   2. bug_reports 表（04 §B-6「MVP：寫進一張 bug_reports 表＋寄信」）。
--
-- 編號說明：0011 依 09 分冊保留給功能商店（Phase 5.5），本檔取 0012。

set check_function_bodies = off;

-- ---- 1. 點數轉移 rpc ----
-- 由 API 層以 service role 呼叫（權限 ⚙O 在 API 層驗）；revoke 掉 anon/
-- authenticated，防止前端直接呼叫繞過權限檢查（同 0010 auth helpers 的做法）。
-- 餘額規則同 04 §B-4：balance = 該店最新一筆 tenant_point_transactions 的
-- balance_after（無紀錄 = 0）。不足或找不到目標店家時 raise，整筆 rollback。
create or replace function transfer_tenant_points(
  p_from_tenant uuid,
  p_to_shop_code text,
  p_amount int
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_to_tenant uuid;
  v_from_balance int;
  v_to_balance int;
  v_from_code text;
begin
  if p_amount is null or p_amount <= 0 then
    raise exception 'TRANSFER_INVALID_AMOUNT';
  end if;

  select id into v_to_tenant from tenants where shop_code = p_to_shop_code;
  if v_to_tenant is null then
    raise exception 'TRANSFER_TARGET_NOT_FOUND';
  end if;
  if v_to_tenant = p_from_tenant then
    raise exception 'TRANSFER_TO_SELF';
  end if;

  select shop_code into v_from_code from tenants where id = p_from_tenant;

  -- 鎖定兩店最新交易列，避免並發轉出造成餘額變負
  -- （同店兩筆並發 transfer 會在這裡序列化）。
  perform pg_advisory_xact_lock(hashtext(p_from_tenant::text));
  perform pg_advisory_xact_lock(hashtext(v_to_tenant::text));

  select coalesce((select balance_after from tenant_point_transactions
                   where tenant_id = p_from_tenant
                   order by created_at desc, id desc limit 1), 0)
    into v_from_balance;
  if v_from_balance < p_amount then
    raise exception 'TRANSFER_INSUFFICIENT_BALANCE';
  end if;

  select coalesce((select balance_after from tenant_point_transactions
                   where tenant_id = v_to_tenant
                   order by created_at desc, id desc limit 1), 0)
    into v_to_balance;

  insert into tenant_point_transactions (tenant_id, type, amount, balance_after, description)
  values (p_from_tenant, 'TRANSFER_OUT', -p_amount, v_from_balance - p_amount,
          '轉出至 ' || p_to_shop_code);
  insert into tenant_point_transactions (tenant_id, type, amount, balance_after, description)
  values (v_to_tenant, 'TRANSFER_IN', p_amount, v_to_balance + p_amount,
          '自 ' || coalesce(v_from_code, '') || ' 轉入');
end;
$$;

revoke execute on function transfer_tenant_points(uuid, text, int) from public;
revoke execute on function transfer_tenant_points(uuid, text, int) from anon;
revoke execute on function transfer_tenant_points(uuid, text, int) from authenticated;

-- ---- 2. bug_reports（平台級：可無 tenant 脈絡回報，tenant_id 可空） ----
create table bug_reports (
  id          uuid primary key default gen_random_uuid(),
  tenant_id   uuid references tenants(id) on delete set null,
  reporter    text not null default '',     -- email 或使用者名稱
  category    text not null default 'OTHER',
  content     text not null,
  page_url    text not null default '',
  created_at  timestamptz not null default now()
);

-- 平台級資料：不開放店家端 RLS 存取（無 policy = service role 專用），
-- 但仍啟用 RLS 防止 anon/authenticated 直讀。
alter table bug_reports enable row level security;
