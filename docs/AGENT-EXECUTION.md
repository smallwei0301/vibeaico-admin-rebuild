# Agent 自主執行規格

> 本文件是 `/goal`、開始／繼續 Loop、多 Agent 派工、CI／TEST 協調與 Issue closeout 的正式執行規格。
>
> 最新 Owner Decision：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`

## 1. 執行目標

長程任務必須持續推進，直到：

```text
所有可自主完成的 open Issue 已完成並關閉
或
剩餘項目全部只差 Owner／Production／外部供應商動作
```

以下都不是全域停止理由：

- 完成一個 Issue／PR／commit；
- CI 或 Agent 還在執行；
- local／remote TEST 排隊；
- 某一題 Owner-blocked；
- Preview 額度或單一路線環境錯誤。

某一路線等待時，轉做不撞檔案、不碰同一 remote TEST 的 Luna、Closure 或另一條 qualified Terra 工作。

## 2. Current truth（即時真相）

每次新 Session、模型切換或接手，先：

1. `git fetch origin --prune`；
2. 從 `origin/main` 讀 `AGENTS.md`、最新 Owner Decision、本文件、B+ Loop、PR lifecycle 與 Skill；
3. 重新查 current main、open Issues、open PRs、exact-head CI、local runs 與 remote TEST holder；
4. 接續最新有效 `IN_PROGRESS` Run，不另建重複 Run；
5. 保留 branch、PR、migration 與測試 checkpoint，不 reset、不重做。

舊 Session、舊 PR body、舊 CI 與 branch-only 文件只當線索。外部系統重新讀回的狀態才是完成證據。

## 3. 現行 B+ 拓撲

```text
SCOUT / CLOSURE / CI / QA / METRICS  → Luna
TRIAGE                               → Sol
BUILD slot 1                         → Terra
BUILD slot 2（可選）                 → Terra
LOCAL_ISOLATED per PR                → 免費本機 Supabase
REMOTE_CANONICAL_TEST                → 現有 remote TEST，max 1
AUDIT                                → Sol，max 1
MERGE                                → max 1
CLOSEOUT                             → Luna
```

上限：

```text
qualified TERRA_BUILD   max 2
TERRA_RESERVE           pilot 期間 max 0
LUNA_CLOSURE            max 1
LUNA_TASKS              預設 4、最多 6，另有 Aggregator
LOCAL_ISOLATED          每張 Terra PR 各一套
REMOTE TEST holder      max 1
SOL_AUDIT               max 1
MERGE                   max 1
ACTIVE_CANDIDATE        max 2
```

第二條 Terra 是可選能力，不是必填配額。沒有安全題目時維持一條。

## 4. 雙 Terra 啟用契約

只有兩張 active `TERRA_BUILD` PR 都符合以下條件，WIP Guard 才允許第二條：

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 / 2
RUN_ID: 相同
Primary Issue: 不同
TEST_PROFILE: LOCAL_ISOLATED
TEST_ENV_ID: 不同
FINAL_CANONICAL_REQUIRED: true
FILE_OWNERSHIP: 明確且不重疊
TEST_LANE_REQUIRED: false（BUILD 階段）
```

`FILE_OWNERSHIP` 以逗號分隔路徑根目錄。相同或父子路徑都算撞車，例如：

```text
src/app/api/chat
src/app/api/chat/messages
```

若 AppShell、migration 編號、共用 fixture、共用 schema 或熱門檔案無法分開，不啟動 slot 2。

不完整契約會 fail closed（不確定就擋下），全 repo 自動維持一條完整 Terra。

## 5. 角色與模型路由

### Luna

優先負責：

- live truth 與 Issue／PR 盤點；
- CI 狀態變化與錯誤壓縮；
- Closure Sweep／Janitor；
- acceptance matrix、文件、checkbox、metadata；
- Run ledger 與 scorecard；
- 已有標準答案的機械修改。

每個 Luna 任務只含一個 Issue／PR、一個 exact head、一個問題、限定路徑與最多 15 行輸出。一位 Aggregator 去重後再交 Sol。

