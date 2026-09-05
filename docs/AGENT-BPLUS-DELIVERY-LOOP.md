# B+ Agent 出貨迴圈

> Canonical Owner Decision：`docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
>
> WIP preflight／alert decision：`docs/decisions/2026-09-04-owner-wip-preflight-and-alert-fingerprint.md`
>
> Run closeout contract：`docs/RUN-CLOSEOUT-CONTRACT.md`
>
> 本文件是執行手冊。若與較新的 Owner Decision 衝突，以較新的 Owner Decision 為準。

## 1. 為什麼從 Mode C 改成 B+

Mode C 讓不同 Issue 的 Terra 同時施工，能減少等待，但共用 TEST、Sol Audit 與 closeout
仍是窄出口。若同時開四張大型 PR，前端施工速度變快，最後會在 TEST 與審查門口塞車。

B+ 保留平行能力，但改成：

```text
一條完整出貨線
一條預備備料線
多位 Luna 窄任務線
一條收尾線
一條 TEST 線
```

## 2. 每輪狀態機

```text
START
  ↓
LUNA_FAN_OUT       真實盤點、Closure、CI、Janitor、QA、Metrics
  ↓
LUNA_FAN_IN        一位 Luna 彙整成不超過 30 行的 TRIAGE 包
  ↓
SOL_TRIAGE         選 MAIN_TERRA、可選 RESERVE_TERRA、Closure target
  ↓
TERRA_BUILD        主線施工；預備線只做 source-only 一個原子切片
  ↓
TEST_VALIDATION    唯一 shared TEST holder
  ↓
SOL_AUDIT          CLOSE_APPROVED／FIX_REQUIRED／OWNER_BLOCKED
  ↓
LUNA_CLOSEOUT      證據、PR／Issue、Janitor、lane 釋放
  ↓
LUNA_METRICS       JSON ledger → Markdown scorecard
  ↓
ADJUST             下一輪最多調整兩條規則
  ↓
NEXT LOOP
```

## 3. START：建立 Run ID、基準與關帳責任

格式：

```text
YYYY-MM-DD-RNN-簡短主題
```

開始時記錄：

```text
RUN_ID
RUN_CLOSEOUT_OWNER
START_MAIN_SHA
START_OPEN_ISSUES
START_OPEN_PRS
START_ACTIVE_CANDIDATES
START_MAIN_TERRA
START_RESERVE_TERRA
START_TEST_HOLDER
START_WEEKLY_USAGE_PERCENT（若平台可見）
```

新 Run 必須透過 operational CLI 明確指定唯一關帳 owner：

```bash
npm run agent:run:init -- \
  --run-id <RUN_ID> \
  --closeout-owner PRODUCT_MAIN_SESSION
