-- 0016_tour_domain_core.sql — Phase 8a：行程與方案（10 分冊 §1 的核心兩表）
--
-- 與 10 分冊原規格的差異（依使用者指示「行程與方案和 tour-platform 對齊，
-- 該站管理者匯出的 JSON 要能原樣傳上來、不會遺漏」）：
--   1. 行程層補 tagline / short_description / category / good_for / faq /
--      social_proof_quotes / refund_rules / duration_minutes
--      —— 皆為 tour-platform `buildActivityExportTemplate()` 的輸出欄位。
--   2. 方案層補 slug / highlights / plan_inclusions / plan_exclusions /
--      plan_notices / plan_refund_rules / plan_itinerary / meeting_*
--      / experience_* / language / earliest_departure / confirm_by_days
--      / free_cancel_days / details_link_text / booking_btn_text。
--      其中 plan_itinerary 是 tour-platform 的「方案詳細行程站點表」，
--      每站 {icon,title,duration,description,imageUrl}，imageUrl 即
--      「每個時間點可上傳照片」。10 分冊完全沒有這個概念。
--   3. 團次（trip_departures）、加購（trip_addons）、旅遊訂單（tour_orders）
--      與導遊金流留在 Phase 8b，本檔不建，避免一次改動過大。
--
-- 陣列型欄位一律用 jsonb（而非 text[]）：tour-platform 的 JSON 直接就是陣列，
-- jsonb 可原樣存取、不需要在應用層做 array 轉換，也方便日後欄位再長出來。
--
-- RLS 樣板與 02 分冊 §0006 相同：全部套 is_tenant_member(tenant_id)。
-- 公開讀取（商店頁 / Midao 前台）走 API 層 service role + 顯式挑欄位，
-- 不開匿名 RLS。

create type trip_status as enum ('DRAFT','PUBLISHED','ARCHIVED');

create table trips (
  id                  uuid primary key default gen_random_uuid(),
  tenant_id           uuid not null references tenants(id) on delete cascade,
  slug                text not null,
  title               text not null,
  tagline             text not null default '',
  summary             text not null default '',      -- tour-platform shortDescription
  description         text not null default '',
  region              text not null default '',
  category            text not null default '',
  cover_image_url     text not null default '',
  gallery             jsonb not null default '[]',   -- tour-platform imageUrls[]
  duration_minutes    int,
  meeting_point       text not null default '',
  meeting_point_map_url text not null default '',
  inclusions          jsonb not null default '[]',
  exclusions          jsonb not null default '[]',
  notices             jsonb not null default '[]',
  refund_rules        jsonb not null default '[]',
  safety_notice       text not null default '',
  good_for            jsonb not null default '[]',
  faq                 jsonb not null default '[]',   -- [{q,a}]
  social_proof_quotes jsonb not null default '[]',   -- [{author,rating,text,photos[]}]
  refund_policy_type  text not null default 'STANDARD'
    check (refund_policy_type in ('STANDARD','FLEXIBLE','STRICT')),
  status              trip_status not null default 'DRAFT',
  midao_listing       text not null default 'NONE'
    check (midao_listing in ('NONE','PENDING','LISTED','REJECTED')),
  midao_listing_note  text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (tenant_id, slug)
);

create table trip_plans (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  trip_id           uuid not null references trips(id) on delete cascade,
  slug              text not null default '',
  name              text not null,
  description       text not null default '',
  duration_minutes  int not null default 60,
  price_type        text not null default 'PER_PERSON'
    check (price_type in ('PER_PERSON','PER_GROUP')),
  base_price        numeric not null default 0,
  child_price       numeric,
  min_participants  int not null default 1,
  max_participants  int not null default 10,
  booking_type      text not null default 'SCHEDULED'
    check (booking_type in ('INSTANT','REQUEST','SCHEDULED')),
  -- 線上收款模式（10 分冊 §1：與 services 同一套選項，owner 要求保留定金機制）
  deposit_mode      text not null default 'FULL'
    check (deposit_mode in ('NONE','DEPOSIT_FIXED','DEPOSIT_PERCENT','FULL')),
  deposit_value     numeric not null default 0,
  active            boolean not null default true,
  year_round        boolean not null default true,
  -- 販售季節；Phase 8a 先以 jsonb 承載（10 分冊原規劃獨立表，
  -- 但方案季節只在方案編輯畫面整批讀寫，拆表沒有查詢上的好處）
  seasons           jsonb not null default '[]',
  review_state      text not null default 'NONE'
    check (review_state in ('NONE','PENDING','CHANGES_REQUESTED')),
  review_note       text not null default '',
  sort_order        int not null default 0,
  -- ↓ tour-platform 對齊欄位
  highlights        jsonb not null default '[]',
  plan_inclusions   jsonb not null default '[]',
  plan_exclusions   jsonb not null default '[]',
  plan_notices      jsonb not null default '[]',
  plan_refund_rules jsonb not null default '[]',
  plan_itinerary    jsonb not null default '[]',   -- [{icon,title,duration,description,imageUrl}]
  meeting_point_name    text not null default '',
  meeting_address       text not null default '',
  experience_point_name text not null default '',
  experience_address    text not null default '',
  language          text not null default '',
  earliest_departure date,
  confirm_by_days   int,
  free_cancel_days  int,
  details_link_text text not null default '',
  booking_btn_text  text not null default '',
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index trips_tenant_status_idx on trips (tenant_id, status);
create index trip_plans_trip_idx on trip_plans (trip_id, sort_order);

alter table trips enable row level security;
alter table trip_plans enable row level security;

create policy p_trips_s on trips for select using (is_tenant_member(tenant_id));
create policy p_trips_i on trips for insert with check (is_tenant_member(tenant_id));
create policy p_trips_u on trips for update using (is_tenant_member(tenant_id));
create policy p_trips_d on trips for delete using (is_tenant_member(tenant_id));

create policy p_trip_plans_s on trip_plans for select using (is_tenant_member(tenant_id));
create policy p_trip_plans_i on trip_plans for insert with check (is_tenant_member(tenant_id));
create policy p_trip_plans_u on trip_plans for update using (is_tenant_member(tenant_id));
create policy p_trip_plans_d on trip_plans for delete using (is_tenant_member(tenant_id));
