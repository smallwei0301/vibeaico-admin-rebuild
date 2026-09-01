# 隔離 TEST 路線操作手冊

> Canonical decision：`docs/decisions/2026-09-01-owner-isolated-test-lanes.md`
>
> 追蹤：Issue #104

## 1. 為什麼需要隔離

目前 remote TEST 在每輪 integration 前會 reset／seed，並使用固定 tenant、user、UUID 與
測試帳號。兩個 job 若連到同一個 Supabase，其中一個 reset 會刪掉另一個正在使用的資料。
因此「把 GitHub parallel 設成 2」不等於真的有兩條安全 TEST 線。

隔離 TEST 分兩步落地：

```text
Phase 1A  先證明兩個 local runner／database／cleanup 彼此獨立
Phase 1B  再補齊 fresh-local schema source，跑完整 local integration／E2E
```

## 2. TEST_PROFILE

| Profile | 用途 | 可以證明 | 不能證明 |
|---|---|---|---|
| `SOURCE_ONLY` | 文件、純 UI、純函式或 source checks | typecheck／unit／build | DB／Auth／Storage／E2E |
| `LOCAL_ISOLATED_CANARY` | 測試基礎設施 | 兩個 fresh local DB 可平行且各自清理 | 完整產品測試、遠端 canonical green |
| `LOCAL_ISOLATED` | 一般 PR 的 disposable local DB | local schema、seed、integration、E2E | 遠端 schema cache、雲端供應商差異、最終 merge |
| `REMOTE_BRANCH_REQUIRED` | DB／Auth／Storage 重型候選 | Phase 2 需要遠端分支 | branch 已建立或已付費 |
| `SHARED_CANONICAL` | 最終遠端 TEST 驗收 | canonical TEST evidence | Production evidence |

Local profiles 必須同時填：

```text
FINAL_CANONICAL_REQUIRED: true
TEST_ENV_ID: AUTO
```

## 3. Phase 1A workflow

檔案：`.github/workflows/local-isolated-test.yml`

兩個 canary slot 各自：

```text
checkout exact head
→ 安裝固定 Supabase CLI 2.116.0
→ npm ci
→ 唯一 local project id
→ supabase start，套 current repo migrations
→ 匯出 local URL／anon／service-role
→ 驗證 URL 只能是 localhost／127.0.0.1
→ 兩邊同時插入相同固定 tenant id，保持 15 秒
→ 重新讀回自己的 marker
→ 刪除 canary row
→ always 執行 supabase stop --no-backup
```

如果兩條 job 共用同一個資料庫，第二個固定 ID insert 會撞 unique constraint，canary 必須紅。
如果其中一條改掉另一條 marker，也必須紅。

成功結果名稱是：

```text
ISOLATION_CANARY_GREEN
```

## 4. Phase 1B 完整 local TEST

`LOCAL_ISOLATED` 才執行：

```text
stage local-only migration overlay
→ supabase start
→ standard reset／seed
→ integration
→ Playwright E2E
→ LOCAL_CLEANUP_VERIFIED
```

第一輪 canary 發現 current main 的正式 migration source 只能重建到 0001～0014，但標準
seed 已明確依賴後續 `trips`／`trip_plans`／`trip_departures` 等結構。這不是 local
Supabase 壞掉，而是 repo migration 帳本缺了中段。

### 4.1 過渡性 local-only migration overlay

Phase 1B 使用：

```text
supabase/local-migrations/historical-integration-baseline/
```

這裡保存歷史整合分支 `claude/deploy-vercel-project-nnno59` 的 0015～0033 SQL 與
`manifest.json`。每支 SQL 都記錄原始 Git blob SHA。

執行時：

```text
TEST_PROFILE=LOCAL_ISOLATED
ALLOW_LOCAL_MIGRATION_OVERLAY=true
node scripts/ci/stage-local-migration-ledger.mjs
```

