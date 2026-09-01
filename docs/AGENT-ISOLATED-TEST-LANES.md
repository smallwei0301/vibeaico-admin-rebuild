# 隔離 TEST 路線操作手冊

> Canonical decision：`docs/decisions/2026-09-01-owner-isolated-test-lanes.md`
>
> 追蹤：Issue #104

## 1. 為什麼需要隔離

目前 remote TEST 在每輪 integration 前會 reset／seed，並使用固定 tenant、user、UUID 與
測試帳號。兩個 job 若連到同一個 Supabase，其中一個 reset 會刪掉另一個正在使用的資料。
因此「把 GitHub parallel 設成 2」不等於真的有兩條安全 TEST 線。

Phase 1 讓每個 GitHub-hosted runner 啟動自己的 Docker／Supabase。它們可以使用相同固定
fixture，因為彼此不共享資料庫。測完即執行 `supabase stop --no-backup`。

## 2. TEST_PROFILE

| Profile | 用途 | 可以證明 | 不能證明 |
|---|---|---|---|
| `SOURCE_ONLY` | 文件、純 UI、純函式或 source checks | typecheck／unit／build | DB／Auth／Storage／E2E |
| `LOCAL_ISOLATED` | 一般需要真實 Supabase 的 PR | local migration、seed、integration、E2E | 遠端 schema cache、雲端供應商差異、最終 merge |
| `LOCAL_ISOLATED_CANARY` | 測試基礎設施自身 | 兩個獨立 runner 可平行且各自清理 | 產品候選已可 merge |
| `REMOTE_BRANCH_REQUIRED` | DB／Auth／Storage 重型候選 | Phase 2 需要遠端分支 | branch 已建立或已付費 |
| `SHARED_CANONICAL` | 最終遠端 TEST 驗收 | canonical TEST evidence | Production evidence |

Local profiles 必須同時填：

```text
FINAL_CANONICAL_REQUIRED: true
TEST_ENV_ID: AUTO
```

這能防止 Agent 把本機綠燈冒充最終遠端綠燈。

## 3. Phase 1 workflow

檔案：`.github/workflows/local-isolated-test.yml`

步驟：

```text
讀 PR TEST_PROFILE
→ checkout exact PR head
→ 安裝固定 Supabase CLI 2.116.0
→ npm ci
→ 為 runner 產生唯一 local project id
→ supabase start，套用 repo migrations
→ 從 supabase status 匯出 local URL／anon／service-role
→ 驗證 URL 只能是 localhost／127.0.0.1
→ 跑 integration
→ 跑 Playwright E2E
→ 寫 ISOLATED_GREEN
→ always 執行 supabase stop --no-backup
```

現有 `.github/workflows/ci.yml` 不變，仍負責 source checks 與唯一 remote canonical TEST。
Phase 1 workflow 不讀任何 GitHub remote TEST secret。

## 4. Canary

基礎設施 PR 使用：

```text
TEST_PROFILE: LOCAL_ISOLATED_CANARY
```

workflow 產生 `slot a`、`slot b` 兩個 GitHub-hosted runner。兩者使用：

```text
不同 TEST_ENV_ID
不同 LOCAL_PROJECT_ID
不同 Docker daemon／volume
相同 exact head
相同 migrations／fixtures
```

兩個 slot 都必須：

- integration 綠；
- E2E 綠；
- `supabase stop --no-backup` 成功；
- 留下 `LOCAL_CLEANUP_VERIFIED`；
- 不使用 remote TEST secret。

若只綠一條，Phase 1 仍未完成。

## 5. Phase 2：Supabase Preview Branch

重型路徑分類：

```text
supabase/migrations/**  → DATABASE_MIGRATION
Auth／middleware        → AUTH
Storage／upload         → STORAGE
```

這些路徑預設建議 `REMOTE_BRANCH_REQUIRED`。真正建立前需成本確認。

每個 branch 必須記：

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

最多兩條。建立／重設／刪除任一步驟失敗就停止，不能把 branch 留成無人認領的計費盆栽。
禁止 `merge_branch`，最終 migration 仍由正常 repo migration／canonical TEST／Production 授權流程處理。

## 6. Phase 3：雙 Terra

Phase 3 不是「Mode C 回歸」。它是受隔離 slot 數量控制的 B++：

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

但最後仍排隊：

```text
REMOTE_CANONICAL_TEST
→ SOL_AUDIT
→ MERGE
```

## 7. 量化證據

Run ledger 加入：

```text
local_isolated_jobs
local_isolated_success
local_isolated_failure
local_cleanup_success
remote_branch_created
remote_branch_hours
remote_branch_estimated_cost
remote_branch_destroyed
isolated_test_wait_minutes
canonical_test_wait_minutes
cross_lane_contamination
full_terra_peak
```

只有「每單位成品 usage 沒增加、品質沒下降、carryover 沒惡化」才算雙 Terra 成功。

## 8. 失敗處理

- local stack 起不來：保存容器／migration 錯誤，最多改變原因後再試；不改用 remote secret 偷跑。
- local 與 remote 結果不同：remote canonical 為最終證據，交 Luna 壓縮、必要時 Sol 判案。
- cleanup 失敗：該 slot 標為不健康，Phase 3 Terra 上限自動退回 1。
- Preview Branch 超時：停止新建、刪除孤兒 branch、留下成本與失敗證據。
