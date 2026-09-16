-- 0118 — 平台贊助金流：donations schema（issue #25 C 段）
-- =============================================================================
-- 在此之前，`/tenant/donate` 是**整頁假的**：`MOCK_DONORS`／`MOCK_TOTAL_DONATED`／
-- `MOCK_MY_DONATED` 是頁面檔內的硬編碼常數，`submit()` 只是 `setTimeout(420)`
-- 假裝打錢，永遠成功。`src/app/api` 底下沒有任何 donations 路由。
--
-- ## 這不是租戶資料，刻意不掛 tenant_id 外鍵
--
-- 贊助收的是平台自己的錢，不是任何一家店的營收，語意上不屬於任何 tenant。
-- 用 `donor_user_id`（`auth.users.id`）記錄「誰按下贊助」，而不是「哪家店贊助」——
-- 一位使用者可能同時是好幾家店的成員，贊助是他個人的行為，不因他當下切到哪家
-- 店的後台而改變歸屬。`display_name` 是使用者自己填的公開顯示名稱（原站行為：
-- 預設用店名，但可改成任何字），不是从 tenants 表帶出來的欄位。
--
-- ## RLS 收得比店家表更窄：完全不對 authenticated 開放
-- 這張表要回答兩種查詢：「全平台累積贊助」與「感謝名單」——兩者都是**跨租戶**
-- 聚合／列表，任何一條 `tenant_role_at_least(tenant_id, ...)` 式的政策都答不出來
-- （這張表根本沒有 tenant_id 可以掛）。所以不開任何 PostgREST 直讀直寫路徑：
-- 全部經 `/api/donations/**`（service role），由應用層決定「這個使用者能看到
-- 什麼」（自己的贊助總額 vs. 公開的、只含 PAID 狀態的感謝名單），不是誰都能
-- 拿 anon key 直接查表看到別人的 PENDING／FAILED 訂單或 provider_trade_no。
--
-- ## 金流閘道憑證不在這張表
-- `ECPAY_MERCHANT_ID` / `ECPAY_HASH_KEY` / `ECPAY_HASH_IV` 是平台層環境變數
-- （`src/config/env.ts`），不是資料庫欄位——那是部署一次的平台設定，不是「每
-- 一筆贊助訂單」的資料。詳見 issue #25 C 段「Live credential truth」。

-- -------------------------------------------------------------------- 資料表
create table if not exists public.platform_donations (
  id                 uuid primary key default pg_catalog.gen_random_uuid(),
  donor_user_id      uuid not null references auth.users(id) on delete cascade,
  display_name       text not null default '',
  amount             integer not null check (amount between 10 and 100000),
  -- 狀態機：PENDING（已建單，等待付款）→ PAID（callback 驗證通過）
  --                                    → FAILED（callback 驗證通過但付款失敗，
  --                                              或金額不符）。
  -- 三態一次到位，之後不再從 PAID/FAILED 改回 PENDING（見檔尾斷言）。
  status             text not null default 'PENDING'
                        check (status in ('PENDING', 'PAID', 'FAILED')),
  provider           text not null default 'ECPAY',
  -- 我方產生、送給金流商的訂單編號；callback 冪等處理的查找鍵與唯一性保證都靠它。
  merchant_trade_no  text not null,
  -- 金流商回傳的交易序號；callback 尚未進來之前是 null。
  provider_trade_no  text,
  -- callback 完整參數（不含任何我方憑證），供事後追查金額 / RtnCode 不符的原因。
  raw_callback       jsonb,
  paid_at            timestamptz,
  created_at         timestamptz not null default pg_catalog.now(),
  updated_at         timestamptz not null default pg_catalog.now()
);

alter table public.platform_donations
  add column if not exists donor_user_id     uuid,
  add column if not exists display_name      text not null default '',
  add column if not exists amount            integer,
  add column if not exists status            text not null default 'PENDING',
  add column if not exists provider          text not null default 'ECPAY',
  add column if not exists merchant_trade_no text,
  add column if not exists provider_trade_no text,
  add column if not exists raw_callback      jsonb,
  add column if not exists paid_at           timestamptz,
  add column if not exists created_at        timestamptz not null default pg_catalog.now(),
  add column if not exists updated_at        timestamptz not null default pg_catalog.now();

create unique index if not exists platform_donations_merchant_trade_no_uq
  on public.platform_donations (merchant_trade_no);

-- 公開感謝名單／全平台累積：只挑 PAID，依付款時間排序。
create index if not exists platform_donations_paid_at_idx
  on public.platform_donations (paid_at desc) where status = 'PAID';

-- 「我已贊助多少」：依 donor 查、依時間排序。
create index if not exists platform_donations_donor_created_idx
  on public.platform_donations (donor_user_id, created_at desc);

drop trigger if exists trg_platform_donations_updated_at on public.platform_donations;
create trigger trg_platform_donations_updated_at
  before update on public.platform_donations
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------- RLS
alter table public.platform_donations enable row level security;
alter table public.platform_donations force row level security;

-- 沒有任何政策——force RLS 之下等於「沒有政策就沒有人能過」，
-- 唯一能碰這張表的只有繞過 RLS 的 service role。
revoke all on table public.platform_donations from public, anon, authenticated;
grant select, insert, update, delete on table public.platform_donations to service_role;

-- ------------------------------------------------------- 套用後的形狀斷言
do $$
declare
  v_missing text;
begin
  select pg_catalog.string_agg(want.col, ', ' order by want.col) into v_missing
    from (values
      ('id'), ('donor_user_id'), ('display_name'), ('amount'), ('status'),
      ('provider'), ('merchant_trade_no'), ('provider_trade_no'), ('raw_callback'),
      ('paid_at'), ('created_at'), ('updated_at')
    ) as want(col)
   where not exists (
     select 1 from information_schema.columns c
      where c.table_schema = 'public'
        and c.table_name = 'platform_donations'
        and c.column_name = want.col
   );

  if v_missing is not null then
    raise exception 'platform_donations 缺少必要欄位：%', v_missing;
  end if;

  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'platform_donations'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'platform_donations 沒有啟用／強制 RLS';
  end if;

  if exists (
    select 1 from pg_policy p join pg_class c on c.oid = p.polrelid
     join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'platform_donations'
  ) then
    raise exception 'platform_donations 不應該有任何 RLS 政策（一般使用者不可直讀直寫，見檔頭）';
  end if;
end $$;
