# Agent 控制訊號、WIP 上限與 Close-first 路由

> 日期：2026-08-31
>
> 狀態：Owner 已裁示

## 決策摘要

長程 `/goal` 改採下列固定工作量：

```text
1 條 TERRA_BUILD
1 條 LUNA_CLOSURE
1 條 TEST_VALIDATION
最多 2 張 ACTIVE_CANDIDATE PR
```

Sol 只在開工選題、模糊 CI／高風險設計與最後 AUDIT 介入。TRIAGE 必須先挑已有實作、
大多數測試已通過、只差一到兩個自主步驟的 Issue，不再同時開多張明知依賴大型題目、
Owner 或外部人類的 Draft PR。

## 為什麼

2026-08-31 早上的執行雖然比先前更會分類 TEST／CI 問題，仍同時推動多張中大型 Draft，
形成「4 Draft PR、0 Close」的漏斗。問題不是工程師完全沒產出，而是同時在製品太多：

- 每條 Terra 都要重新讀 code 與規格；
- 每張 PR 都可能觸發 CI 與 Sol 判讀；
- Closure Sweep 沒有固定席位；
- 重要但依賴未解的 Issue 會占著半成品位置。

因此這次不是要求模型「更努力」，而是限制同時開工數，讓半成品先出廠。

## Owner 控制訊號

Owner 重送 `/goal`、`/steer` 或「繼續」可能是切換模型速度、思考深度或角色，不能單憑
這些訊息判定前一位 agent 提早停止。

控制事件分為：

```text
OWNER_MODEL_SWITCH
OWNER_STEER
OWNER_CONTINUE
AGENT_PREMATURE_STOP
UNKNOWN_CONTROL_EVENT
```

只有前一位 assistant 明確終止，且當時仍有安全可施工工作，才算
`AGENT_PREMATURE_STOP`。只有 Owner 訊息的匯出檔不足以證明停工。

## 全域 lane

### TERRA_BUILD

- 全 repo 同時最多一條 active 中大型實作。
- 已有 active Terra 時，新題只能做唯讀調查或 park，不得另開 active 實作 PR。
- Owner 明確指定第二題時，Sol 先決定替換目前 lane 或 park 新題，不自動擴編。

### LUNA_CLOSURE

- 每輪固定保留一條，優先處理已有 PR／CI／證據的 Issue。
- 只掃 open PR、近期活動與前一輪高分候選，先限制在 5 個候選內。
- 找不到候選時回報 `EMPTY_WITH_SCAN`，不能把 Closure Sweep 挪去做新功能研究。
- 發現中大型 code 缺口時交回 Sol，不形成第二條 Terra。

### TEST_VALIDATION

- migration、reset、seed、integration、E2E 使用同一條共用 TEST lane。
- CI 的硬鎖仍是 `shared-test-supabase-integration`，`cancel-in-progress: false`。
- TEST 忙碌不等於全專案等待，Closure Sweep 與不碰 TEST 的 targeted work 繼續。

## Closeability 評分

```text
5  已在最終分支，只差證據／checkbox／close
4  只差一個小型自主步驟
3  已有 PR 與大多數測試，最多兩步可進 AUDIT
2  仍需明顯施工或多輪生命週期驗證
1  主要卡 Owner／外部／Production 或多個大型依賴
0  stale、duplicate、superseded 或不應 active
```

排序為：3～5 分無外部 blocker → 必要 dependency unlocker → P0／安全／資料損失 → 其他。
選擇低於 3 分時，若存在 3 分以上候選，Sol 必須寫 `WHY_NOT_CLOSER_CANDIDATE`。

## GitHub 可觀察護欄

### PR metadata

Agent-origin PR 必須填：

```text
WORK_ORIGIN
AGENT_LANE
LANE_STATE
ACTIVE_CANDIDATE
CLOSEABILITY_SCORE
SELECTION_REASON
REMAINING_AUTONOMOUS_STEPS
OWNER_OR_EXTERNAL_BLOCKER
CLOSURE_SWEEP_TARGET
TEST_LANE_REQUIRED
WHY_NOT_CLOSER_CANDIDATE
```

### WIP Hook

`.github/workflows/agent-wip-guard.yml` 在 PR 開啟、編輯、更新、轉 Draft／Ready 與關閉時：

- 驗證 metadata；
- 標記 lane 與 active／parked 狀態；
- 檢查 active Terra 不超過 1；
- 檢查 active Luna Closure 不超過 1；
- 檢查 active candidate 不超過 2；
- 要求 active Terra 同時指定 Closure Sweep target；
- 非 close-ready 選題要有「為何不先做較近候選」的理由。

Hook 只是一個號誌，不能證明實際模型、不能阻止 agent 在 PR 建立前亂開工，也不能取代
Sol。真正的開工前限制仍由 `docs/AGENT-EXECUTION.md` 與 orchestration skill 執行。

## Issue 來源

Agent 新開 Issue 必須使用 `AGENT_DISCOVERED` 表單與 Scope Firewall 理由。沒有標記的歷史
Issue 一律為 `owner-or-unknown`，不得按日期、建立帳號或語氣猜是 Agent 自行新增。

## 預期驗收

以接下來 10 個 Issue 為觀察窗：

- active Terra 峰值 = 1；
- active candidate 峰值 ≤ 2；
- 每輪有 Closure Sweep 結果；
- 一般 Issue 的 Sol 接觸 ≤ 2～3；
- 無效 CI 重跑 = 0；
- closed Issue 持續增加；
- 不再出現四張大型 Draft 同時施工、卻沒有 closeout 的常態。
