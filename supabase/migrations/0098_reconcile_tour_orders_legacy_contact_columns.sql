-- #197 對帳：把 0087 在正式庫的前置對齊補進帳本。
--
-- 2026-09-11 套用 0087 到正式庫 egehnijjpgijmccagxac 之前，必須先跑這一段；
-- 當時是直接對線上下的，沒有對應的 migration 檔案。本檔把它補回帳本，讓
-- 「從本帳本重建資料庫、再套 0087」與正式庫的實際歷程一致。
--
-- 問題：正式庫的 public.tour_orders 帶著兩個本帳本從未提及的欄位——
-- customer_name / customer_phone，且兩者都是 NOT NULL 且無 default。
-- 這是 #197 記錄的那種 drift（線上有、repo migrations 沒有）。
--
-- 為什麼會擋住 0087：main 的 0087 把聯絡資訊放在 canonical 的 contact jsonb，
-- 其 create_tour_order() 的 insert 欄位清單不含這兩欄。實查 pg_trigger 確認
-- 正式庫的 tour_orders 上**沒有任何 trigger**（共用 TEST 上有 6 支 #41 overlay
-- trigger，正式庫一支都沒有），所以沒有任何東西會在 insert 前補上它們——
-- 第一筆建單必然 23502。
--
-- ⚠️ 這個判斷是查過 trigger 之後才下的，不是從欄位定義推斷的（PB-035：
-- BEFORE INSERT trigger 在 NOT NULL 檢查之前執行，光看欄位定義會得到相反的結論）。
--
-- 刻意**不 drop 這兩欄**：drop column 不可逆，而它們該不該留屬於 #197／#298 的
-- schema 對帳範圍，需要各自的決策。本檔只做可逆的最小處置——放寬 NOT NULL 並給
-- 空字串 default，讓 canonical 的 0087 能正常寫入，既有資料語意零變動。
--
--
-- ⚠️ 帳本順序 vs. 正式庫歷程：在正式庫上，本段是在 0087 **之前**跑的（否則 0087
-- 建不起來）。但補進帳本時只能排在末尾，也就是 0087 之後。這不會造成矛盾，因為
-- 從乾淨帳本重建出來的資料庫，其 tour_orders 由 0087 建立、本來就沒有這兩個
-- drift 欄位——本檔對它是 no-op。本檔的存在意義是讓帳本能重現**正式庫的實際狀態**，
-- 不是重現套用的先後順序。
-- 可重入：欄位不存在時（例如從乾淨帳本重建的資料庫，它本來就沒有這兩欄）整段跳過。

do $$
begin
  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tour_orders' and column_name = 'customer_name'
  ) then
    alter table public.tour_orders alter column customer_name drop not null;
    alter table public.tour_orders alter column customer_name set default '';
  end if;

  if exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'tour_orders' and column_name = 'customer_phone'
  ) then
    alter table public.tour_orders alter column customer_phone drop not null;
    alter table public.tour_orders alter column customer_phone set default '';
  end if;
end $$;

do $$
declare
  v_bad text;
begin
  -- 只要欄位存在，就不得是 NOT NULL，且必須有空字串 default
  select string_agg(column_name, ', ')
    into v_bad
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'tour_orders'
     and column_name in ('customer_name', 'customer_phone')
     and (is_nullable = 'NO' or column_default is distinct from '''''::text');
  if v_bad is not null then
    raise exception '對齊失敗：% 仍為 NOT NULL 或缺少空字串 default（0087 的 insert 會 23502）', v_bad;
  end if;

  -- 反向：本檔只放寬約束，不得移除欄位
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'tour_orders'
         and column_name in ('customer_name', 'customer_phone')) not in (0, 2) then
    raise exception '對齊失敗：customer_name / customer_phone 應同時存在或同時不存在';
  end if;
end $$;
