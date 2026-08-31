# Agent 控制訊號、Stop Guard 與 Issue 來源裁示

> Owner 裁示日期：2026-08-31
> 範圍：長程 `/goal`、模型切換、施工效率分析、Agent 新建 Issue
> 性質：補充 `docs/AGENT-EXECUTION.md` 的判讀語意，不改產品規格與 Production 邊界

## 1. 背景

Owner 可能在同一個長程施工中，手動送出 `/goal`、`/steer` 或「繼續」，用來切換
模型速度、思考等級或工作角色。這類訊息是 Owner 的操作控制，不代表前一位 agent
一定自行停止。

同樣地，GitHub 出現新的 Issue，也不能只依建立時間或建立帳號推定是 agent 自己開的。
Owner 會在對話中手動建立 Issue，而 connector 代 agent 建立時也可能使用同一個 GitHub
帳號。沒有內容來源標記時，單靠 GitHub actor 無法可靠歸屬。

因此，後續施工與效率分析必須以明確來源資料為準，不得用時間順序補故事。

## 2. Owner 控制訊號分類

| 代碼 | 何時使用 | 是否算 Stop Guard 失敗 | 接手動作 |
|---|---|---:|---|
| `OWNER_MODEL_SWITCH` | Owner 為切換模型速度、思考等級或角色再次送 `/goal` | 否 | 讀 live GitHub 與最近 checkpoint，原地接續 |
| `OWNER_STEER` | Owner 補充限制、授權或修正方向 | 否 | 套用新限制，不 reset、不重做已完成工作 |
| `OWNER_CONTINUE` | Owner 主動要求繼續目前工作 | 否 | 從目前 stage 接續，不把訊息本身當停工證據 |
| `AGENT_PREMATURE_STOP` | assistant 已送出終止性 final、明確暫停或要求 Owner 再次下令，且當時仍有可自主工作 | 是 | 記錄證據、修正 checkpoint 與 continue rule |
| `NORMAL_GOAL_STOP` | 符合 `docs/AGENT-EXECUTION.md` §10 | 否 | 依規定交付最終報告 |
| `UNKNOWN_CONTROL_EVENT` | 缺少足以判讀的 assistant 回覆或工具紀錄 | 不計入 | 明寫未知，不猜測 |

### 2.1 Stop Guard 的證據門檻

只有同時滿足以下條件，才能記為 `AGENT_PREMATURE_STOP`：

1. 有 assistant 的終止性 final、明確「先到這裡」、等待 Owner 再下令，或等價證據；
2. 該時間點仍有可以自主進行的程式、測試、文件、PR、CI 判讀、Preview 或 closeout；
3. 不是 Owner 主動切換模型、手動 steering、平台中斷或安全拒絕。

僅看到 Owner 後來又送 `/goal`，不能倒推前一位 agent 停止。匯出的對話若只保留 Owner
訊息、不含 assistant 回覆，判定必須是 `UNKNOWN_CONTROL_EVENT`。

## 3. 模型切換後的施工連續性

接手模型收到 `/goal` 或 `/steer` 時：

1. 先重新取得 open Issue、open PR、main、exact head、CI 與 TEST 占用。
2. 尋找目前可用的 branch／PR／checkpoint，從既有 stage 接續。
3. 不 checkout/reset 現有工作，不重做已完成盤點、commit、測試或 migration。
4. 把本次控制訊號記為 `RUN_CONTROL`，但不把它算成 Sol 接觸、Agent 停止或失敗重跑。
5. 若缺少前一位 agent 的 checkpoint，依 live GitHub 重建最小事實，不複製整段舊對話。

建議 checkpoint 最少包含：

```text
RUN_CONTROL:
ISSUE:
STAGE:
BASE / HEAD:
ACTIVE_PR:
LAST_COMPLETED:
CURRENT_TEST_LANE:
NEXT_SAFE_ACTION:
BLOCKERS:
REQUESTED_MODEL / ACTUAL_MODEL:
```

## 4. Issue 來源與建立規則

### 4.1 來源分類

| 來源 | 判定方式 | 是否計入 Agent 新增 Issue 指標 |
|---|---|---:|
| `agent` | Issue body 明確含 `AGENT_DISCOVERED` 與來源欄位 | 是 |
| `owner-or-unknown` | 沒有 agent 來源標記，或歷史資料不足 | 否 |

不得因 Issue 建立者是 `smallwei0301`、建立時間落在 agent 施工期間，或 Issue 文案很詳細，
就自行判定是 agent 建立。

### 4.2 Agent 新建 Issue 的必要欄位

Agent 只有符合 Scope Firewall 時才可開新 Issue，並使用
`.github/ISSUE_TEMPLATE/agent-discovered.yml`，或在 API 建立的 body 保留等價欄位：

```text
ISSUE_ORIGIN: AGENT_DISCOVERED
PARENT_ISSUE / PR:
DISCOVERED_STAGE:
SCOPE_FIREWALL_REASON:
WHY_SEPARATE_FROM_PARENT:
BLOCKS_CURRENT_GOAL:
EVIDENCE:
REQUESTED_MODEL / ACTUAL_MODEL:
```

其中 `SCOPE_FIREWALL_REASON` 只能是：

- 既有 UI／文件宣稱功能可用，但沒有真實副作用或持久化；
- 安全、跨租戶、資料損失、付款、退款、權限或真實通知風險；
- 原 Issue／canonical 文件已要求但缺少的驗收項。

若缺少 `WHY_SEPARATE_FROM_PARENT`，預設應留在原 Issue 內處理，不另開新 Issue。

### 4.3 歷史資料

本裁示生效前、沒有來源標記的 Issue 一律保持 `owner-or-unknown`。除非有對話、API
操作紀錄或 Owner 明確確認，不進行追溯性猜測，也不以人工補標讓數據看起來完整。

## 5. 效率與 Token 分析的正確口徑

無法取得平台真實 token 時，不得編造百分比。代理指標至少分開列：

- `owner_control_events`
- `agent_premature_stops`
- `agent_created_blocking_issues`
- `owner_or_unknown_issues_created`
- `full_ci_runs`
- `invalid_reruns`
- `sol_contacts`
- `closed_issues`

`owner_control_events` 不得算進 Stop Guard 失敗；`owner-or-unknown` Issue 不得算進 Agent
新增 blocking Issue。歷史報告若曾混算，後續更正口徑即可，不需偽造過去的精確數字。

## 6. 自動標記 Hook

`.github/workflows/issue-provenance.yml` 在 Issue 開啟或編輯時：

- body 含 `AGENT_DISCOVERED` → 標記 `origin:agent`；
- 其他 → 標記 `origin:owner-or-unknown`；
- agent Issue 缺少必要欄位 → 另標記 `governance:provenance-incomplete`。

Hook 只分類來源，不決定 Issue 是否合理、是否 blocking、優先順序或是否可關閉。這些仍依
`SCOUT → TRIAGE → BUILD → DIAGNOSE → AUDIT → CLOSEOUT` 與 Sol 閘門處理。

## 7. 不變的安全線

本裁示不新增任何 Production 權限。Production migration／DML、正式部署、真實付款、
退款與真實顧客通知仍需 Owner 明確授權。
