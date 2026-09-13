# #298：團次指派的同租戶關聯收斂

狀態：SOURCE_CANDIDATE；尚未合併、尚未套用遠端資料庫。
本輪來源基準：`e893c25aafdcb2b5934d52e734ceab551fd14c47`。
Owner 指令：繼續資料庫一致化工程。
WORKSTREAM: PRODUCT_MAINLINE

## 本次只修一個已確認的差距

產品契約 `docs/integration/10-TOUR-DOMAIN.md` §1.3／§5.4 要求人員、團次、
預約皆同租戶，跨租戶 ID 一律拒絕。`src/server/departure-staff.ts` 已在應用層
檢查同租戶；資料庫補上相同保護，不新增指派規則、也不改付款／成團功能。

依 `docs/decisions/2026-09-10-schema-canonical-source.md`，此差異是
`ACTIVE_RUNTIME` 的防禦差距，而非因 TEST 有某物件就自動把它定為標準。

## 本輪唯讀觀察

查詢均包在 READ ONLY transaction，未修改資料或結構。

| 環境 | 專案 | 觀察時間 UTC | 指派關聯 |
|---|---|---|---|
| TEST | `nmwhwngojosmagjuvxol` | 2026-09-12 01:10:42 | `(tenant_id, staff_id)` 與 `(tenant_id, departure_id)` |
| Production | `egehnijjpgijmccagxac` | 2026-09-12 01:10:26 | 單獨 `staff_id` 與 `departure_id` |

TEST 的 staff 已有 `(tenant_id,id)` 唯一約束；Production 沒有。
兩邊的 trip_departures 都已有 `(tenant_id,id)` 唯一約束。
兩邊均要求刪除仍有指派的 staff 時拒絕（RESTRICT），刪除團次時刪除其指派（CASCADE）。
不能為了表面一致，刪掉 TEST 較嚴格的保護。

## 正向更新檔

`supabase/migrations/0102_assignment_tenant_parent_keys.sql`

- 不修改 `0092` 或任何歷史 migration；單一 DO statement 包住整段操作。
- 同時鎖定父／子表，鎖等待上限五秒；先檢查既有資料，不刪除或改配錯誤列。
- 兩個父關聯必須先完整通過形狀檢查，才開始結構修改。
- 已有正確複合外鍵時保留；未驗證的正確外鍵先驗證。
- 缺少父表 `(tenant_id,id)` 唯一約束時才建立。
- 新複合外鍵驗證成功，才移除已查明的舊單欄外鍵。
- 同名異義、重複關聯、不同刪除規則或跨租戶既有資料，一律失敗，不偷偷修資料。
- 不保留兩條同父表關聯，避免既有 `staff(name)` 關聯查詢產生歧義。
- 不變更 RLS、授權、訂單、通知；結尾重新核對兩個關聯並要求重載 API 結構快取。

## 驗證契約

本機 Node 安全鎖測試只證明 runner 的拒絕規則，**不是 SQL 已成功執行**。
真正 SQL 驗證由現有 `agent-schema-bootstrap` 在一次性本機 Supabase 執行：

1. 從 exact head 重播資料庫，明確不包含 #41 候選內容。
2. 建立標準測試資料後，執行 `scripts/test/verify-assignment-schema.mjs`。
3. 九個案例：乾淨結構、TEST 形狀重跑、Production 形狀升級、混合形狀、
   既有錯配資料、錯誤刪除規則、重複關聯、同名錯誤唯一鍵，以及弱關聯反例對照。
4. 正常同店指派可寫；跨店人員／團次、搬移租戶、刪除仍有指派的人員必須被拒絕；
   刪除團次則依原規則清理指派。每個案例都 ROLLBACK 並比對前後指紋。
5. 零列 HTTP 查詢仍須成功解析 `staff(name),trip_departures(id)`。
6. 繼續跑原有完整產品整合與 UI/E2E；不修改或降低原有斷言。
7. 保存僅含來源指紋／案例結果的證據，清除一次性資料庫。

一般 local-isolated lane 仍依既有政策執行；它包含相容 overlay，不取代乾淨建庫證據。
共用 TEST 最終驗證與 Product 高風險獨立審查仍是後續合併關卡，不能拿本機綠灯代替。

## 遠端操作邊界

本次沒有套用 TEST 或 Production。未來每次套用前必須重新核對專案、main source
雜湊、關聯／權限現況、錯配列數，以及是否有其他測試占用。
Production 必須取得只涵蓋本檔與本專案的具名授權；鎖定可能短暫阻擋寫入，需選擇
合適操作時段。失敗會由單一 statement 回復；成功後不得為回復而自動降級 tenant
保護，應先停止後續操作，重新評估有界修正並取得授權。

## #298 不因此全部結案

本切片只解決指派外鍵的源碼差距。18 支歷史建庫依賴的逐項分類、正式基準採納與
移除隱性 overlay 依賴仍未完成。`HISTORICAL_COMPATIBILITY_CANDIDATE` 不會被改名
冒充完整 canonical baseline。#362 維持已完成，不重開、不重做。

本輪同時唯讀確認 Production 仍無 `expire_tour_order(uuid,uuid,text)`，TEST 有；
既有 `0100` 套用是另一項具名 Production 操作，不夾帶於本檔。
