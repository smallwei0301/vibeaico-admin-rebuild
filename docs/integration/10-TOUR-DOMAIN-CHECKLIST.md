# Phase 8c.5 — 團次導遊指派與撞班防護：施工／驗收清單

> Canonical 規格：`docs/integration/10-TOUR-DOMAIN.md` 的團次人員、雙向撞班與加購業績章節。
> Owner Decision：`docs/decisions/2026-08-27-tour-guide-assignment.md`。
> 原則：先測試（紅）→ 實作（綠）→ 回歸；不得用前端隱藏選項取代後端衝突檢查。

## A. 規格與型別

- [ ] `src/lib/types.ts`：`TripDeparture` 增加主／協同導遊欄位（只新增 optional 相容欄位）
- [ ] 新增 `DepartureStaffRole`／團次指派型別
- [ ] 新增 `TourOrderAddon`／`AddonPerformanceMode`
- [ ] `docs/integration/04-API-CONTRACTS.md` 回併團次人員／availability／order addon 契約

## B. Source-only migration

- [ ] 新 migration 新增 `trip_departure_staff`
- [ ] 每團最多一位 PRIMARY 的 partial unique index
- [ ] 同團同人不可重複指派
- [ ] RLS 四條 policy
- [ ] 新增 `tour_order_addons`，金額不可負數、數量 >= 1
- [ ] 加購業績模式 `PRIMARY / SPECIFIC_STAFF / NONE`
- [ ] 正式資料庫套用前停在 Owner gate，不自行執行 Production DDL

## C. 共用人員可用性引擎

- [ ] 新增／抽出 `src/server/staff-availability.ts`
- [ ] 同一引擎讀 `shifts`
- [ ] 同一引擎讀 `bookings(PENDING/CONFIRMED)`
- [ ] 同一引擎讀 `block_times`
- [ ] 同一引擎讀 `trip_departure_staff + trip_departures + trip_plans.duration_minutes`
- [ ] `CANCELLED` 團次不占用
- [ ] 無 `start_time` 團次視為整日占用
- [ ] PRIMARY 與 ASSISTANT 都占用時間

## D. 團次 API

- [ ] 單筆 create 接受 `primaryStaffId` + `assistantStaffIds[]`
- [ ] 單筆 update 可改派人員，並原子更新 assignment
- [ ] OPEN 新團完成後必須有 PRIMARY；既有舊團可誠實維持未指派
- [ ] 後端檢查 staff 屬同租戶、active、bookable
- [ ] 時段衝突回 409 並帶可理解的衝突原因／時間
- [ ] 衝突時不得留下半筆團次或半筆 assignment
- [ ] batch create 接受主／協同導遊
- [ ] batch 按日期檢查，衝突日跳過並回 `conflicts[]`
- [ ] 不得把衝突日建立成未指派團次

## E. 團次 UI

- [ ] 團次 Modal 加「主導遊」必填欄
- [ ] 團次 Modal 加「協同導遊」複選欄
- [ ] 選方案／日期／時間後顯示人員可用狀態
- [ ] 忙碌人員顯示衝突原因，不只消失
- [ ] batch UI 可指定主／協同導遊
- [ ] batch 結果顯示 created / skipped / conflicts 真實數字
- [ ] 既有未指派團次顯示「未指派」，不得假造人員

## F. 一般預約反向防撞

- [ ] `/api/bookings/available-slots` 排除該員工重疊團次
- [ ] 多人團次中所有被指派人員都會被排除
- [ ] 團次取消後可重新出現在一般服務空檔
- [ ] 團次改派後，原導遊釋放、新導遊被占用

## G. 行事曆／ICS

- [ ] `GET /api/calendar` 的 DEPARTURE 帶主／協同導遊資訊
- [ ] calendar 團次詳情顯示人員
- [ ] ICS 團次 DESCRIPTION 含主導遊，協同導遊存在則一併列出
- [ ] 人員改派後 calendar／ICS 反映最新值

## H. 加購與業績 C+

- [ ] 一般 `booking_addons`：指定 staff → 算該 staff
- [ ] 一般 `booking_addons`：未指定 → 繼承 booking staff
- [ ] 一般 `booking_addons` 補可明確表示「不計個人業績」的資料語意／UI
- [ ] 更正 0020 migration 檔頭「staff_id 不參與業績」的舊裁示註解
- [ ] 行程 `trip_addons` 保持目錄語意
- [ ] 訂單選購時建立 `tour_order_addons` 快照
- [ ] 預設 `PRIMARY`
- [ ] 可 `SPECIFIC_STAFF`
- [ ] 可 `NONE`
- [ ] 訂單 COMPLETED 時凍結 performance_staff_id / performance_amount
- [ ] 0 元允許、負數拒絕
- [ ] 個人業績報表只算有歸戶且完成的業績；NONE 只進店家營收

## I. 必測案例

- [ ] 一般預約撞團次 → 團次建立 409 且零半成品資料
- [ ] 團次撞一般預約 → available-slots 不回該人
- [ ] 團次撞團次 → 409
- [ ] CANCELLED 團次釋放
- [ ] ASSISTANT 也會撞班
- [ ] 無時間團次整日占用
- [ ] batch 部分衝突只建立可用日期並列出 conflicts
- [ ] 跨租戶 staff/departure 被拒
- [ ] PRIMARY／SPECIFIC_STAFF／NONE 三種加購業績各自正確
- [ ] 0 元／負數邊界
- [ ] typecheck / build / unit / integration / e2e 全綠

## J. Definition of Done

- [ ] 上述項目全數有證據
- [ ] 04／08／12／14 相關章節已回併並附 commit hash
- [ ] #10 的 `available-slots` 驗收採「依實際團次導遊指派排除」，不以全店團次粗略封鎖
- [ ] #17 的 C+ 業績裁示已落實，不再沿用舊的「全部算主服務人員」
- [ ] Production migration / deploy 維持 Owner 明確授權門檻
