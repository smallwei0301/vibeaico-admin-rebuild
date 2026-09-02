# 隔離 TEST 路線操作手冊

> 最新決策：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
>
> 追蹤：Issue #104

## 為什麼要隔離

remote TEST 每輪會 reset／seed，並使用固定 tenant、user、UUID 與測試帳號。兩個 job 若連到同一個 Supabase，其中一個 reset 可能刪掉另一個正在使用的資料。

現在採用：

```text
Terra slot 1 PR → local runner / database 1
Terra slot 2 PR → local runner / database 2
```

兩條 local job 使用不同 GitHub runner、Docker、volume、project id 與 `TEST_ENV_ID`，因此可以平行測試。最後仍依序進現有 remote TEST。

## TEST_PROFILE

| Profile | 用途 | 能證明 | 不能證明 |
|---|---|---|---|
| `SOURCE_ONLY` | 文件、純 UI、純函式 | typecheck／unit／build | DB／Auth／Storage／E2E |
| `LOCAL_ISOLATED_CANARY` | 基礎設施 canary | 兩個 fresh local DB 可並行且各自清理 | 完整產品測試、remote green |
| `LOCAL_ISOLATED` | 一般 API、DB、Auth、Storage 候選 | local schema、seed、integration、E2E | 雲端差異、最終 merge |
| `SHARED_CANONICAL` | 最終遠端 TEST | canonical TEST evidence | Production evidence |

`REMOTE_BRANCH_REQUIRED` 已退休。付費 Supabase Preview Branch 目前：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

Local profile 必須同時填：

```text
FINAL_CANONICAL_REQUIRED: true
TEST_ENV_ID: 唯一值
```

## Local workflow

檔案：`.github/workflows/local-isolated-test.yml`

```text
checkout exact head
→ 安裝固定 Supabase CLI
→ npm ci
→ 建立唯一 local project id
→ stage local-only migration overlay
→ supabase start
→ 匯出 local URL／anon／service-role
→ 驗證 URL 只能是 localhost／127.0.0.1
→ reset／seed
→ integration
→ Playwright E2E
→ always 執行 supabase stop --no-backup
```

不同 PR 的 concurrency group 不同，所以可同時執行；同一 PR 的新 SHA 會取消舊 run，避免 Docker CI 風暴。

成功結果只能叫：

```text
ISOLATED_GREEN
LOCAL_CLEANUP_VERIFIED
```

## Migration overlay 邊界

Local runner 可使用：

```text
supabase/local-migrations/historical-integration-baseline/
supabase/local-migrations/issue-41-candidate-baseline/
```

只在 `TEST_PROFILE=LOCAL_ISOLATED` 且 `ALLOW_LOCAL_MIGRATION_OVERLAY=true` 的一次性 runner 裡暫時 stage。來源 SQL 需有 Git blob SHA；缺檔、額外 SQL、重複名稱、hash 不符、正式 migration 同名或未知 transform 都 fail closed（不確定就停止）。

Local overlay 只證明目前測試可從空庫重建，不代表 remote migration history 已整理完成。

## 免費雙 Terra

```text
FULL_TERRA_MAX = 2
LOCAL_ISOLATED_SLOTS = 2
REMOTE_CANONICAL_TEST_MAX = 1
SOL_AUDIT_MAX = 1
MERGE_MAX = 1
ACTIVE_CANDIDATE_MAX = 2
RESERVE_TERRA_MAX = 0 during pilot
```

兩張 Terra PR 必須使用同一 `RUN_ID`，但有不同的：

```text
PRIMARY_ISSUE
TERRA_SLOT
TEST_ENV_ID
FILE_OWNERSHIP
EXACT_HEAD
```

WIP Guard 會檢查 ownership 路徑不可相同，也不可互為父子。

## DB／Auth／Storage

以下變更不再等待付費 Branch：

```text
supabase/migrations/**
Auth／middleware
Storage／upload
```

它們走：

```text
LOCAL_ISOLATED
→ SHARED_CANONICAL
```

本機與遠端不同時，以 remote canonical 為最終證據；保存差異並交 Luna 壓縮，必要時才由 Sol 判案。

## 付費 Preview Branch

目前規則：

- 不建立 branch；
- 不要求 Owner 確認費率；
- 不執行舊 branch plan workflow；
- 不把付費分支當成雙 Terra 或 merge 的前置條件；
- 舊 PR／報告只保留歷史，active workflow、script、schema 與 test 從 main 移除。

未來只有新的 Owner Decision 才能恢復，不得直接復活舊流程。

## 量化證據

每輪至少記錄：

```text
local_isolated_jobs / success / failure / cleanup
slot_1/2_active_minutes
isolated_test_wait_minutes
canonical_test_wait_minutes
cross_lane_contamination
file_ownership_collision
full_terra_peak
issues_closed / delivery_units / carryover
weighted_usage_per_delivery_unit
Sol_touches_per_issue
post_merge_regression
```

付費 branch 欄位若為歷史相容而保留，值固定為 `0`／`NOT_CONSIDERED`，不得再當 Owner blocker。

## 失敗處理

- local stack 起不來：保存錯誤，修根因後再試，不改用 remote secret 偷跑；
- overlay 不完整：修來源追溯，不把必要表改成 optional skip；
- local 與 remote 不同：remote canonical 為最終證據；
- cleanup 失敗：下一輪退回 `FULL_TERRA_MAX=1`；
- ownership 撞車：保留較接近 close 的 Terra，另一條 PARKED 或重新劃界；
- usage／Delivery Unit 惡化超過 20% 且出貨未增加：下一輪退回單 Terra並復盤。
