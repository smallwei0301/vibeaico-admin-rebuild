# Phase 1B migration ledger map

> Issue：#104
>
> 狀態：候選施工中
>
> 目的：讓 disposable local Supabase（一次性本機測試資料庫）能從空庫重建到可執行標準 seed、integration 與 E2E，同時避免污染遠端 TEST 的 migration history。

## 1. 查到的三本帳

### `main` 的正式 migration 目錄

目前 `main:supabase/migrations` 只包含：

```text
0001 ～ 0014
```

### 歷史整合分支

`claude/deploy-vercel-project-nnno59` 在 head
`7ad9ac53df1f7f4971a2ec96c4038587e0515b66` 保留：

```text
0015_tenants_business_type.sql
0016_tour_domain_core.sql
...
0033_trip_duplicate_atomic.sql
```

其中 `0016_tour_domain_core.sql` 建立目前標準 seed 明確需要的 `trips` 與 `trip_plans`，且使用
`base_price`；`0026_tour_departures_addons_orders.sql` 建立 `trip_departures`、`trip_addons`、
`tour_orders` 與基礎 RPC。

### 遠端 TEST migration history

TEST project `nmwhwngojosmagjuvxol` 的已套用名稱／版本已走出另一條歷史，包含候選 Issue
migration；它和歷史整合分支的 `0015～0033` 編號並非同一套一對一帳本。

## 2. 決策

**不把歷史 `0015～0033` 直接加入正式 `supabase/migrations`。**

原因：這可能讓未來遠端 migration 工具遇到同編號不同內容，像兩張發票都寫「第 16 號」，
但商品完全不同。

Phase 1B 改採：

```text
supabase/local-migrations/historical-integration-baseline/
```

它只在 `TEST_PROFILE=LOCAL_ISOLATED` 且
`ALLOW_LOCAL_MIGRATION_OVERLAY=true` 的 disposable runner 內，暫時複製到 runner 的
`supabase/migrations` 後再 `supabase start`。repo 的正式 migration 目錄本身不被覆寫。

## 3. 完整性護欄

`manifest.json` 對每支 SQL 保存原始 Git blob SHA。stage script 必須：

1. 僅接受 `LOCAL_ONLY_TRANSITIONAL` manifest；
2. 僅允許 `TEST_PROFILE=LOCAL_ISOLATED`；
3. 要求明確 `ALLOW_LOCAL_MIGRATION_OVERLAY=true`；
4. 重新計算每支檔案的 Git blob SHA；
5. 發現缺檔、額外 SQL、重複檔名或 hash 不符即停止；
6. 若正式 `supabase/migrations` 已有同名檔，拒絕覆蓋；
7. 在 Actions summary 記錄來源 branch、head、數量與範圍。

## 4. 這份補充包能證明什麼？

若完整 local suite 成功，只能證明：

```text
歷史整合基線 + current PR source
可在 fresh local Supabase 執行標準 seed、integration、E2E
```

它不能證明：

```text
遠端 TEST migration history 已被正式整理
Production migration 可直接套用
local green 等於 canonical green
```

因此最終 runtime PR 仍需 `SHARED_CANONICAL` 遠端 TEST、Sol Audit 與 Completion Truth Gate。

## 5. Phase 1B 驗收

- [ ] manifest 內 19 支 SQL 全部通過 blob integrity 檢查
- [ ] stage script 不會改寫正式 migration 原始檔
- [ ] fresh local PostgreSQL 17 能套用 0001～0014 + local overlay
- [ ] standard reset／seed 成功
- [ ] full integration 成功
- [ ] full Playwright E2E 成功
- [ ] cleanup 顯示 `LOCAL_CLEANUP_VERIFIED`
- [ ] Actions summary 明確標記 `ISOLATED_GREEN`，沒有冒充 canonical green
- [ ] 遠端 TEST 完全未使用或修改
- [ ] 若後續仍缺 schema，新增缺口報告，不讓 seed 靜默略過必要父表

## 6. 下一個治理問題

Phase 1B 成功後，仍要另開 migration-ledger reconciliation（帳本整理）工作，把正式
`main`、歷史整合分支與遠端 TEST 已套用 migration 對齊。那是資料庫治理工作，不應偷偷
藏在本機測試 PR 裡。
