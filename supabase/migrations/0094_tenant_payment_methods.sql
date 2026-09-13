-- 0094 — 店家收款方式（issue #9 第二步：線下收款真的存得住）
-- =============================================================================
-- 在此之前，`/tenant/payment-methods` 是**整頁假的**：`load()` 用
-- `setTimeout(320)` 假裝網路延遲然後讀頁內的 `MOCK_METHODS`，新增／編輯／啟停／
-- 刪除全部只改本地 state 再跳一個成功 toast。它**不是** `adapt()` 的 mock 分支，
-- 所以不受 `NEXT_PUBLIC_USE_MOCK` 影響——正式站上也是那一段。店家設定完收款方式、
-- 看到「已更新」，重新整理就全部消失。
--
-- 本檔建立那張一直不存在的表。
--
-- ## ⚠️ 本檔刻意**不**建立任何金流閘道欄位
--
-- 頁面上的「線上刷卡付款」需要藍新／綠界的商店憑證（Merchant ID / HashKey /
-- HashIV），而那條路徑還沒有任何實作，也還沒拿到憑證（issue #9 第三步，與
-- #12／#32 綁定）。先建幾個沒有任何程式會寫入的加密欄位是投機：它會讓下一個
-- 讀到 schema 的人以為金流已經接好。等真的要接時再往前補一支 migration。
--
-- 因此本檔涵蓋的是六種收款方式裡的**五種線下收款**：LINE Pay／街口／銀行轉帳／
-- 現金／其他——它們本來就只是「把你的帳號或 QR 給顧客看」，不需要金流商。
--
-- ## ⚠️ 這張表在共用 TEST 上**已經存在**（PB-026）
--
-- `nmwhwngojosmagjuvxol` 上有一張同名表，14 欄，來自一條**未合併分支**——它套用了
-- 一支名為 `tenant_payment_methods` 的 migration，而那支 SQL **在 repo 的任何目錄
-- 都不存在**（盤點見 issue #197 的 2026-09-08 留言）。
--
-- 這正是 PB-026 的形狀：`create table if not exists` 對著一張同名但不同形狀的表
-- 會**什麼都不做**，然後應用層對著別人的舊形狀跑，測試全綠而 schema 是錯的。
--
-- 所以本檔採「建立 → 逐欄補齊 → 斷言」三段式：
--   1. `create table if not exists` 讓乾淨資料庫得到正確的表；
--   2. `add column if not exists` 讓**已存在的舊表**補上缺的欄位（TEST 缺 updated_at）；
--   3. 檔尾逐欄斷言，缺任何一欄就 raise——不讓「跳過了但沒人發現」這件事發生。
-- 步驟 2 只會**新增**欄位，不動舊分支留下的多餘欄位（那些欄位由 #197 另案清理，
-- 在這裡 drop 會刪掉不屬於本 issue 的東西）。

-- ---------------------------------------------------------------- 收款類型
-- 六個值與 `src/i18n/zh-TW/pages/payment-methods.ts` 的 `methodTypeOptions`
-- 逐一對應。ONLINE_PAYMENT 保留在列舉裡（店家仍可先建好這一筆），但本階段沒有
-- 任何閘道欄位可存，UI 會誠實標示尚未開通。
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
                  where n.nspname = 'public' and t.typname = 'payment_method_type') then
    create type public.payment_method_type as enum
      ('LINE_PAY', 'JKOPAY', 'BANK_TRANSFER', 'CASH', 'ONLINE_PAYMENT', 'OTHER');
  end if;
end $$;

-- 型別若是舊分支留下的，值不一定齊；逐一補。`add value if not exists` 對已存在的
-- 值是 no-op，且不能放在同一個交易區塊裡與後續使用併行，故獨立成句。
alter type public.payment_method_type add value if not exists 'LINE_PAY';
alter type public.payment_method_type add value if not exists 'JKOPAY';
alter type public.payment_method_type add value if not exists 'BANK_TRANSFER';
alter type public.payment_method_type add value if not exists 'CASH';
alter type public.payment_method_type add value if not exists 'ONLINE_PAYMENT';
alter type public.payment_method_type add value if not exists 'OTHER';

