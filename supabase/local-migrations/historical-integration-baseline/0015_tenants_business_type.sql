-- 0015：tenants 加 business_type（業態模式）
--
-- 背景：13 分冊的業態模式（LOCAL_SHOP / GUIDE / CLINIC）在 mock 前台早已實作，
-- 註冊頁也讓店家三選一，但 02 分冊的 tenants 表從來沒有對應欄位——
-- 先前 my-tenants route 的註解已記錄「要等 migration 0014 才會加」，實際 0014
-- 被 customers_view 重建用掉，此欄位一直沒落地。結果是：真實註冊的店家不論選
-- 哪一種業態，登入後一律拿到 LOCAL_SHOP 的選單與名詞（TenantSummary.businessType
-- 拿不到值、mapTenantSummary 回 undefined、前端 fallback 成 LOCAL_SHOP）。
--
-- 不用 enum 而用 text + check：BUSINESS_TYPES 定義在 src/config/modes.ts，
-- 未來若新增業態，改 text check 比 alter type add value 好維護（後者在交易中
-- 有限制），且此欄位不參與 join/索引效能考量。
alter table tenants
  add column if not exists business_type text not null default 'LOCAL_SHOP'
    check (business_type in ('LOCAL_SHOP', 'GUIDE', 'CLINIC'));