### Sol

只負責：

- TRIAGE：選 slot 1、可選 slot 2、Closure target 與 remote TEST 順序；
- DIAGNOSE：模糊 CI、DB／Auth／付款／安全、local-vs-remote 不一致、ownership collision；
- AUDIT：一次只審一張候選，輸出 `CLOSE_APPROVED | FIX_REQUIRED | OWNER_BLOCKED`。

一般 Issue 目標預算是 TRIAGE 一次、AUDIT 一次。Sol 不做 CI 輪詢、搬文件與一般 CRUD 施工。

### Terra

每位 Terra 對一個中大型 Issue 端到端負責：

```text
讀規格
→ targeted tests
→ source 修改
→ unit / typecheck / build
→ local migration / reset / seed
→ local integration / E2E
→ ISOLATED_GREEN／AUDIT_READY／OWNER_BLOCKED
```

同一 Issue、同一檔案群不得同時交給兩位 Terra。

## 6. Local isolated TEST（免費本機測試）

每張 Terra PR 使用自己的 disposable local Supabase：

```text
checkout exact head
→ 固定 Supabase CLI
→ fresh local Supabase
→ local-only migration overlay（需要時）
→ reset / seed
→ integration
→ Playwright E2E
→ always: supabase stop --no-backup
```

安全規則：

- URL 必須是 `localhost`／`127.0.0.1`；
- 不讀 remote TEST 或 Production secrets；
- 不連正式資料；
- 同一 PR 的新 SHA 取消舊 local run；不同 PR 可平行；
- local 成功只叫 `ISOLATED_GREEN`；
- cleanup 成功才叫 `LOCAL_CLEANUP_VERIFIED`；
- local green 永遠不能冒充 remote canonical green。

## 7. Remote canonical TEST（唯一最終考場）

現有 remote TEST Supabase 仍維持單線：

```text
REMOTE_CANONICAL_TEST max 1
```

只有 active `TEST_VALIDATION` holder 能使用 remote TEST secrets、migration、reset、seed、schema cache、integration 與 E2E。

進入前記錄：

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

兩張 local green 候選依 closeability、風險與依賴排隊。不能用 no-op commit、舊 SHA 或同環境不變的盲目 rerun 搶 TEST。

## 8. DB／Auth／Storage

資料庫 migration、Auth（登入／權限）與 Storage（檔案儲存）也走免費路徑：

```text
LOCAL_ISOLATED
→ SHARED_CANONICAL
```

付費 Supabase Preview Branch 目前為：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

不得建立、不得要求 Owner 確認費率、不得使用退休的 `REMOTE_BRANCH_REQUIRED` profile，也不得把付費分支當成雙 Terra 或 merge 的必要條件。

local 與 remote 結果不同時，保留精確差異，由 Luna 壓縮；只有模糊或高風險問題才交 Sol。

## 9. TEST 長期授權與 Production 邊界

已授權的 remote TEST project：

```text
nmwhwngojosmagjuvxol
```

可在唯一 holder 下執行 open Issue 所需的 TEST migration、DDL／DML、reset、seed、schema cache、integration／E2E 與殘留清理。

此授權不包含：

- 其他 Supabase project；
- Production DDL／DML／migration；
- Production deploy／promote；
- 真實付款／退款；
- 真實顧客通知；
- 把 TEST 證據當成 Production 證據。

## 10. PR lifecycle 與 Closure

每個 primary Issue 最多一張 ACTIVE implementation PR；必要時另有短命 VALIDATION PR。雙 Terra 代表兩個不同 Issue 各一張 active PR，不代表同一 Issue 開兩張工地。

`PARKED` PR：

- 不派 Agent；
- 不 push；
- 不 rerun；
- 不輪詢；
- 不占 Terra、local TEST、remote TEST 或 active-candidate 容量。