-- -------------------------------------------------------------------- 資料表
create table if not exists public.tenant_payment_methods (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references public.tenants(id) on delete cascade,
  method_type   public.payment_method_type not null,
  display_name  text not null default '',
  -- 銀行轉帳以外的收款方式用 QR 圖；走既有的 /api/upload（richmenu-assets bucket）
  qr_image_url  text not null default '',
  /*
   * 銀行欄位與備註放 jsonb，不逐欄開：
   *   bankName / bankCode / accountNumber / accountHolderName / instructions
   *
   * 理由是這些欄位**只有銀行轉帳這一種類型會用到**，逐欄開會讓另外四種類型永遠
   * 帶著四個空字串欄位；而它們也不需要被查詢或索引——頁面永遠是整筆讀寫。
   * ⚠️ 這裡不放任何祕密：金流憑證屬於第三步，見檔頭。
   */
  config        jsonb not null default '{}'::jsonb,
  active        boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- 舊表補欄（見檔頭 PB-026 那一段）。對乾淨資料庫全部是 no-op。
alter table public.tenant_payment_methods
  add column if not exists display_name text not null default '',
  add column if not exists qr_image_url  text not null default '',
  add column if not exists config        jsonb not null default '{}'::jsonb,
  add column if not exists active        boolean not null default true,
  add column if not exists sort_order    integer not null default 0,
  add column if not exists created_at    timestamptz not null default now(),
  add column if not exists updated_at    timestamptz not null default now();

create index if not exists tenant_payment_methods_tenant_sort
  on public.tenant_payment_methods (tenant_id, sort_order, created_at);

-- ---------------------------------------------------------------------- RLS
alter table public.tenant_payment_methods enable row level security;

/*
 * ⚠️ 這裡是「收斂」而不是「有就算了」。
 *
 * 共用 TEST 上那張舊表已經帶著三條未合併分支留下的政策
 * （`p_tenant_payment_methods_r/i/u`）。如果本檔只在「沒有任何 is_tenant_member
 * 政策」時才建立自己的政策，結果會是：TEST 跑的是舊分支的權限語意，乾淨資料庫
 * （含正式站）跑的是本檔的語意，而兩者不一定一樣——整合測試在 TEST 全綠，正式站
 * 的權限卻是另一回事。那是 PB-026 的另一面。
 *
 * 所以先把已知的舊名與本檔的名字都 drop 掉，再無條件建立四條規範政策，讓任何
 * 資料庫套用完之後的政策集合**逐字相同**：
 *   讀：任何店員（is_tenant_member）——GET 走 requireTenant() 不限角色。
 *   寫：MANAGER 以上（tenant_role_at_least）——POST/PUT/DELETE 走
 *       requireTenant('MANAGER')，RLS 與應用層同一條線。
 */
drop policy if exists p_tenant_payment_methods_r on public.tenant_payment_methods;
drop policy if exists p_tenant_payment_methods_i on public.tenant_payment_methods;
drop policy if exists p_tenant_payment_methods_u on public.tenant_payment_methods;
drop policy if exists p_tenant_payment_methods_d on public.tenant_payment_methods;
drop policy if exists tenant_payment_methods_tenant on public.tenant_payment_methods;
drop policy if exists p_tpm_r on public.tenant_payment_methods;
drop policy if exists p_tpm_i on public.tenant_payment_methods;
drop policy if exists p_tpm_u on public.tenant_payment_methods;
drop policy if exists p_tpm_d on public.tenant_payment_methods;

create policy p_tpm_r on public.tenant_payment_methods
  for select using (is_tenant_member(tenant_id));
create policy p_tpm_i on public.tenant_payment_methods
  for insert with check (tenant_role_at_least(tenant_id, 'MANAGER'));
create policy p_tpm_u on public.tenant_payment_methods
  for update using (tenant_role_at_least(tenant_id, 'MANAGER'))
             with check (tenant_role_at_least(tenant_id, 'MANAGER'));
create policy p_tpm_d on public.tenant_payment_methods
  for delete using (tenant_role_at_least(tenant_id, 'MANAGER'));

-- ------------------------------------------------------- 套用後的形狀斷言
/*
 * ⚠️ 這一段**不是裝飾**。它擋的是檔頭寫的那個具體情況：共用 TEST 上已經有一張
 * 同名但不同形狀的表，`create table if not exists` 對它什麼都不做。少了這一段，
 * 「跳過了」與「建好了」在套用日誌上長得一模一樣。
 *
 * 實測方式（PB-027：斷言要能真的擋下東西才算數）：把上面 `add column if not
 * exists updated_at` 那一行刪掉，再對一個已有舊形狀的資料庫套用，這裡會 raise。
 */
do $$
declare
  v_missing text;
begin
  select string_agg(want.col, ', ' order by want.col) into v_missing
    from (values
      ('id'), ('tenant_id'), ('method_type'), ('display_name'),
      ('qr_image_url'), ('config'), ('active'), ('sort_order'),
      ('created_at'), ('updated_at')
    ) as want(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'tenant_payment_methods'
        and c.column_name = want.col
   );

  if v_missing is not null then
    raise exception
      'tenant_payment_methods 缺少必要欄位：%（很可能是同名舊表讓 create table if not exists 被跳過）',
      v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'tenant_payment_methods' and c.relrowsecurity
  ) then
    raise exception 'tenant_payment_methods 沒有啟用 RLS';
  end if;

  -- 政策集合必須**逐字**是本檔建立的那四條；多一條舊分支殘留就代表語意分歧。
  select string_agg(p.polname, ', ' order by p.polname) into v_missing
    from pg_policy p join pg_class c on c.oid = p.polrelid
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'tenant_payment_methods';
  if v_missing is distinct from 'p_tpm_d, p_tpm_i, p_tpm_r, p_tpm_u' then
    raise exception 'tenant_payment_methods 的 RLS 政策集合不如預期：%（預期 p_tpm_d, p_tpm_i, p_tpm_r, p_tpm_u）', v_missing;
  end if;
end $$;
