-- 0009: tenant_settings 補 INSERT policy（02 分冊 §0003 的規格缺陷，整合測試實跑抓到）
-- 編號用 0009（0008 與 0010 之間的空號）：0011 這個號碼 08 分冊 Phase 5.5
-- 已保留給功能商店 migration，不可佔用。本檔已於 2026-08-22 套用到
-- TEST（nmwhwngojosmagjuvxol）與 PROD（egehnijjpgijmccagxac）兩個專案。
--
-- 0003 只建了 p_ts_r（select）與 p_ts_w（update）。但 API 端（04 §A-1 的
-- PUT /api/settings、PUT /api/settings/line）用 supabase-js 的 upsert() 寫入：
-- upsert 走 INSERT ... ON CONFLICT DO UPDATE，PostgreSQL 對這種語句**先套用
-- INSERT 的 with check policy**（即使該列已存在、實際會走 UPDATE 分支）。
-- 沒有 INSERT policy = 一律拒絕（42501）→ API 500。
--
-- 語意上 MANAGER 以上本來就該能初始化自己店的設定列（0003 的「老店（列不
-- 存在）」情境），所以補上與 p_ts_w 同權限的 INSERT policy 是正確修法，
-- 而不是把 API 改走 service role（那會繞過 RLS 的租戶隔離保證）。
create policy p_ts_i on tenant_settings
  for insert with check (tenant_role_at_least(tenant_id, 'MANAGER'));
