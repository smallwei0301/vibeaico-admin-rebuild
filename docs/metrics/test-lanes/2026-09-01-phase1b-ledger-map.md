# Phase 1B migration ledger map

> Issue：#104
>
> 狀態：候選施工中
>
> 目的：讓 disposable local Supabase（一次性本機測試資料庫）能從空庫重建到可執行標準 seed、integration 與 E2E，同時避免污染遠端 TEST 的 migration history。

## 1. 查到的資料庫帳本

### `main` 的正式 migration 目錄

目前 `main:supabase/migrations` 只包含：

```text
0001 ～ 0014
```

### 歷史整合分支

`claude/deploy-vercel-project-nnno59` 在 head
`7ad9ac53df1f7f4971a2ec96c4038587e0515b66` 保留 0015～0033。其中 0016 建立標準 seed 需要的
`trips` 與 `trip_plans`；0026 建立 `trip_departures`、`trip_addons`、`tour_orders` 與基礎 RPC。

### Issue #41 候選分支

第一輪完整本機重建已能套到 0033，但標準 seed 在 `trip_plans.min_to_depart` 停止。該欄位與
團次 snapshot 由 PR #73 的候選 migration 提供：

```text
0038_notification_outbox_delivery.sql
0038a_restrict_internal_notification_functions.sql
0040_issue_41_group_formation_lifecycle.sql
```

來源固定為：

```text
branch: agent/issue-41-epoch-current-main
head: b583a08b0542ec33d81a587d844df2605ef6f8d6
PR: #73
status: CANDIDATE_SOURCE_NOT_CANONICAL
```

0040 明確依賴 0038／0038a，因此三支一起作為最小候選補充包。因 `0038a` 不是本機 Supabase
CLI 的純數字 migration 名稱，本機 staging 在通過原始 Git blob 指紋後，暫時改名為：

```text
0039_restrict_internal_notification_functions_local.sql
```

SQL 內容不變，只有 disposable runner 內的排序檔名不同。

### 遠端 TEST migration history

TEST project `nmwhwngojosmagjuvxol` 的已套用名稱與版本另有歷史，包含多張尚未合併的 Issue
候選。它和上述兩組檔案不是一對一的正式帳本。

## 2. 決策

**不把歷史 0015～0033 或 PR #73 候選直接加入正式 `supabase/migrations`。**

Phase 1B 使用兩個有順序的 local-only overlay：

```text
1. supabase/local-migrations/historical-integration-baseline/
2. supabase/local-migrations/issue-41-candidate-baseline/
```

它們只在 `TEST_PROFILE=LOCAL_ISOLATED` 且 `ALLOW_LOCAL_MIGRATION_OVERLAY=true` 的 disposable
runner 內，暫時複製到 runner 的 `supabase/migrations` 後再 `supabase start`。Git 裡的正式
migration 目錄與遠端 TEST 不會被改寫。

## 3. 完整性護欄

每個 manifest 都保存來源 repository、branch、exact head 與每支 SQL 的原始 Git blob SHA。
Stage script 必須：

1. 僅接受 `LOCAL_ONLY_TRANSITIONAL` manifest。
2. 僅允許 `TEST_PROFILE=LOCAL_ISOLATED`。
3. 要求明確 `ALLOW_LOCAL_MIGRATION_OVERLAY=true`。
4. 重新計算每支檔案的 Git blob SHA。
5. 發現缺檔、額外 SQL、重複 target、hash 不符或未知 transform 即停止。
6. 若正式 `supabase/migrations` 已有同名檔，拒絕覆蓋。
7. 跨 manifest 的 target 名稱不可重複。
8. Candidate source 必須在 Actions summary 明示 `CANDIDATE_SOURCE_NOT_CANONICAL`。
9. 只允許白名單 local transform；原始 SQL 與 blob 指紋保持不變。

## 4. 目前已證明與尚未證明

已證明：

```text
0015～0033 原始檔指紋可驗證
fresh local PostgreSQL 17 可套用到 0033
0031／0032 的 local-only transaction 外框有效
每次失敗後 local cleanup 仍成功
```

尚未證明：

```text
0038／0038a／0040 可順利接在 0033 後
標準 reset／seed 全綠
full integration 全綠
Playwright E2E 全綠
遠端 migration ledger 已整理
```

本機綠燈只能叫 `ISOLATED_GREEN`，不能叫 `CANONICAL_GREEN`。任何 runtime PR 最終仍需
`SHARED_CANONICAL` 遠端 TEST、Sol Audit 與 Completion Truth Gate。

## 5. Phase 1B 驗收

- [x] 歷史 0015～0033 共 19 支 SQL 通過 blob integrity 檢查
- [x] stage script 不改寫正式 migration 原始檔
- [x] fresh local PostgreSQL 17 可套用 0001～0014 + 歷史 overlay 到 0033
- [x] 0031／0032 transaction 缺口以 local-only 白名單 transform 修復
- [ ] PR #73 最小候選 overlay 通過來源指紋與跨 manifest 重複檢查
- [ ] standard reset／seed 成功
- [ ] full integration 成功
- [ ] full Playwright E2E 成功
- [ ] cleanup 顯示 `LOCAL_CLEANUP_VERIFIED`
- [ ] Actions summary 明確標記 `ISOLATED_GREEN`
- [ ] 遠端 TEST 完全未使用或修改
- [ ] 若仍缺 schema，新增精確缺口，不讓 seed 靜默忽略必要父表

## 6. 後續治理

Phase 1B 成功後，仍要另做 migration-ledger reconciliation（帳本整理），把正式 `main`、
歷史整合分支、各 Issue 候選與遠端 TEST 已套用 migration 對齊。這是資料庫治理工作，不會
偷偷藏在本機測試 PR 裡。
