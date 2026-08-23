-- 0011 — 功能商店（09 分冊 §2 逐字轉錄 + §3 bundle rpc + §7.1 ai 欄位）
-- 編號依 09 分冊指定為 0011（0012 已先行佔用 Phase 5 的 transfer/bug_reports，
-- 兩檔獨立無相依，套用順序不影響結果）。

set check_function_bodies = off;

-- 訂閱列擴充：取消/來源/起訖
alter table feature_subscriptions
  add column if not exists started_at   timestamptz not null default now(),
  add column if not exists cancelled_at timestamptz,
  add column if not exists source       text not null default 'INDIVIDUAL';
    -- 'INDIVIDUAL' | 'BUNDLE_LITE' | 'BUNDLE_PRO' | 'GRANTED'（平台贈送）

-- 到期副作用還原用的旗標（§6）
alter table coupons  add column if not exists auto_paused_by_feature boolean not null default false;
alter table products add column if not exists auto_paused_by_feature boolean not null default false;

-- AI 客服設定（§7.1）
alter table tenant_settings add column if not exists ai jsonb not null default '{}';
-- 結構：{ enabled: boolean, personaNotes: string, faq: [{q,a}], handoffMessage: string }

-- 原子扣點 + 開通（防止「扣了點但沒開通」或並發重複扣點）——§2 逐字轉錄
create or replace function subscribe_feature(
  p_tenant uuid, p_code text, p_months int, p_price int, p_source text
) returns void as $$
declare v_balance int;
        v_cost int := p_price * p_months;
        v_base timestamptz;
begin
  select coalesce((select balance_after from tenant_point_transactions
                   where tenant_id = p_tenant order by created_at desc limit 1), 0)
    into v_balance;
  if v_balance < v_cost then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'P0001';
  end if;
  insert into tenant_point_transactions (tenant_id, type, amount, balance_after, description)
  values (p_tenant, 'CONSUME', -v_cost, v_balance - v_cost, '訂閱功能：' || p_code || ' × ' || p_months || ' 個月');

  -- 到期日：尚未到期者從原到期日累加（續訂）；否則從現在起算
  select greatest(coalesce((select expires_at from feature_subscriptions
                            where tenant_id = p_tenant and code = p_code), now()), now())
    into v_base;
  insert into feature_subscriptions (tenant_id, code, active, expires_at, source, started_at, cancelled_at)
  values (p_tenant, p_code, true, v_base + make_interval(months => p_months), p_source, now(), null)
  on conflict (tenant_id, code) do update
    set active = true, cancelled_at = null, source = excluded.source,
        expires_at = greatest(coalesce(feature_subscriptions.expires_at, now()), now())
                     + make_interval(months => p_months);
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function subscribe_feature from anon, authenticated;  -- 僅 service role

-- 套裝訂閱（§3 bundle 列：「扣點只扣一次 bundle 價，逐碼 upsert，
-- 此段包在一個自訂 rpc subscribe_bundle 裡，寫法比照 subscribe_feature」）
create or replace function subscribe_bundle(
  p_tenant uuid, p_key text, p_codes text[], p_months int, p_price int
) returns void as $$
declare v_balance int;
        v_cost int := p_price * p_months;
        v_code text;
        v_base timestamptz;
        v_source text := 'BUNDLE_' || p_key;
begin
  select coalesce((select balance_after from tenant_point_transactions
                   where tenant_id = p_tenant order by created_at desc limit 1), 0)
    into v_balance;
  if v_balance < v_cost then
    raise exception 'INSUFFICIENT_POINTS' using errcode = 'P0001';
  end if;
  insert into tenant_point_transactions (tenant_id, type, amount, balance_after, description)
  values (p_tenant, 'CONSUME', -v_cost, v_balance - v_cost, '訂閱套裝：' || p_key || ' × ' || p_months || ' 個月');

  foreach v_code in array p_codes loop
    select greatest(coalesce((select expires_at from feature_subscriptions
                              where tenant_id = p_tenant and code = v_code), now()), now())
      into v_base;
    insert into feature_subscriptions (tenant_id, code, active, expires_at, source, started_at, cancelled_at)
    values (p_tenant, v_code, true, v_base + make_interval(months => p_months), v_source, now(), null)
    on conflict (tenant_id, code) do update
      set active = true, cancelled_at = null, source = excluded.source,
          expires_at = greatest(coalesce(feature_subscriptions.expires_at, now()), now())
                       + make_interval(months => p_months);
  end loop;
end;
$$ language plpgsql security definer set search_path = public;
revoke execute on function subscribe_bundle from anon, authenticated;  -- 僅 service role