```

可用角色只有：

```text
PRODUCT_MAIN_SESSION
GOVERNANCE_MAIN_SESSION
OWNER
```

新 ledger 使用 `deliveryTruthVersion: 4`。固定 terminal policy 是：Session 結束、Owner stop、
safe scope exhausted 或 owner-blocked 前，當前 owner 必須完成 closeout，或在 durable ledger／
checkpoint 中正式改派下一個 owner。不能只在聊天中說「之後有人會關」。完整契約見
`docs/RUN-CLOSEOUT-CONTRACT.md`。

歷史 v2.2／v3 ledger 保持原樣，不自動改寫。沒有可見的 token／週額度資料就填 `null`，
不得推測。

## 4. LUNA_FAN_OUT

預設 4 位，最多 6 位。任務包固定如下：

```text
TASK_ID:
ROLE:
ISSUE / PR:
EXACT_HEAD:
QUESTION:
READ_ONLY_PATHS:
DO_NOT_READ:
OUTPUT_MAX_LINES: 15
ALLOWED_RESULT: PASS | GAP | ESCALATE_TERRA | ESCALATE_SOL | OWNER_BLOCKED
```

### 避免低階模型也燒出文字暴風雪

- 不把完整舊對話傳給 Luna。
- 不讓兩位 Luna 全量掃同一批 Issue。
- 每位只回答一個問題。
- 一位 `LUNA_AGGREGATOR` 合併重複項，再交 Sol。
- Luna 發現超出範圍問題時只分類，不直接擴大主 PR。

## 5. SOL_TRIAGE

Sol 只讀 Luna 彙整包、Issue acceptance、必要 canonical 文件與候選差異摘要。

固定輸出：

```text
RUN_ID:
MAIN_TERRA:
RESERVE_TERRA:
CLOSURE_TARGET:
CLOSEABILITY_SCORE:
SELECTION_REASON:
DEPENDENCIES:
OWNER_OR_EXTERNAL_BLOCKER:
TEST_REQUIRED:
RESERVE_BOUNDARY:
RISK:
ACCEPTANCE_GATES:
WHY_NOT_CLOSER_CANDIDATE:
```

Closeability：

```text
5  最終分支已有成果，只差證據／close
4  差一個小步驟
3  已有 PR 與大多數測試，最多兩步可 Audit
2  仍需明顯施工或多輪驗證
1  主要卡 Owner／外部／Production／大型依賴
0  stale／duplicate／superseded
```

## 6. MAIN_TERRA 與 RESERVE_TERRA

### MAIN_TERRA

可以完整施工、申請 TEST、修明確 CI、交 Sol Audit。必須一路推到：

```text
CLOSED | AUDIT_READY | OWNER_BLOCKED
```

### RESERVE_TERRA

只能：

```text
讀必要規格
寫紅燈測試
source-only 小切片
unit / typecheck / build
最多一個原子 commit
```

必須明寫 `RESERVE_BOUNDARY`，例如：

```text
只改 GUIDE traveler aggregation；不碰 AppShell、Auth、migration、shared TEST；
完成 unit/typecheck/build 後停在 READY_FOR_PROMOTION。
```

若預備線開始需要 TEST、Sol Audit、第二個 commit 或擴大 scope，立刻停止並回 TRIAGE。

## 7. TEST_VALIDATION

進入 shared TEST 前留下：

```text
TEST_HOLDER_ISSUE
TEST_HOLDER_PR
EXACT_HEAD
MIGRATION_BASELINE
EXPECTED_FULL_CI_COUNT
```

離開時留下：

```text
WORKFLOW_RUN_ID
RESULT
FAILED_STEP / SUITE / CASE
ENVIRONMENT_CHANGED
RETRY_ALLOWED
RESIDUE_CHECK
```

同一 exact head、同一環境、同一命令不重跑。環境錯誤兩次後停止該路徑，保存證據並
切到其他安全工作。

## 8. SOL_AUDIT

Sol 只讀：

```text
Issue acceptance
相關 diff
targeted tests
exact-head CI
TEST／Preview 證據
安全邊界
未完成項
```

輸出只能是：

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

一般 Issue 的 Sol 接觸預算為 2 次；高風險或模糊 CI 最多 3 次。

## 9. LUNA_CLOSEOUT

- 更新 PR body 的 exact-head 與真實 CI 狀態。
- 刪除過時 `queued`／`in progress` 說明。
- 回填 Issue acceptance。
- 取得 `CLOSE_APPROVED` 後關閉 Issue。
- 將 stale PR 依 Janitor 規則安全收斂。
- 釋放 MAIN／RESERVE／TEST lane。
- 寫入本輪 ledger 與報告。
- 對 v4 ledger 將 `closeout.state` 改為 `CLOSED`，並填入與 `endedAt` 相同的時間、40 字元
  `main.endSha`、結束 Issue／PR inventory 與 durable `evidenceRef`。

若 Session 即將停止但 Run 仍需繼續，必須先更新 durable checkpoint 並明確改派
`closeout.ownerRole`。非 final Run 不得先填 `CLOSED`；final v4 Run 缺任一 terminal envelope
欄位時，validator 必須 fail closed。

## 10. 量化資料

### 實際 usage

平台提供時記錄：

```text
requested_model / actual_model
input_tokens
output_tokens
cached_tokens
weekly_usage_percent_start / end
```

### 內部加權 usage

平台未提供時使用專案內部比較值：

```text
Luna  = 1
Terra = 3
Sol   = 6
```

再乘上下文倍率：

```text
精簡交接包 = 1.0
中等文件包 = 1.5
完整對話／全 repo 重讀 = 3.0
```

這不是官方 token 換算。報告必須同時標出 `actual_tokens_available`，避免把估算偽裝成真實額度。

### Delivery Unit

```text
Issue CLOSED                    = 1.00
CLOSE_APPROVED 待允許 merge     = 0.80
自主工作完成後 OWNER_BLOCKED    = 0.50
只有 exact-head CI 綠           = 0.25
只有 commit                     = 0.10
```

主要效率指標：

```text
weighted_usage_per_delivery_unit = weighted_usage_units / delivery_units
```

> 上述是歷史 v1 比較尺。新 Run 的成品、Production pending 與 OWNER_BLOCKED 分帳，以
> `docs/DELIVERY-OUTCOME-V2.md` 的 Delivery Truth v3 為準，不再把 Audit Ready、CI-only 或
> commit-only 折算成 shipped product。

## 11. 100 分 Scorecard

| 面向 | 分數 |
|---|---:|
| 模型與 usage 效率 | 25 |
| 專案完成效率 | 25 |
| 品質與安全 | 30 |
| 多 Agent 流動效率 | 10 |
| 可稽核證據 | 10 |

### 等級

```text
90～100  A  明顯優化
80～89   B  健康
70～79   C  有產出但仍浪費
60～69   D  下一輪縮小 WIP
<60      F  進入 CLOSURE_RECOVERY
```

### 硬性失敗

下列任一發生，本輪 `qualified=false`：

- 未授權 Production DDL／DML／部署；
- 真實付款、退款或顧客通知；
- 洩漏秘密；
- 未經 `CLOSE_APPROVED` 關 Issue；
- 把未執行測試或舊 SHA 冒充驗收。

## 12. 自動調整

- Luna 採用率 ≥85%、重複率 ≤10%、品質分 ≥25／30：下一輪 Luna 上限可 +1，最多 6。
- Luna 採用率 <70% 或重複率 >15%：Luna 數量 -1，縮小任務並保留 Aggregator。
- usage 增加 >20% 但 Delivery Units 未增加：關閉預備 Terra，Reviewer 限一位，先做 Closure。
- 品質 <24／30：Luna 暫停改 code，預備 Terra 暫停，主 Terra 補 targeted tests。
- 連續兩輪沒有 CLOSED 或完整 OWNER_BLOCKED：進入 `CLOSURE_RECOVERY`，禁止開新大型 Issue。

## 13. 報告產物

每輪必須提交：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

命令：

```bash
npm run agent:run:init -- \
  --run-id <RUN_ID> \
  --closeout-owner PRODUCT_MAIN_SESSION
