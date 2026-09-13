-- 0105 — 旅客風險政策（issue #44，第一步：tenant-scoped 持久化層）
-- =============================================================================
-- ## 編號怎麼選的
--
-- 施工當下 `origin/main` 最新是 `0104_tour_order_lineage_keys.sql`。掃過當時所有
-- open PR 的 diff（#401/#312/#99/#98/#96/#92/#89/#87/#86/#75/#73/#62/#60/#56），
-- 沒有任何一張宣告過 `0105` 或更高——它們各自 stacked 在自己更舊的 base 上，
-- migration 檔名落在 `0016`～`0064` 之間，不是本輪的競爭對象。依 PB-017，實際
-- 套用時機仍必須晚於「檔名在 main 定案」，這裡先佔號並在 PR 說明可能需要依當時
-- `main` 頭部重新核對，不擅自套用到任何資料庫。
--
-- ## 為什麼先合併目前 main 才動這支檔
--
-- 本分支（`terra/issue-44-traveler-risk-cbc8`）落後 main 508 個 commit，且它自己
-- 的 `supabase/migrations/` 只到 `0014`——不是「差幾支」，是完全跟不上目前的
-- `tenants` / `customers` / RLS helper 現狀（`is_tenant_member` / `tenant_role_at_least`
-- 已在 main 上演進到 0095 才定案的 service_role 例外）。在這支落後的分支上直接接
-- `0015` 只會造成 PB-017 那種「先套用、後改名」的帳本偏差，而且新表要 FK 到的
-- `tenants(id)` / `customers(id)` 結構本身也可能已經變了。這是
-- `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md` 明文允許
-- 的「material migration-ledger change/prefix collision」例外，所以本檔是在先
-- `git merge origin/main`（非 rebase，保留既有兩個 commit 不改寫）之後才寫的。
--
-- ## 設計：append-only 帳本，不是「一列可覆寫的目前狀態」
--
-- Issue #44 明文要求「所有政策套用必須有原因、操作者與時間紀錄」且「新增／修改／
-- 解除政策都留 audit」。如果用一張可 UPDATE 的表存「目前政策」，每次變更都要另開
-- 一張稽核表存歷史，兩張表就可能分岔。這裡讓 `traveler_risk_policies` 本身就是
-- 一筆一筆的事件（指派 DEFAULT 等同「解除」），RLS 只開放 SELECT 與 INSERT、不開
-- UPDATE／DELETE——不可篡改是資料庫層面保證的，不是「應用層答應不改」。
-- 「目前政策」由 `traveler_risk_current_policy` view（取每位旅客最新一列）供讀取。
--
-- ## 政策值域：逐字對齊 2026-09-11 Owner Decision，DB 是最後一道防線
--
-- `docs/decisions/2026-09-11-guide-traveler-policy-no-deposit-waiver.md`：第一版
-- 不提供熟客免訂金／`FORCE_NO_DEPOSIT` 或任何等價能力。`policy` 的 check 只列了
-- 四個值（`DEFAULT`／`FORCE_DEPOSIT`／`REQUEST_ONLY`／`BLOCK_SELF_SERVICE`），
-- 逐字對應既有 kernel `src/server/traveler-booking-policy.ts` 的
-- `TravelerBookingPolicy['kind']`；即使應用層之後不小心多開一個值，資料庫本身
-- 就會拒絕寫入，不用等到 review 抓到。`deposit_mode` 只允許
-- `DEPOSIT_FIXED`／`DEPOSIT_PERCENT`（比 `TripPlan.depositMode` 少 `NONE`／`FULL`
-- 兩個值）——這正是 kernel 裡 `resolveTravelerBookingPolicy()` 對 `FORCE_DEPOSIT`
-- 拒絕 `NONE`／`FULL` 的同一條規則，在 DB 端重複一次。
--
-- ## customer_id 必須真的屬於 tenant_id，不能只靠 RLS
--
-- 只用 `references customers(id)` 配合 RLS 的 `is_tenant_member(tenant_id)`，擋得
-- 住「讀到別店資料」，擋不住「A 店 OWNER 把 tenant_id 填自己店、customer_id 填
-- B 店某位顧客的真實 id」——那筆政策列本身不會外洩 B 店任何欄位，但它是一筆指向
-- 別家顧客的髒資料，未來任何 join 都會撿到。用複合 FK
-- `(customer_id, tenant_id) references customers(id, tenant_id)` 在資料庫層直接
-- 擋掉這個組合，比在 RLS `with check` 裡另外 `exists` 子查詢更難被繞過（FK 對
-- 所有寫入路徑一致生效，`with check` 只對 PostgREST 走的那條路徑生效）。

