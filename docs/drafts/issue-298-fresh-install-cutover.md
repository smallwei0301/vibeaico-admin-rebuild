# Issue #298：新安裝 baseline cutover 工程草案

> DRAFT — 本文件是可審查的施工草案，不是 canonical adoption、Owner Decision，也不宣稱 Issue #298 完成。觀察的 main exact head：`e893c25aafdcb2b5934d52e734ceab551fd14c47`。依 #197 已有的 source-only 授權整理；不執行遠端資料庫操作。

## 範圍與事實邊界

`supabase/local-migrations/historical-integration-baseline/manifest.json` 有 19 筆來源；其中 `0018_category_description_active_and_bug_report_fields.sql` 已標記 `retiredBy: 0079_reconcile_category_bug_report_fields.sql`，因此待處理清單為 **18 筆**。歷史 overlay 的成功 replay 不能視為核准的 canonical baseline，也不能把整個歷史檔案自動標為 active。

既有非空安裝的 migration ledger、資料、約束與例程保持不變，只走 reviewed canonical 的 forward upgrade。新安裝才可選用在 exact cutoff 固定的、已 hash 的 schema snapshot/manifest，接著套用 cutoff 後的 canonical tail；不得用歷史 overlay 偽造 provider migration ledger 的 applied rows。空資料庫與既有安裝必須是兩條明確路徑。

## 逐物件初步分類

| 歷史來源 | 主要物件／目前證據 | 新安裝方向（暫定） |
|---|---|---|
| `0015_tenants_business_type.sql` | `tenants.business_type`；現行 src 有讀取；觀察到 TEST/Production 皆為 `text NOT NULL DEFAULT 'LOCAL_SHOP'`，與 13-BUSINESS-MODES 的 stale enum/不存在的 `0014_business_modes` 描述不同 | `ACTIVE_RUNTIME` source gap；依現行三種業態的 text + validated CHECK 契約補 forward source，無須另選 enum |
| `0016_tour_domain_core.sql` | `trips`、`trip_plans`、`trip_status`；現行 tour routes/services；以 `0066`（及 `0067/0068`）定義為準 | 歷史 replay/compat；新安裝採 canonical `0066..` |
| `0017_chat_images_bucket_and_line_sort_order.sql` | `chat-images` bucket/ACL（`0008` 未建立，`0069` 僅在 ACL 清單保留它，沒有同名 bucket create）；三個 catalog 的 `line_sort_order`；canonical `0065`,`0075` | sort 欄位採 canonical；chat bucket 是否有可採用的 canonical counterpart 仍需證據，不可假設 `0069` 已建立 |
| `0018_category_description_active_and_bug_report_fields.sql` | category 欄位、`bug_reports.subject/contact_email`；現行 routes；`0079` 已收回 | 歷史 retired；新安裝只用 `0079` |
| `0019_bug_report_attachments.sql` | 私有 bucket/policy、`attachment_path`；現行 src 無附件路徑；欄位由 `0082` 重建、bucket 無 canonical source | `UNKNOWN`／需產品問題；不得盲目納入 |
| `0020_booking_addons.sql` | `booking_addons` 表；現行 src 零 table/route refs，`0082` 只補欄位；舊 staff attribution 與 C+ 契約衝突 | `COMPATIBILITY_ONLY`（`0082` 相容依賴）；另列 #17 `FUTURE_PRODUCT` 問題 |
| `0021_tenant_settings_branding.sql` | `tenant_settings.branding`；settings/shop-design routes；`0077` | 以 `0077` |
| `0022_page_local_display_fields.sql` | bookings/coupons/membership 欄位、`bookings_view`；現行頁面/routes；`0080`,`0082` | 以 canonical `0080`,`0082` |
| `0023_owner_notify.sql` | owner recipient/log tables；現行 src 零 refs；`0082` 只有 max-recipient 欄位 | `UNKNOWN`／`FUTURE_PRODUCT`，不因 docs 宣稱完成而納入 |
| `0024_welcome_card_images_bucket.sql` | welcome bucket/ACL；現行 upload/settings/storage；`0069`,`0072`,`0073` | 以 canonical ACL tail |
| `0025_rich_menu_designs.sql` | `rich_menu_designs`；UI/endpoints 存在但無 direct table token；無 canonical migration | `FUTURE_PRODUCT`／需產品問題 |
| `0026_tour_departures_addons_orders.sql` | departures/addons/orders、seat/order routines；現行 tour routes；`0066`,`0087` 及 `0088`,`0097..0101` 重建/收緊；`next_tour_order_no` 僅為 compat，現行 `0087` caller 提供 order_no | 逐物件採 canonical；不可把整檔標 active |
| `0027_block_times_weekly_and_product_order_coupon.sql` | block recurrence、product-order coupon；現行 routes；`0074`,`0081` | 以 canonical `0074`,`0081` |
| `0028_trip_import_atomic.sql` | `import_trips_atomic`；main 零 src calls、無 import route | `UNKNOWN`／`FUTURE_PRODUCT`；沒有 dependency proof 不得稱 compatibility |
| `0029_trip_tenant_parent_constraints.sql` | tour composite tenant/parent FKs；`0067` canonical integrity | 以 `0067` |
| `0030_trip_plan_global_limit.sql` | cap function/triggers、import RPC；無 direct src refs，但 triggers 隱式保護 plan writes | `UNKNOWN`；`100` cap contract 未解決，不得退休 |
| `0031_trip_plan_limit_lock_repair.sql` | cap lock repair function；無 canonical counterpart；語意被 `0032` 後續修補 | `UNKNOWN`；需保留 final-cap 語意，不能退休 |
| `0032_trip_plan_statement_guard.sql` | statement triggers/function；無 direct src refs，但對所有 plan INSERT/UPDATE 隱式生效 | `UNKNOWN`；不可因 zero refs 退休 |
| `0033_trip_duplicate_atomic.sql` | `duplicate_trip_atomic`；main 零 src calls、無 duplicate route | `UNKNOWN`／`FUTURE_PRODUCT`；沒有 dependency proof 不得稱 compatibility |

