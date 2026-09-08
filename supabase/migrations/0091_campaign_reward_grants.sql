-- 0091 — 行銷活動的「贈送票券／贈送點數」真的會發放（issue #176 第 2、3 項）
-- =============================================================================
-- 在此之前，campaigns 的 couponId / bonusPoints / thresholdAmount 存得進
-- content jsonb，但**全站沒有任何程式會讀它們**：`POST /api/campaigns/:id/publish`
-- 的完整內容就是一次 `update({ status: 'PUBLISHED' })`。店家設好「滿額送 100 點」、
-- 按發布、看到成功訊息，實際上什麼都不會發生。
--
-- 本 migration 提供兩樣東西：
--
--   1. `campaign_reward_grants` —— 發放紀錄。它同時是**冪等鍵**：
--      unique (tenant_id, campaign_id, customer_id) 保證同一位顧客在同一個活動
--      只會被發放一次。沒有這張表就沒有任何東西能阻止同一筆預約重試兩次、
--      或顧客連續完成兩筆預約時被重複送點——點數等同金額，重複發放是真實損失。
--
--   2. `grant_campaign_reward()` —— **單一交易**的發放函式。
--
-- ⚠️ 為什麼一定要是一支 RPC 而不是幾次 PostgREST 呼叫：#218 剛剛才因為
-- 「扣點、折價、帳本三步不在同一交易」出過事（PR #280 / migration 0090）。
-- 發放這一側是同一個形狀的鏡像——搶冪等鍵、加點數、寫帳本、發票券四件事必須
-- 一起成功或一起不發生。任何一步失敗卻留下 grant 列，那位顧客就**永遠**領不到了
-- （冪等鍵會擋住重試），而且沒有任何錯誤會浮到店家面前。
--
-- ⚠️ 本檔不碰 `tenant_settings.notify`、不碰 birthday/recall 的 cron，也不改
-- 任何既有資料列。BIRTHDAY / RECALL 兩型依 #176 第 1 項的 Owner 裁示 (b)
-- 已從活動頁移除並導向通知設定頁，不在本檔範圍。

-- ---------------------------------------------------------------- 發放紀錄
create table if not exists public.campaign_reward_grants (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references public.tenants(id)   on delete cascade,
  campaign_id        uuid not null references public.campaigns(id) on delete cascade,
  customer_id        uuid not null references public.customers(id) on delete cascade,
  -- 觸發來源：BOOKING_COMPLETED（新客首購／滿額回饋）或 KEYWORD_CLAIM（限時優惠）
  trigger_kind       text not null,
  -- 可追溯到造成發放的那一筆資料（預約 id；關鍵字領取時為 null）
  source_id          uuid,
  bonus_points       int  not null default 0,
  coupon_instance_id uuid references public.coupon_instances(id) on delete set null,
  granted_at         timestamptz not null default now(),
  -- ⚠️ 這一條就是冪等保證本身，不是「順便加的索引」。
  unique (tenant_id, campaign_id, customer_id)
);

-- ⚠️ PB-026：`create table if not exists` 遇到「同名但形狀不同」的既有表會**靜默
-- 跳過**，於是後面的函式對著一張少了欄位的表建立，錯誤要等到執行期才出現。
-- 這一段把那個靜默跳過變成大聲失敗。
do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id','uuid'), ('campaign_id','uuid'), ('customer_id','uuid'),
      ('trigger_kind','text'), ('source_id','uuid'),
      ('bonus_points','integer'), ('coupon_instance_id','uuid')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name   = 'campaign_reward_grants'
       and column_name  = r.col;
    if v_actual is null then
      raise exception 'campaign_reward_grants.% 不存在——0091 的建表被靜默跳過了', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'campaign_reward_grants.% 的型別是 %，預期 %——既有表與本 migration 形狀不一致',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;

  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.campaign_reward_grants'::regclass
       and contype  = 'u'
       and pg_get_constraintdef(oid) like '%(tenant_id, campaign_id, customer_id)%'
  ) then
    raise exception 'campaign_reward_grants 缺少 (tenant_id, campaign_id, customer_id) 唯一約束——冪等保證不成立';
  end if;
end $$;

comment on table public.campaign_reward_grants is
  '行銷活動獎勵發放紀錄。unique(tenant_id, campaign_id, customer_id) 是冪等鍵：同一位顧客每個活動只發放一次。';

