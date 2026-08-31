# Close-first TRIAGE 與全域 WIP lanes

> Owner 裁示日期：2026-08-31  
> 範圍：長程 `/goal`、多 Agent 派工、open Issue 收斂、PR／CI 排程  
> 性質：補強 `docs/AGENT-EXECUTION.md` 的全域節流規則，不改產品規格或 Production 邊界

## 1. 背景

先前的角色路由已防止「同一 Issue 派多位 Terra 競作」，但仍可能同時啟動多張大型
Issue，最後形成多張 Draft PR、反覆 CI 與大量 Sol 重讀，卻沒有 Issue 真正 close。

本裁示把工作重心從「同時開始很多題」改成「限制在製品，先完成最接近終點的題目」。
重要性仍會考量，但不能只因某題很大或很重要，就讓明知依賴其他大型 Issue、Owner 或
外部人類的工作占用新的 BUILD lane。

## 2. 固定全域 lanes

整個 repo 同一時間最多只有：

| Lane | 上限 | 負責模型 | 允許工作 |
|---|---:|---|---|
| `TERRA_BUILD` | 1 | Terra | 一個中大型 Issue 的實作、明確除錯與 targeted tests |
| `LUNA_CLOSURE_SWEEP` | 1 | Luna | 掃描既有 Issue／PR、補證據、文件、Preview、狀態與機械 closeout |
| `TEST_VALIDATION` | 1 | Terra／Luna 執行，Sol 必要時判案 | 共用 TEST migration、reset、seed、integration、E2E |

另外，整個 repo 最多保留 **2 個 active candidates（活躍候選 PR）**。其他 open PR
必須視為 `PARKED`，不得繼續收到新 source commit、完整 CI 或反覆審計，直到 TRIAGE
正式把它升回 active。

### 2.1 Active candidate 定義

符合任一條件才算 active：

- 正在 `TERRA_BUILD` 接收本輪 source 修改；
- 正在 `TEST_VALIDATION` 取得 exact-head TEST／integration／E2E 證據；
- 已被 `LUNA_CLOSURE_SWEEP` 選為本輪唯一 close-ready 候選，正在補最後證據或收尾。

單純 open、Draft、等待 Owner、等待其他大型 Issue、只保留歷史證據或已被新版 PR
取代，不算 active，應標為 parked。

Closure Sweep 可以盤點很多 Issue／PR，但一次最多只可把一個候選提升為 active。

## 3. Close-first TRIAGE

Sol 在啟動新的 Terra BUILD 前，必須依下列順序排序：

1. **READY**：既有 PR／實作已存在，只剩 0–2 個可自主完成的驗收缺口，沒有 Owner／
   外部人類／未完成大型 Issue 依賴。
2. **NEAR**：已有主要實作與大多數測試，能在一個施工循環內完成，且不需先完成另一張
   大型 Issue。
3. **UNBLOCKER**：可自主完成，完成後會解除多張 Issue 的共同依賴或修復 P0／安全／
   資料損失風險。
4. **BUILDABLE**：規格完整、無 Owner blocker，但需要一個新的中大型施工循環。
5. **BLOCKED**：仍依賴 Owner、外部人類、Production 授權或另一張未完成大型 Issue。

只要存在 READY 或 NEAR，禁止先啟動 BLOCKED 或新的大型 BUILDABLE。安全、跨租戶、
資料損失、付款等真正緊急風險可由 Sol 明確寫出例外理由，但仍不得開第二條 Terra lane。

TRIAGE 必須輸出：

```text
NEXT:
CLOSEABILITY: READY | NEAR | UNBLOCKER | BUILDABLE | BLOCKED
AUTONOMOUS_GAPS:
DEPENDENCIES:
ACTIVE_CANDIDATE_COUNT:
LANE_ASSIGNMENT:
WHY_NOT_OTHER_ACTIVE_PRS:
EXPECTED_FULL_CI_COUNT:
```

## 4. 開工閘門

在派出 Terra 前，主 agent 必須同時確認：

- 沒有另一張 PR 占用 `lane:terra-build`；
- active candidate 總數小於 2；
- 共用 TEST lane 的目前持有者已知；
- 本題不會因尚未完成的 Owner／外部／大型依賴而注定停成另一張 Draft；
- 已有 PR 可接續時，不重開競爭分支；
- Closure Sweep 已持續運轉，沒有被抽去做第二條 BUILD。

若任一條不成立，新的中大型 BUILD 不得啟動。可以做的只有 Luna 盤點、文件、靜態
核對、既有 PR 收尾、unit test 或其他不會產生新 active candidate 的工作。

## 5. Sol 使用邊界

Sol 只在以下情況介入：

1. 開工 TRIAGE；
2. 模糊 CI、TEST 污染、Auth／DB／權限／安全責任判案；
3. 最終 AUDIT 與 close verdict。

一般 Issue 仍以 TRIAGE + AUDIT 兩次為目標。Luna 必須先壓縮事實；Sol 不重讀完整
repo、完整 CI log 或整段舊對話，也不輪詢等待中的 CI。

## 6. GitHub 狀態標記

使用以下 labels：

```text
lane:terra-build
lane:luna-closeout
lane:test-validation
candidate:active
candidate:parked
governance:wip-limit-exceeded
governance:lane-metadata-missing
```

每張 PR 同一時間最多一個 `lane:*` label；`candidate:active` 必須搭配一個 lane，
`candidate:parked` 不得搭配 lane。Lane 轉換時先移除舊 label，再加入新 label。

PR body 以固定欄位表達：

```text
AGENT_LANE: TERRA_BUILD | LUNA_CLOSURE_SWEEP | TEST_VALIDATION | PARKED
CANDIDATE_STATUS: ACTIVE | PARKED
CLOSEABILITY: READY | NEAR | UNBLOCKER | BUILDABLE | BLOCKED | N/A
```

`.github/workflows/agent-wip-lanes.yml` 只負責同步與檢查 labels、active candidate 數量及
lane 上限。它不決定哪張 Issue 重要、不替代 Sol TRIAGE，也不自行 close PR／Issue。

本裁示生效前的未標記 open PR，預設視為 parked；只有 TRIAGE 明確升級後才算 active。

## 7. 成效量測

每輪至少記錄：

- `active_candidate_peak`
- `terra_build_lane_violations`
- `closure_sweep_candidates_reviewed`
- `closure_sweep_candidates_promoted`
- `full_ci_runs`
- `invalid_reruns`
- `sol_contacts`
- `closed_issues`

目標：

```text
active_candidate_peak <= 2
terra_build_lane_violations = 0
invalid_reruns = 0
一般 Issue sol_contacts <= 2，模糊高風險問題例外
每一輪至少產生一個 close verdict，而不是只累積 Draft PR
```

無法取得平台真實 token 時，不得編造用量百分比；以這些代理指標判斷是否真的節流。

## 8. 不變的安全線

本裁示不新增 Production 權限。Production migration／DML、正式部署、真實付款、退款與
真實顧客通知仍需 Owner 明確授權。
