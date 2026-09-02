# Owner 裁示：免費本機雙 Terra 試行，付費 Supabase Branch 暫不考慮

> 日期：2026-09-02
>
> 狀態：Owner 已裁示，立即取代 Issue #104 原本的付費 Preview Branch 必經路線
>
> 適用 repo：`smallwei0301/vibeaico-admin-rebuild`

## 決策

目前採用：

```text
2 條完整 Terra 試行線
+ 每張候選 PR 各自使用免費本機 Supabase
+ 1 條既有遠端 TEST 作最終 canonical 驗收
+ 1 條 Sol Audit
+ 1 條 merge
```

付費 Supabase Preview Branch 降級為：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

目前不建立、不規劃日常使用、不要求 Owner 確認費率，也不得把它當成雙 Terra 的前置條件。
只有 Owner 日後重新明確裁示，才可恢復相關施工。

## 雙 Terra 試行拓撲

```text
TERRA_SLOT_1       max 1 complete delivery lane
TERRA_SLOT_2       max 1 complete delivery lane
LOCAL_ISOLATED     每張 Terra PR 各 1 套 disposable local Supabase
LUNA_CLOSURE       max 1 repo-wide closeout lane
REMOTE_CANONICAL   max 1 shared TEST holder
SOL_AUDIT          max 1
MERGE              max 1
ACTIVE_CANDIDATE   max 2
RESERVE_TERRA      pilot 期間停用
```

Reserve Terra 暫停，因為兩條完整 Terra 已經占滿程式施工容量；否則會從 2 條變成 2.5～3 條，重新堆出半成品。

## 啟用條件

第二條完整 Terra 只有在以下全部成立時才可啟動：

1. 兩張 PR 都設定 `DUAL_TERRA_PILOT=true`。
2. `TERRA_SLOT` 分別為 `1` 與 `2`。
3. 主要 Issue 不同。
4. `FILE_OWNERSHIP` 不重疊；熱檔、migration 編號與共用元件不得撞車。
5. 兩張都設定 `TEST_PROFILE=LOCAL_ISOLATED`。
6. 兩張都有不同 `TEST_ENV_ID`。
7. 兩張都設定 `FINAL_CANONICAL_REQUIRED=true`。
8. 兩張屬於同一個 `RUN_ID`，方便量化比較。
9. active candidate 總數仍不超過 2。

不符合任一項時，自動退回單 Terra。

## 出貨順序

兩條 Terra 可以同時完成 source、unit、typecheck、build、local integration 與 local E2E；但最終出口仍依序：

```text
LOCAL_ISOLATED_GREEN A ┐
                        ├→ closeability 排序
LOCAL_ISOLATED_GREEN B ┘
                            ↓
                  REMOTE_CANONICAL_TEST max 1
                            ↓
                       SOL_AUDIT max 1
                            ↓
                         MERGE max 1
```

第二張候選在等待最終遠端 TEST 時，不得靠 no-op commit、重跑舊 SHA 或搶占另一張的 TEST holder。

## DB／Auth／Storage

資料庫 migration、Auth（登入驗證）與 Storage（檔案儲存）仍先跑自己的本機 Supabase，再排現有遠端 TEST 最終驗收。

目前不再分類為 `REMOTE_BRANCH_REQUIRED`，而是：

```text
LOCAL_ISOLATED
FINAL_CANONICAL_REQUIRED=true
```

若未來出現「本機穩定通過，但既有遠端 TEST 因可證明的雲端差異長期無法診斷」，先建立問題證據；不得自行恢復付費分支。

## 試行觀察

試行至少記錄最近 3 個完整 Run：

```text
full_terra_peak
local_isolated_success / failure / cleanup
remote_canonical_wait_minutes
issues_closed / delivery_units / carryover
weighted_usage_per_delivery_unit
Sol touches per Issue
file_ownership_collision
cross_lane_contamination
post_merge_regression
```

這 3 輪是評估資料，不是啟用前等待期。雙 Terra 可立即試行；若品質下降、清理失敗、檔案撞車或 usage／成品惡化，下一輪自動退回 1 條。

## 不變安全線

- Production DDL／DML／migration／deploy 未另行授權，一律禁止。
- 真實付款、退款與顧客通知禁止。
- 本機測試不得讀 Production 或遠端 TEST secret。
- 遠端 TEST 仍只有一位 holder。
- 完成主張必須通過 Completion Truth Gate。