-- 查「這位顧客在這個租戶領過哪些活動」用得到；unique 索引的前綴已涵蓋
-- (tenant_id, campaign_id)，這裡補的是以顧客為起點的方向。
create index if not exists ix_campaign_reward_grants_customer
  on public.campaign_reward_grants (tenant_id, customer_id, granted_at desc);

alter table public.campaign_reward_grants enable row level security;

-- 讀取走 service role（本表沒有店家端的直接查詢入口）；比照 0006 的慣例，
-- 明確不建立 anon/authenticated 的 policy，等於預設全擋。

-- ------------------------------------------------------------------ 發放函式
--
-- 回傳 (out_granted, out_points_after, out_coupon_instance)。
--
-- ⚠️ 三個 OUT 名稱都刻意加 `out_` 前綴。`returns table (...)` 的 OUT 名稱同時是
-- PL/pgSQL 變數，若取名 `points_after` 就會與 `customer_point_logs.points_after`
-- 撞名，在 UPDATE 右側或 WHERE 裡變成 `column reference is ambiguous`——而且是
-- **每一次呼叫**都在執行期炸，不是建立函式時。#218 的 0090 第一版就是這樣讓
-- `apply-points` 全數 500 的，讀 SQL 文字的單元測試完全抓不到。
--
-- 業務語意（照這個順序守門）：
--   1. 沒有任何可發的東西（點數 <= 0 且沒有票券）→ NOTHING_TO_GRANT
--   2. 活動不存在／不屬本租戶 → CAMPAIGN_NOT_FOUND
--   3. 顧客不存在／不屬本租戶 → CUSTOMER_NOT_FOUND
--   4. 冪等鍵已存在 → out_granted = false，不做任何寫入，正常返回（不是錯誤）
--   5. 票券不存在／不屬本租戶 → COUPON_NOT_FOUND（整筆回滾，不發半套）
--   6. 票券限量已發完 → COUPON_EXHAUSTED（同上；檢查在 coupons 列鎖下進行，
--      沒有列鎖時這一條在併發下不成立，見該處註解）
--
-- ⚠️ 本函式**不檢查票券的 status 與起訖期間**——DRAFT 或已過期的票券仍會被發出。
-- 這與既有的 `/api/coupons/:id/batch-issue` 行為一致（它也不檢查），屬既有範圍，
-- 本 migration 沿用而不在此單方面改變語意；要收緊應該兩條路徑一起處理。
--
-- 第 3、4 點刻意**整筆回滾**而不是「跳過票券只送點數」：後者會讓顧客拿到半套獎勵，
-- 而冪等鍵已經把他標記成領過了，他永遠拿不到那張票券。寧可整筆不發並留下錯誤讓
-- 店家看得到，也不要靜默地少發一半。
create or replace function public.grant_campaign_reward(
  p_tenant   uuid,
  p_campaign uuid,
  p_customer uuid,
  p_trigger  text,
  p_source   uuid,
  p_points   int,
  p_coupon   uuid,
  p_code     text
) returns table (
  out_granted         boolean,
  out_points_after    int,
  out_coupon_instance uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant    uuid;
  v_points   int := greatest(coalesce(p_points, 0), 0);
  v_current  int;
  v_total    int;
  v_issued   int;
begin
  if v_points <= 0 and p_coupon is null then
    raise exception 'NOTHING_TO_GRANT';
  end if;

  -- ⚠️ 租戶邊界要在**搶冪等鍵之前**驗完，而且三個 id 都要驗。
  --
  -- 這是 security definer 函式：它以定義者權限執行、繞過 RLS，所以不能倚賴
  -- 呼叫端「應該只會傳同租戶的 id」。第一版只在「有點數要發」時才驗 customer、
  -- 而且完全沒驗 campaign——只發券不送點的活動可以把 A 店的券發給 B 店顧客，
  -- 且 p_campaign 帶任意租戶的活動 id 都會被接受。兩者經由目前的呼叫端都不可
  -- 觸達（三個查詢都先以 tenant_id 篩過），但深度防禦不該倚賴那個前提。
  --
  -- 放在冪等鍵之前的理由：驗證失敗時連 grant 列都不該出現。
  perform 1 from public.campaigns
   where id = p_campaign and tenant_id = p_tenant;
  if not found then
    raise exception 'CAMPAIGN_NOT_FOUND';
  end if;

  perform 1 from public.customers
   where id = p_customer and tenant_id = p_tenant;
  if not found then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;

  -- ① 先搶冪等鍵。`on conflict do nothing` 讓「已經發過」成為一個普通結果，
  --    而不是一個要靠訊息字串去分辨的例外。
  insert into public.campaign_reward_grants
    (tenant_id, campaign_id, customer_id, trigger_kind, source_id, bonus_points)
  values
    (p_tenant, p_campaign, p_customer, p_trigger, p_source, v_points)
  on conflict (tenant_id, campaign_id, customer_id) do nothing
  returning id into v_grant;

  if v_grant is null then
    out_granted := false;
    out_points_after := null;
    out_coupon_instance := null;
    return next;
    -- ⚠️ `return next` 只是把一列加進結果集，**不會結束函式**。少了下面這個
    -- `return;`，後面的發放邏輯會照跑，等於冪等完全失效。這一點是 #218 那條線
    -- 在 0059 上實際踩過的（同一支函式回了 created=false 與 created=true 兩列）。
    return;
  end if;

  -- ② 票券（先驗證再發，失敗就整筆回滾）
  if p_coupon is not null then
    -- ⚠️ `for update` 不是裝飾。少了它，限量檢查是一個 TOCTOU：
    -- `count(*)` 在 read committed 下看不到別的交易尚未提交的 insert，於是
    -- `total_quantity = 1` 的券被兩位顧客同時領取時，**兩邊都會通過檢查、兩邊
    -- 都發出去**（實測：issued = 2 > total = 1）。限時優惠 ＋ 限量券正是最容易
    -- 同時發生的場景——兩個 LINE 使用者同時打同一個關鍵字。
    -- 鎖住 coupons 那一列，讓「檢查 → 發放」對同一張券串行化。
    --
    -- 鎖順序固定為 coupons → customers（見下方 ③），同一支函式內恆定；與
    -- `redeem_booking_points`（bookings → customers）不構成環，無 deadlock 路徑。
    select total_quantity into v_total
      from public.coupons
     where id = p_coupon and tenant_id = p_tenant
     for update;
    if not found then
      raise exception 'COUPON_NOT_FOUND';
    end if;

    -- total_quantity = 0 代表不限量（0004 的欄位註解）
    if v_total > 0 then
      select count(*) into v_issued
        from public.coupon_instances
       where tenant_id = p_tenant and coupon_id = p_coupon;
      if v_issued >= v_total then
        raise exception 'COUPON_EXHAUSTED';
      end if;
    end if;

    insert into public.coupon_instances (tenant_id, coupon_id, customer_id, code)
    values (p_tenant, p_coupon, p_customer, p_code)
    returning id into out_coupon_instance;

    update public.campaign_reward_grants
       set coupon_instance_id = out_coupon_instance
     where id = v_grant;
  end if;

  -- ③ 點數（列鎖後由資料庫自己讀自己算，理由同 0090）
  if v_points > 0 then
    select c.points into v_current
      from public.customers c
     where c.id = p_customer and c.tenant_id = p_tenant
     for update;
    if not found then
      raise exception 'CUSTOMER_NOT_FOUND';
    end if;

    update public.customers
       set points = customers.points + v_points
     where id = p_customer and tenant_id = p_tenant;

    out_points_after := v_current + v_points;

    insert into public.customer_point_logs
      (tenant_id, customer_id, delta, reason, points_after)
    values
      (p_tenant, p_customer, v_points, 'CAMPAIGN_REWARD', out_points_after);
  end if;

  out_granted := true;
  return next;
  return;
end $$;

-- ⚠️ PB-028：`revoke ... from anon, authenticated` **不會**移除 PostgreSQL 對新建
-- 函式預設給 PUBLIC 的 EXECUTE。anon 與 authenticated 都是 PUBLIC 的成員，只撤那
-- 兩個角色時側門仍然開著——任何拿到 anon key 的瀏覽器都能直接呼叫這支 security
-- definer 函式，替自己加點數。三句都要有。
revoke all on function public.grant_campaign_reward(uuid, uuid, uuid, text, uuid, int, uuid, text) from public;
revoke all on function public.grant_campaign_reward(uuid, uuid, uuid, text, uuid, int, uuid, text) from anon, authenticated;
grant execute on function public.grant_campaign_reward(uuid, uuid, uuid, text, uuid, int, uuid, text) to service_role;