npm run agent:run:validate -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:score -- docs/metrics/agent-runs/<RUN_ID>.json
npm run agent:run:review -- docs/metrics/agent-runs --limit 3
```

Operational init 不接受省略 `--closeout-owner`。Direct no-owner construction 只保留給舊測試與
歷史 v3 重現，不是新 Run 的合法開帳方式。

Markdown 報告由 JSON 產生；人工修改報告後若無法由 JSON 重建，CI 應失敗。

## 14. 復盤

Owner 說「復盤」或「複盤」時：

1. 讀最新 main 與 `vibeaico-agent-retrospective` Skill。
2. 找 `docs/metrics/agent-runs/*.json` 最新 3 輪，資料不足則讀全部。
3. 重算分數，不相信舊報告中的手填總分。
4. 比較 usage／Delivery Unit、close rate、品質、Sol 接觸、Luna 採用率與 carryover。
5. 指出最多 3 個根因，只挑 1～2 個規則改良。
6. 安全的治理改良走 governance PR；不得在復盤時順便改產品功能或 Production。

## 15. PR 建立前的 WIP preflight 與降噪門禁

在建立或重新啟用 Agent Product PR 前，先把預計的 PR body 與 changed-file 清單存成檔案並執行：

```bash
node scripts/agents/agent-wip-preflight.mjs \
  --body /tmp/pr-body.md \
  --changed-files /tmp/changed-files.txt \
  --number <PR_NUMBER_OR_PLACEHOLDER>
```

單 Terra 與 governance PR 可省略 `--changed-files`；active Dual Terra 不可省略。preflight 失敗時先修 body、Issue 身分、scorecard 或檔案責任範圍，禁止先開 PR 再讓 GitHub Actions 當表單檢查器。

GitHub 上的 WIP Guard 仍是最終 live-state 門禁，但相同的：

```text
PR number + exact head SHA + sorted error set
```

只寄一次失敗通知。重複事件會更新同一留言並以 warning 結束；custom commit status：

```text
Agent WIP Policy
```

在錯誤修正前持續保持 failure，因此降噪不等於放行。新 SHA、錯誤內容改變或修復都會產生新狀態。

`main` branch protection 啟用後至少要求：

```text
Agent WIP Policy
check
```

目前 GitHub Administration 權限不足時，必須明記 `OWNER_BLOCKED_COMPLETE`，不得把 Repo 內規則就緒冒充成 branch protection 已生效。
