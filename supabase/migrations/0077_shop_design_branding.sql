-- 0077 — Issue #7：/tenant/shop-design 儲存目前送空物件，PUT /api/settings 因此
-- 整段跳過寫入（`if (Object.keys(update).length)`），店家按下「儲存」看到成功但
-- 資料庫一個位元都沒寫。Owner 裁示（2026-09-04）：新開一組語意乾淨的 `branding`，
-- 不要塞進既有的 `business`。
--
-- 冪等：`add column if not exists`，可在已有此欄位的環境重複套用而不出錯
-- （本專案已發生過兩次 schema drift，見 docs/AGENT-PLAYBOOK.md）。
--
-- 已確認 tenant_settings 沒有任何 view 依賴（grep -rn "tenant_settings"
-- supabase/migrations/ 全部是 table/policy/trigger，不是 view），所以本次
-- 不需要處理 view 重建。
alter table public.tenant_settings
  add column if not exists branding jsonb not null default '{}';
-- 結構：見 src/config/tenant-settings.ts 的 brandingSettingsSchema
-- { shopName, logoUrl, logoHidden, bannerUrl, bannerVideoUrl, bannerVideoSound,
--   announcement, aboutTitle, aboutContent, aboutImageUrl,
--   gallery: [{id, url, caption}], themeColor,
--   facebook, instagram, line, threads, googleMaps, contactEmail }