script 只在 disposable runner 內把檔案暫時複製到 `supabase/migrations`。它不修改 git
工作樹裡的正式 migration 帳本，也不會推到 remote TEST。

### 4.2 為什麼不直接補進正式 migration 目錄？

遠端 TEST 已存在另一套 migration version／name 歷史。若把歷史整合分支的 0015～0033
直接塞進正式目錄，可能出現「同一版本號、不同內容」的帳本衝突。

所以 Phase 1B 先回答：

> 本機隔離環境能不能完整跑現有測試？

它不偷偷回答：

> 正式遠端 migration 歷史已經整理完了。

後者要另做 migration-ledger reconciliation。

### 4.3 可重建性護欄

- 必要表缺失必須 fail closed，不可改 seed 忽略。
- overlay 只接受 `LOCAL_ONLY_TRANSITIONAL` manifest。
- 缺檔、額外 SQL、重複名稱、Git blob SHA 不符都必須停止。
- 正式 migration 目錄若已有同名檔，overlay 不得覆蓋。
- remote TEST 內的未合併候選 migration 不自動等於 main canonical source。
- 不提交未經審查的完整 remote schema dump。
- fresh local DB 與 remote canonical TEST 的 schema 差異必須有報告。
- local 綠燈只能叫 `ISOLATED_GREEN`，不能叫 `CANONICAL_GREEN`。

Migration mapping 報告：

```text
docs/metrics/test-lanes/2026-09-01-phase1b-ledger-map.md
```

## 5. Phase 2：Supabase Preview Branch

重型路徑分類：

```text
supabase/migrations/**  → DATABASE_MIGRATION
Auth／middleware        → AUTH
Storage／upload         → STORAGE
```

真正建立 branch 前需成本確認。每個 branch 必須記：

```text
BRANCH_ID
PROJECT_REF
PR
EXACT_HEAD
MIGRATION_BASELINE
CREATED_AT
LEASE_EXPIRES_AT
HOURLY_COST
ESTIMATED_COST
CLEANUP_STATUS
```

最多兩條。建立／重設／刪除任一步驟失敗就停止，不能留下無人認領的計費盆栽。
禁止 `merge_branch`，最終 migration 仍走正常 repo migration／canonical TEST／Production 授權。

## 6. Phase 3：雙 Terra

Phase 3 不是 Mode C 回歸，而是受健康隔離 slot 控制的 B++：

```text
FULL_TERRA_MAX = min(2, AVAILABLE_ISOLATED_TEST_SLOTS)
```

每條完整 Terra 必須有不同：

```text
PRIMARY_ISSUE
TEST_ENV_ID
FILE_OWNERSHIP
EXACT_HEAD
```

最後仍排隊：

```text
REMOTE_CANONICAL_TEST
→ SOL_AUDIT
→ MERGE
```

## 7. 量化證據

Run ledger 加入：

```text
local_canary_jobs
local_canary_success
local_isolated_jobs
local_isolated_success
local_isolated_failure
local_cleanup_success
migration_rebuild_gap_count
remote_branch_created
remote_branch_hours
remote_branch_estimated_cost
remote_branch_destroyed
isolated_test_wait_minutes
canonical_test_wait_minutes
cross_lane_contamination
full_terra_peak
```

## 8. 失敗處理

- local stack 起不來：保存容器／migration 錯誤，改變根因後再試，不改用 remote secret 偷跑。
- canary 綠、full suite 因缺表紅：判定 migration ledger 不完整，不判定隔離失敗。
- overlay 本身不完整：修 manifest／來源追溯，不把錯誤變成 seed optional skip。
- local 與 remote 結果不同：remote canonical 為最終證據，交 Luna 壓縮，必要時 Sol 判案。
- cleanup 失敗：該 slot 不健康，Phase 3 Terra 上限維持或退回 1。
- Preview Branch 超時：停止新建、刪除孤兒 branch、留下成本與失敗證據。
