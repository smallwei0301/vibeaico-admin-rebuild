# Close-first TRIAGE 與全域 WIP lanes

> Owner 裁示日期：2026-08-31  
> 範圍：長程 `/goal`、多 Agent 派工、open Issue 收斂、PR／CI 排程  
> 性質：採用 close-first 與全域 WIP 的治理方向；不改產品規格、Production 邊界或既有授權

## 裁示理由

避免同時啟動多張大型 Issue 而累積 Draft PR、重複 CI 與 Sol 重讀。工作應先完成
最接近驗收與 close 的既有候選；重要性本身不足以讓明知依賴 Owner、外部人類或另一張
大型未完成工作者占用新的 BUILD 容量。

## 採用範圍

- TRIAGE 優先收斂可自主完成的既有工作，再選擇共享解阻塞項或新的中大型 BUILD。
- 全域 lanes、active-candidate 容量、PR metadata／labels、開工與 TEST 閘門、TRIAGE
  輸出欄位、Sol 使用邊界及效率量測，均以
  [AGENT-EXECUTION](../AGENT-EXECUTION.md) 為唯一 canonical 定義。
- `.github/workflows/agent-wip-lanes.yml` 只機械同步／驗證上述 canonical metadata；
  它不替代 Sol TRIAGE，亦不自行判定優先級或 close PR／Issue。
- 本裁示生效前未標記的 open PR 預設 parked；只有經 TRIAGE 明確升級後才取得 active
  工作資格。

## 例外與安全線

安全、跨租戶、資料損失、付款或真實通知的急迫風險，須由 Sol 記錄例外理由；例外不
授權開啟額外 Terra 或 TEST lane。本裁示不新增 Production migration／DML、正式部署、
真實付款、退款或顧客通知權限。

## 參考

- Canonical policy: [docs/AGENT-EXECUTION.md](../AGENT-EXECUTION.md)
- Execution adapter: [agent orchestration skill](../../.agents/skills/vibeaico-agent-orchestration/SKILL.md)
- Owner-decision index: [docs/OWNER-DECISIONS.md](../OWNER-DECISIONS.md)
