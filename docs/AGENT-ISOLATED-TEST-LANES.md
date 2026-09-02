# 隔離 TEST 路線操作手冊

> 最新決策：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
>
> 歷史基線：`docs/decisions/2026-09-01-owner-isolated-test-lanes.md`
>
> 追蹤：Issue #104

## 1. 現行架構

remote TEST 每輪會 reset／seed，共用同一個 Supabase 時，兩個 job 可能互相刪資料。因此前段改用
每張 PR 自己的免費本機 Supabase，最後仍只有一個遠端正式考場：

```text
Terra slot 1 → local runner / database 1 ┐
                                         ├→ remote canonical TEST max 1
Terra slot 2 → local runner / database 2 ┘
                                                    ↓
                                               Sol Audit max 1
                                                    ↓
                                                merge max 1
```

付費 Supabase Preview Branch 目前：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

不建立、不要求費率確認，也不是雙 Terra、Audit 或 merge 的前置條件。

## 2. TEST_PROFILE

| Profile | 用途 | 可以證明 | 不能證明 |
|---|---|---|---|
| `SOURCE_ONLY` | 文件、純 UI、純函式 | typecheck／unit／build | DB／Auth／Storage／E2E |
| `LOCAL_ISOLATED_CANARY` | 基礎設施 canary | 兩個 fresh local DB 可並行且各自清理 | 產品候選可 merge |
| `LOCAL_ISOLATED` | 一般 API、DB、Auth、Storage 候選 | local schema、seed、integration、E2E | 雲端差異與最終 canonical green |
| `SHARED_CANONICAL` | 現有遠端 TEST 最終驗收 | canonical TEST evidence | Production evidence |

`REMOTE_BRANCH_REQUIRED` 已退休。新的 active PR 使用它時，policy 必須 fail closed，並要求改成：

```text
TEST_PROFILE: LOCAL_ISOLATED
FINAL_CANONICAL_REQUIRED: true
```

## 3. 本機工作流程

檔案：`.github/workflows/local-isolated-test.yml`

```text
checkout exact head
→ 固定 Supabase CLI
→ npm ci
→ 唯一 local project id
→ stage local-only migration overlay（需要時）
→ supabase start
→ 匯出 local URL／anon／service-role
→ 驗證 URL 只能是 localhost／127.0.0.1
→ reset／seed
→ integration
→ Playwright E2E
→ always 執行 supabase stop --no-backup
```

不同 PR 的 concurrency group 不同，所以可平行；同一 PR 的新 SHA 取消舊 local run，避免 Docker
CI 風暴。fork PR 不自動花兩個 runner，必須用可信 manual dispatch（人工明確啟動）。

成功結果只能叫：

```text
ISOLATED_GREEN
LOCAL_CLEANUP_VERIFIED
```

不能叫 `CANONICAL_GREEN`。

## 4. Migration overlay 邊界

Local runner 可使用經 manifest 與 Git blob SHA 追溯的 local-only overlay。它只在 disposable runner
內暫時 stage，不修改正式 migration 帳本，也不推到 remote TEST。

- 必要表缺失必須 fail closed，不可改 seed 假裝 optional。
- 缺檔、額外 SQL、重複名稱、hash 不符、正式 migration 同名或未知 transform 都停止。
- local overlay 只證明現有測試可從空庫重建，不代表 remote migration history 已整理完成。
- local 與 remote schema 差異必須保存並交付。

## 5. DB／Auth／Storage 路由

以下路徑直接走免費路線：

```text
supabase/migrations/**  → LOCAL_ISOLATED → SHARED_CANONICAL
Auth／middleware        → LOCAL_ISOLATED → SHARED_CANONICAL
Storage／upload         → LOCAL_ISOLATED → SHARED_CANONICAL
```

本機與遠端不同時，以 remote canonical 作最終證據。先由 Luna 壓縮差異，只有模糊或高風險問題才
交 Sol；不得自動改用付費分支。

## 6. 免費雙 Terra

```text
FULL_TERRA_MAX             = 2 only when qualified
LOCAL_ISOLATED_SLOTS       = 2
REMOTE_CANONICAL_TEST_MAX  = 1
SOL_AUDIT_MAX              = 1
MERGE_MAX                  = 1
ACTIVE_PRODUCT_CANDIDATE   = 2
RESERVE_TERRA              = 0 during dual pilot
```

兩張 Terra PR 必須使用同一 `RUN_ID`，但有不同的：

```text
PRIMARY_ISSUE
TERRA_SLOT 1 / 2
TEST_ENV_ID
FILE_OWNERSHIP
EXACT_HEAD
```

WIP Guard 會重新檢查兩位 peer（同伴），並拒絕空、絕對路徑、`..`、模糊萬用字元，以及父子
ownership 路徑。第二條 Terra 是可選能力，不是必填名額。

## 7. 遠端最終考場

只有一張 PR 可持有 active `TEST_VALIDATION`：

```text
TEST_HOLDER_ISSUE
TEST_HOLDER_PR
EXACT_HEAD
MIGRATION_BASELINE
LOCAL_ISOLATED_RUN
EXPECTED_FULL_CI_COUNT
```

離開時記錄：

```text
WORKFLOW_RUN_ID
RESULT
FAILED_STEP / SUITE / CASE
ENVIRONMENT_CHANGED
RETRY_ALLOWED
RESIDUE_CHECK
```

同 exact head、同環境、同命令不盲目重跑。另一張候選等待時可修 source 或整理證據，但不得搶
remote TEST、Audit 或 merge。

## 8. Delivery Outcome v2 證據

每輪記錄：

```text
shipped_units
autonomous_outcome_units
wip_inventory
local_isolated_jobs / success / failure / cleanup
remote_canonical_wait_minutes
file_ownership_collision
cross_lane_contamination
weighted_usage_per_shipped_unit
weighted_usage_per_autonomous_outcome
Sol_touches
post_merge_regression
```

Audit Ready、CI-only、commit-only 與 carryover 只算在製品，不再湊成成品。`IN_PROGRESS` 不評分。
實際 token／週 usage 不可取得時填 `null`，不得猜。

## 9. 失敗處理

- local stack 起不來：保存錯誤，修根因後再試，不讀 remote secret 偷跑。
- overlay 不完整：修來源追溯，不把必要表改成 optional skip。
- local 與 remote 不同：remote canonical 為最終證據。
- cleanup 失敗：下一輪退回 `FULL_TERRA_MAX=1`。
- ownership 撞車：保留較接近 close 的 Terra，另一條 PARKED 或重新劃界。
- usage／真正出貨惡化超過 20% 且產出未增加：下一輪退回單 Terra並復盤。

## 10. 未來真的需要付費分支時

必須另開新的 Owner Decision、Issue、即時費率確認與完整 create／destroy 設計。舊 branch workflow、
舊 lease schema、舊 PR 或本文件的歷史段落都不構成付款或建立資源授權。
