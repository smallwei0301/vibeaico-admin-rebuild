-- 0113 — Issue #23：推廣成效 page_view_events（匿名近似 UV，公開頁埋點）
-- ============================================================================
-- Owner Decision `docs/decisions/2026-09-14-promotion-anonymous-approximate-uv.md`：
--   - UV 是匿名近似值，不是精準去重人口計數。
--   - `visitor_hash` = 每日輪替 salt ＋ 當次 IP ＋ UA（或等價低敏訊號）算出的匿名
--     hash；只存 hash，原始 IP 完全不落地。
--   - 不得把 visitor_hash 與 customer／traveler／LINE user／email／phone 做身分關聯
--     ——這張表刻意不含任何指向那些表的外鍵。
--   - raw event 保留 180 天，超過由 bounded cron 清理（見
--     `src/server/promotion-events.ts` 的 `cleanupExpiredPromotionEvents`）。
--   - 第一版採 query-time aggregation，不先建預聚合日表（`/api/promotion/stats`
--     直接對這張表 count / distinct）。
--
-- ⚠️ 匿名寫入安全（Issue #23「匿名寫入安全」一節）：
-- 公開頁可以「觸發」寫入事件，不代表允許瀏覽器直接指定 tenant_id 寫入這張表。
-- 這裡刻意**不**開放 anon/authenticated 的 INSERT policy —— 寫入只走
-- `src/server/promotion-events.ts`（service role，繞過 RLS），tenant_id 來自
-- server 端已解析出的 public shop tenant，不接受 client 送來的任何 tenant_id。
-- 這與 `src/server/public-shop.ts` 讀公開店家資料同一套「service role 自己收窄
-- 範圍」的道理，只是這裡方向反過來（寫而不是讀）。

create table if not exists public.page_view_events (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references public.tenants(id) on delete cascade,
  path             text not null,
  -- 'QR' | 'LINE' | 'DIRECT'（Issue #23 最小分類）。只有 current public-link
  -- contract 真的有可驗證入口時才擴充，不為了 enum 好看預先製造來源。
  source           text not null default 'DIRECT',
  -- 匿名 hash，見檔頭；無法逆推回原始 IP。
  visitor_hash     text not null,
  -- 低敏 UA 分類桶（'MOBILE' | 'DESKTOP' | 'BOT' | 'OTHER'）——不存原始 User-Agent
  -- 字串，避免它變成事實上可指紋辨識訪客的欄位。
  user_agent_class text not null default 'OTHER',
  created_at       timestamptz not null default now()
  -- ⚠️ 刻意沒有任何 IP 欄位（ip / ip_address / raw_ip / client_ip ……一律不存）
  --    ——這是本表最重要的一條隱私邊界，下面的 do 區塊會再次硬性檢查它。
);

-- PB-026：`create table if not exists` 遇到既有同名但形狀不同的表會靜默跳過，
-- 讓後面的索引／policy 對著一張少了欄位（或型別不同）的表運作，錯誤要等到
-- 執行期才出現。這裡把靜默跳過變成大聲失敗。
do $$
declare
  r record;
  v_actual text;
begin
  for r in select * from (values
      ('tenant_id', 'uuid'),
      ('path', 'text'),
      ('source', 'text'),
      ('visitor_hash', 'text'),
      ('user_agent_class', 'text'),
      ('created_at', 'timestamp with time zone')
    ) as e(col, expected_type)
  loop
    select data_type into v_actual
      from information_schema.columns
     where table_schema = 'public'
       and table_name = 'page_view_events'
       and column_name = r.col;
    if v_actual is null then
      raise exception 'page_view_events.% missing — existing table has an incompatible shape', r.col;
    end if;
    if v_actual <> r.expected_type then
      raise exception 'page_view_events.% is % — expected % (existing table has an incompatible shape)',
        r.col, v_actual, r.expected_type;
    end if;
  end loop;

  -- 硬性再確認一次：這張表絕對不能出現任何看起來像原始 IP 的欄位。
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public'
       and table_name = 'page_view_events'
       and column_name in ('ip', 'ip_address', 'raw_ip', 'client_ip', 'visitor_ip')
  ) then
    raise exception 'page_view_events must never have a raw IP column';
  end if;
end $$;

-- query-time aggregation 的主要查詢形狀：依 tenant + 時間範圍撈事件，
-- 再依 visitor_hash 去重（UV）、依 source 分組（bySource）。
create index if not exists idx_page_view_events_tenant_created
  on public.page_view_events (tenant_id, created_at desc);

create index if not exists idx_page_view_events_tenant_visitor
  on public.page_view_events (tenant_id, visitor_hash);

-- 180 天 retention cleanup 的邊界索引（cron 依 created_at < cutoff 刪除舊列）。
create index if not exists idx_page_view_events_created_at
  on public.page_view_events (created_at);

alter table public.page_view_events enable row level security;

-- 只讀 policy：租戶成員只能看自己租戶的事件（鏡像既有 is_tenant_member(tenant_id)
-- 寫法，見 0001_extensions_and_functions.sql）。刻意沒有對應的 insert/update/delete
-- policy 給 authenticated/anon —— 寫入與清理一律走 service role，見檔頭。
drop policy if exists p_page_view_events_select on public.page_view_events;
create policy p_page_view_events_select on public.page_view_events
  for select to authenticated
  using (is_tenant_member(tenant_id));