-- ---------------------------------------------------------- customers 複合 FK 靶
-- id 已是主鍵（全域唯一），加一個 (id, tenant_id) 的具名 UNIQUE 約束不改變任何
-- 既有語意，只是讓下面的複合 FK 有東西可以指。刻意用 `add constraint … unique`
-- 而不是裸 `create unique index`：兩者都能滿足 FK 的目標需求，但前者在
-- `information_schema.table_constraints` 留下明確、可稽核的約束名稱。
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.customers'::regclass
       and conname = 'customers_id_tenant_uq'
  ) then
    alter table public.customers add constraint customers_id_tenant_uq unique (id, tenant_id);
  end if;
end $$;

-- ------------------------------------------------------------------- 資料表
create table if not exists public.traveler_risk_policies (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  customer_id   uuid not null,
  policy        text not null check (policy in ('DEFAULT', 'FORCE_DEPOSIT', 'REQUEST_ONLY', 'BLOCK_SELF_SERVICE')),
  deposit_mode  text,
  deposit_value numeric,
  -- 4 字下限比 impersonation_sessions 的 8 字寬鬆一點：那邊是平台代登入，這裡是
  -- 店家自己對自己顧客下的政策，但「無字理由」一樣不可接受。
  reason        text not null check (length(btrim(reason)) between 4 and 500),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  actor_label   text not null check (length(btrim(actor_label)) between 1 and 100),
  created_at    timestamptz not null default now(),

  constraint traveler_risk_policies_customer_tenant_fk
    foreign key (customer_id, tenant_id) references public.customers (id, tenant_id) on delete cascade,

  -- 值域：只有 FORCE_DEPOSIT 可以帶 deposit_mode/deposit_value，且兩個欄位的
  -- 邊界值逐字對齊 src/server/payment-policy.ts 的 resolvePaymentPolicy()。
  -- DEPOSIT_FIXED 的上限（不得超過該筆訂單應付金額）無法在「定義政策」當下
  -- 檢查——那要等到有一筆具體訂單的 amountDue 才知道，屬於既有 kernel 在使用
  -- 當下驗證的範圍，這裡只鎖靜態邊界。
  constraint traveler_risk_policies_deposit_domain_ck check (
    (
      policy = 'FORCE_DEPOSIT'
      and deposit_mode in ('DEPOSIT_FIXED', 'DEPOSIT_PERCENT')
      and deposit_value is not null
      and (
        (deposit_mode = 'DEPOSIT_FIXED' and deposit_value > 0)
        or (deposit_mode = 'DEPOSIT_PERCENT' and deposit_value between 1 and 100)
      )
    )
    or (
      policy <> 'FORCE_DEPOSIT'
      and deposit_mode is null
      and deposit_value is null
    )
  )
);

create index if not exists traveler_risk_policies_lookup_idx
  on public.traveler_risk_policies (tenant_id, customer_id, created_at desc, id desc);

-- --------------------------------------------------------- 目前政策（最新一列）
create or replace view public.traveler_risk_current_policy with (security_invoker = true) as
select distinct on (tenant_id, customer_id)
  id, tenant_id, customer_id, policy, deposit_mode, deposit_value,
  reason, actor_user_id, actor_label, created_at
from public.traveler_risk_policies
order by tenant_id, customer_id, created_at desc, id desc;

-- ---------------------------------------------------------------------- RLS
-- 三段式，缺一不可（PB-028）：先關對 PUBLIC 的預設授權、再關對兩個前端角色的
-- 直接授權、最後把實際需要的權限明確 grant 回去——不靠環境的 default privileges
-- （同族教訓見 0095 對 impersonation_sessions/actions 的處理，理由抄自那裡）。
alter table public.traveler_risk_policies enable row level security;
alter table public.traveler_risk_policies force row level security;