MAIN／slot Terra 必須有 Closure target，或明確的 `EMPTY_WITH_SCAN`／`REPORT:<path>` 證據。只有 Sol 回覆 `CLOSE_APPROVED` 才能由 Luna／主 Agent 關閉 Issue，關閉後再 fetch Issue 驗證 `state=closed`。

## 11. Scope Firewall

新發現只有符合以下任一條件，才能阻塞本輪：

1. UI／原站宣稱可用，但沒有真實副作用或資料不保存；
2. 有安全、跨租戶、資料損失、付款、退款、權限或真實通知風險；
3. 原 Issue 或 canonical 文件已要求的驗收缺失。

純美化、未來想法、可選重構與非必要效能優化進 backlog，不吸入目前 PR。

## 12. CI 診斷與節流

- 先確認 exact head、測試是否真的開始與失敗層級；
- 401 先看測試是否刻意驗未登入，再查 seed → login → `/api/auth/me` → 同 cookie 請求；
- `PGRST202` 優先查 migration／schema cache；`PGRST201` 優先查多外鍵關聯歧義；
- seed 只可略過明確「表不存在」；欄位、外鍵、權限、cache 或未知錯誤必須 fail closed；
- 同 exact head、同環境、同命令不得盲目重跑；
- 同一環境錯誤連續兩次就換診斷方式；
- 成功 toast 不等於真實副作用成功；
- 關鍵寫入、名額、收款與狀態轉移要用 transaction／atomic RPC，並測並發。

## 13. Pilot 自動退回一條 Terra

下一個 Run 將 `FULL_TERRA_MAX` 退回 1，若發生：

- local stack 或 cleanup 失敗；
- ownership／migration／fixture／schema 撞車；
- cross-lane contamination；
- active candidates 超過 2；
- 品質低於 24／30；
- carryover 或 post-merge regression 增加；
- weighted usage／Delivery Unit 惡化超過 20%，且產出沒有增加。

退回後先復盤。根因修好後才能重新啟動 slot 2；單 Terra 模式可恢復最多一條 source-only Reserve。

## 14. Run ledger 與量化

每輪建立或接續：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

至少記錄：

```text
full_terra_peak
slot_1/2_active_minutes
local_isolated_jobs / success / failure / cleanup
remote_canonical_wait_minutes
file_ownership_collision
cross_lane_contamination
issues_closed / delivery_units / carryover
weighted_usage_per_delivery_unit
Sol_touches_per_issue
post_merge_regression
fallback_to_single_terra
```

實際 token／週 usage 可見就照實記；不可見就填 `null`。Luna=1、Terra=3、Sol=6 只是內部相對尺，不是官方額度換算。

## 15. Completion Truth Gate

送出 merge／close／migration／deploy 等工具動作，只代表 `REQUESTED`，不代表 `COMPLETED`。

宣稱 PR 已合併前至少必須：

1. 重新 fetch PR，確認 `merged=true` 或 `merged_at`；
2. 取得 `merge_commit_sha`；
3. 重新 fetch current main；
4. compare 證明 merge commit 可由 main 追溯；
5. 用 `ref=main` 重讀至少一個關鍵檔；
6. 記錄 exact-head CI 與驗證時間。

尚未完成時使用 `MERGE_REQUESTED_UNVERIFIED`。Issue close、CI green、local cleanup、remote TEST 與 migration 也使用相同的「動作後再讀回」原則。

未驗證卻宣稱完成，復盤記為 `AUDIT_DATA_INVALID`、安全性失敗與 `F-HARD`，不得靠其他分數補回。

## 16. 三輪試行

免費雙 Terra 可在治理 PR 合併後啟動。最近三個完整 Run 必須比較：

- Delivery Unit 與 Issue close；
- usage／Delivery Unit；
- local 成功率與 cleanup；
- remote TEST 等待；
- ownership collision／cross-lane contamination；
- carryover／post-merge regression；
- Sol touches。

三輪是「是否保留雙 Terra 為預設」的觀察期，不是啟用前等待期。任何硬性安全失敗都立即退回單 Terra。