`next_tour_order_no` 是相容性依賴：目前 `0087` caller 提供 `order_no`，`0097` 只處理 ACL；`reserve_seats`/`release_seats` 由 `0087` 重定義並由 `0088` 收緊。例程是否同名不等於歷史 SQL 可整檔採用。

## 實作切片

1. 產生 cutoff manifest：固定 `origin/main` exact SHA、canonical migration bytes 的 SHA-256、排序後路徑、schema contract 版本；tail 僅是 chosen cutoff **之後**的 canonical migrations，不預設等同 `0066..0101`；review 時拒絕未列入或雜湊不符的來源。
2. 建立 fresh-install runner：只從 reviewed canonical baseline + canonical tail 建庫；歷史 overlay 僅作 compatibility fixture，絕不寫入假的歷史 applied rows。
3. 依 #197 已有授權逐物件完成相依與現行產品契約審查；工程 cutover 不重問已決方向。只有證據無法確定且會改變可觀察行為的語意才提出 Product 決定。既有安裝的 live constraints、columns、routines 或 storage objects 不因新安裝分類而刪除。
4. 為 `business_type`、`booking_addons`、plan-cap triggers 建立 source/contract diff；確認 `0032` 的隱式 100-plan cap 在新 baseline 的位置、名稱與語意。
5. 把 chosen cutoff 之後的 canonical migrations 作為唯一 tail 來源；不得以「18 檔 replay 綠」取代 semantic baseline review。

## 驗收閘門

- bare chain negative proof：無 overlay、無非 canonical來源、無手寫 applied rows 時，須預期明確失敗於缺 `booking_addons`（`0082` 只加欄位）及缺 `next_tour_order_no` 的獨立靜態檢查；只有在可重現來源補齊後才可宣稱 fresh baseline success。
- fresh approved baseline + tail 通過 migration identity/semantic diff，完整 integration、E2E、cleanup 全綠。
- upgrade compatibility：已有非空 schema 不 reset、不改歷史 ledger，forward upgrade 與既有資料/約束相容。
- 拒絕 non-empty target、unknown snapshot、tampered hash、錯誤 cutoff、重複 migration identity。
- 驗收明確拒絕「18 檔整檔自動 approval」；逐物件 diff 必須列出保留、排除與未決問題。
- 所有證據固定 exact head、manifest digest、測試命令與未驗證範圍；本草案不產生遠端 apply、Production DDL 或 canonical adoption 主張。

## 精確未決產品語意

歷史 `0032` 會在 plan INSERT/UPDATE（含批次操作）隱式限制每個 `(tenant_id, trip_id)` 最多 100 筆方案，並回報 `TRIP_PLAN_LIMIT`。目前現行產品文件與程式沒有足夠證據採納這個上限。新安裝保留、移除或改變此限制都會影響可觀察寫入行為，因此需要明確確認上限是否仍為產品規則；不能藉由 compatibility 分類默認採納。既有遠端 trigger 在裁示與具名操作授權前維持原狀。

`business_type` 的 forward source 修補不依賴此裁示。2026-09-12 唯讀 catalog 顯示 TEST/Production 都已有 validated `tenants_business_type_check`，允許 `LOCAL_SHOP`、`GUIDE`、`CLINIC`。另有註冊頁選擇值未傳入註冊 API/insert 的 runtime gap，應另案處理，本 schema 修補不得宣稱已修正 GUIDE 註冊。