drop policy if exists p_trp_r on public.traveler_risk_policies;
drop policy if exists p_trp_i on public.traveler_risk_policies;
drop policy if exists p_trp_u on public.traveler_risk_policies;
drop policy if exists p_trp_d on public.traveler_risk_policies;

-- 讀：任何店員都能看自己店的旅客風險摘要與政策（畫面上任何角色都會看到旅客詳情）。
create policy p_trp_r on public.traveler_risk_policies
  for select using (is_tenant_member(tenant_id));

-- 寫（僅 INSERT，本表不開放 UPDATE/DELETE——見檔頭「append-only 帳本」）：
--   1. MANAGER 以上才能套用政策，避免 Issue 原話「工作人員誤用」。
--   2. `actor_user_id = auth.uid()`：呼叫者只能把自己登記成操作者，不能代別人
--      背書一筆他沒做過的操作——這條不是資料完整性小節，是防止稽核紀錄本身被
--      偽造。service_role（後台批次／未來 #41 自動化）不受此限，見下方 grant。
create policy p_trp_i on public.traveler_risk_policies
  for insert with check (
    tenant_role_at_least(tenant_id, 'MANAGER')
    and actor_user_id = auth.uid()
  );

revoke all on table public.traveler_risk_policies from public, anon, authenticated;
revoke all on public.traveler_risk_current_policy from public, anon, authenticated;
grant select, insert on table public.traveler_risk_policies to authenticated;
grant select on public.traveler_risk_current_policy to authenticated;
grant select, insert, update, delete on table public.traveler_risk_policies to service_role;
grant select on public.traveler_risk_current_policy to service_role;

-- ------------------------------------------------------- 套用後的形狀斷言
-- PB-026／0094 同款：`create table if not exists` 對同名不同形狀的舊表會靜默
-- 跳過，不逐項斷言的話「跳過了」與「建好了」在套用日誌上長得一模一樣。
do $$
declare
  v_missing text;
begin
  select string_agg(want.col, ', ' order by want.col) into v_missing
    from (values
      ('id'), ('tenant_id'), ('customer_id'), ('policy'), ('deposit_mode'),
      ('deposit_value'), ('reason'), ('actor_user_id'), ('actor_label'), ('created_at')
    ) as want(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'traveler_risk_policies'
        and c.column_name = want.col
   );
  if v_missing is not null then
    raise exception 'traveler_risk_policies 缺少必要欄位：%', v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'traveler_risk_policies'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'traveler_risk_policies 沒有啟用（且 force）RLS';
  end if;

  -- 政策集合必須逐字只有 p_trp_i / p_trp_r——多一條就代表本表不再是 append-only。
  select string_agg(p.polname, ', ' order by p.polname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'traveler_risk_policies';
  if v_missing is distinct from 'p_trp_i, p_trp_r' then
    raise exception 'traveler_risk_policies 的 RLS 政策集合不如預期：%（預期 p_trp_i, p_trp_r）', v_missing;
  end if;

  -- GRANT 是與 RLS policy 分開的另一道；PB-028 的教訓是「不能只看 migration 原始
  -- 碼推斷結果」，這裡直接查 information_schema 的實際授權表，而不是相信上面的
  -- grant/revoke 語句「應該」生效了。
  if exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'traveler_risk_policies'
       and g.grantee in ('anon', 'PUBLIC')
  ) then
    raise exception 'traveler_risk_policies 仍對 anon/PUBLIC 開放權限';
  end if;
  if exists (
    select 1 from information_schema.role_table_grants g
     where g.table_schema = 'public' and g.table_name = 'traveler_risk_policies'
       and g.grantee = 'authenticated' and g.privilege_type in ('UPDATE', 'DELETE')
  ) then
    raise exception 'traveler_risk_policies 不應對 authenticated 開放 UPDATE/DELETE（append-only 帳本）';
  end if;
end $$;
