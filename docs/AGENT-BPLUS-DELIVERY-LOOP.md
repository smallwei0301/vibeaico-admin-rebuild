# B+ Agent 出貨迴圈

> 最新決策：`docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
>
> 原始 B+：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`

## 現行架構

B+ 仍是 close-first（先收尾再開新工地），但現在可在嚴格契約下試行兩條完整 Terra：

```text
Terra slot 1 → 自己的免費 local Supabase ┐
                                          ├→ 依 closeability 排隊
Terra slot 2 → 自己的免費 local Supabase ┘
                                                   ↓
                                      remote canonical TEST max 1
                                                   ↓
                                           Sol Audit max 1
                                                   ↓
                                              merge max 1
```

Repo-wide 上限：

```text
TERRA_BUILD          max 2，僅限 qualified dual pilot
TERRA_RESERVE        pilot 期間 max 0
LUNA_CLOSURE         max 1
LUNA_TASKS           預設 4、最多 6，另有 1 位 Aggregator
LOCAL_ISOLATED       每張 Terra PR 各 1 套
TEST_VALIDATION      remote max 1
SOL_AUDIT            max 1
MERGE                max 1
ACTIVE_CANDIDATE     max 2
```

沒有完整雙 Terra 契約時，自動維持 `TERRA_BUILD max 1`。

付費 Supabase Preview Branch 目前是：

```text
DEFERRED_NOT_IN_CONSIDERATION
```

不得建立、不得要求費率確認，也不得當成雙 Terra、Audit 或 merge 的前置條件。

## 每輪 Loop

```text
START
→ Luna fan-out：live truth、Closure、CI、Janitor、QA、Metrics
→ Luna Aggregator：去重，壓縮成 <=30 行
→ Sol TRIAGE：選 slot 1、可選 slot 2、Closure target、remote TEST 順序
→ Terra BUILD 1/2：各自施工並跑 local isolated TEST
→ remote canonical TEST：一次只驗一張
→ Sol AUDIT：一次只審一張
→ merge：一次只合一張
→ Luna CLOSEOUT：Issue、PR、證據、lane、報告
→ SCORE / ADJUST
→ NEXT LOOP
```

## 雙 Terra 必要契約

兩張 active `TERRA_BUILD` PR 都必須填：

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 或 2
RUN_ID: 同一個值
Primary Issue: 不同
TEST_PROFILE: LOCAL_ISOLATED
TEST_ENV_ID: 不同
FINAL_CANONICAL_REQUIRED: true
FILE_OWNERSHIP: 明確且不重疊
TEST_LANE_REQUIRED: false
```

`FILE_OWNERSHIP` 使用逗號分隔路徑根目錄。以下視為撞車：

```text
src/app/api/chat
src/app/api/chat/messages
```

因為第二條位於第一條裡面。AppShell、相同 migration 編號、共用 fixture、共用 schema 所有權等熱門區域無法清楚切開時，不啟動 slot 2。

## Terra 工作邊界

每條 Terra 可以完成：

```text
讀規格
→ targeted tests
→ source 修改
→ unit / typecheck / build
→ local migration / reset / seed
→ local integration / E2E
→ ISOLATED_GREEN 或明確失敗
```

Local 成功只能叫：

```text
ISOLATED_GREEN
LOCAL_CLEANUP_VERIFIED
```

不能叫 `CANONICAL_GREEN`。最後仍須排進現有 remote TEST。

Pilot 期間不另開 Reserve Terra。若其中一條失敗並退回單 Terra，才可按舊 B+ 邊界恢復最多一條 source-only Reserve。

## remote TEST、Sol 與 merge

兩張 local green 後，Sol 依 closeability、風險與依賴排序。只允許一張成為 remote `TEST_VALIDATION` holder。

禁止：

- 兩張同時使用 remote TEST secrets；
- no-op commit 只為重跑；
- 重跑舊 SHA；
- local green 跳過 remote TEST；
- 兩張同時進 Sol Audit；
- 兩張同時 merge。

## DB／Auth／Storage

資料庫 migration、Auth（登入與權限）、Storage（檔案儲存）也走免費路徑：

```text
LOCAL_ISOLATED
→ SHARED_CANONICAL
```

若 local 與 remote 結果不一致，保存差異，由 Luna 壓縮；只有模糊或高風險問題才交 Sol。不得自行建立付費分支。

## Luna 與 Sol

Luna 任務維持窄範圍：一個 Issue／PR、一個 exact head、一個問題、最多 15 行。Aggregator 去重後才交 Sol。

一般 Issue 的 Sol 預算：

```text
TRIAGE 1
AUDIT 1
```

只有 DB／Auth／付款／安全、local-vs-remote 不一致、shared TEST 模糊或 ownership collision，才增加一次 DIAGNOSE。

## 失敗時自動退回一條 Terra

下一輪將 `FULL_TERRA_MAX` 退回 1，若發生：

- local stack 或 cleanup 失敗；
- 兩條 ownership／migration／fixture／schema 撞車；
- local 結果互相污染；
- active candidates 超過 2；
- 品質低於 24／30；
- carryover 或 post-merge regression 明顯增加；
- weighted usage／Delivery Unit 惡化超過 20%，且成品沒有增加。

退回後先復盤，再決定是否重新試行。

## Run 證據

每輪維護：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

至少記錄：slot 1/2、local run、cleanup、remote wait、ownership collision、Issue close、Delivery Unit、carryover、Sol touches、模型使用與 post-merge regression。

實際 token 不可取得時保留 `null`，不得猜。內部 Luna=1、Terra=3、Sol=6 只作相對比較，不是官方額度換算。

## Completion Truth Gate

送出工具動作只算 `REQUESTED`。宣稱 local green、remote green、Audit、merge 或 Issue close 前，必須重新讀取 live workflow、PR、main、Issue 或外部環境。

PR merge 至少需：

```text
merged=true 或 merged_at
merge_commit_sha
current main head
merge commit 對 main 可追溯
ref=main 關鍵檔案重讀
```

未完成查證只能寫 `*_REQUESTED_UNVERIFIED`。
