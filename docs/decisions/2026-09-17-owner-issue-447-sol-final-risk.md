# Owner decision: Issue #447 使用目前 Sol 完成 Final Risk

> 2026-09-17 #552 後續裁示：以下「暫時 global allowlist／#447 closeout 撤回 Sol」已由
> `2026-09-17-owner-final-risk-cost-downgrade.md` 的全專案條件式降級取代。
> #447 可繼續真實 Sol 對抗審查，使用 AUDIT 證據欄位；不撤回永久降級能力、不再昂貴諮詢。
> 本文其餘具體反例優先與不擴張 Production 授權的原則保留。下列暫時機制僅作歷史紀錄。

日期：2026-09-17

## 決策

Issue #447 已在 Production DB controlled-writer / automation-ready 路線投入過多 reviewer dispatch、重複 exact-head 驗證與防禦性 hardening 成本。Owner 決定：

- #447 後續不再要求 `claude-fable-5-1` / `gpt-6-astra` 才能完成 Final Risk。
- 允許目前 OpenAI audit 層模型 `gpt-5.6-sol` 對 #447 bounded PR 做直接 adversarial review。
- `gpt-5.6-sol` 暫時加入 `models.finalRiskModelCatalog` 與 `models.finalRiskAllowedModels`，但預設 `models.finalRisk` 仍維持 `claude-fable-5-1`。
- 這是 #447 收尾期間的暫時 Owner 決策；#447 closeout 後必須把 `gpt-5.6-sol` 從 Product Final Risk allowlist 撤回。
- 不得把 Sol review 偽裝成 Astra/Fable。`requestedModel` / `actualModel` 必須如實記為 `gpt-5.6-sol`。

## 驗收標準

Sol adversarial review 只把下列情況視為 blocking finding：

1. 能提出具體可重建的攻擊或故障反例；
2. 反例會跨越目前 Writer admission / project identity / role privilege / transaction / lock / replay / APPLY_UNKNOWN / postcheck 邊界；
3. 現有 exact-head CI、LOCAL_ISOLATED、Production read-only proof 或 counterexample tests 沒有覆蓋該反例。

純粹「還可以再更安全」、沒有可利用反例的 defense-in-depth 建議，不再阻擋 #447。

## 過度防禦檢討

本輪已確認出現過度防禦訊號：

- 原 #455 累積 63 changed files，之後為 reviewer packet 上限再拆成多層 stack；
- 同一語意邊界多次重跑完整 LOCAL_ISOLATED / E2E；
- reviewer dispatch 本身成為主要 liveness blocker；
- 在核心安全性已經由 project-bound writer、NOLOGIN owner、NOINHERIT、exact-main、migration-byte digest、single-use receipt、advisory lock、post-lock fingerprint、rollback / timeout / disconnect、G7 readback 等多層機制覆蓋後，仍持續擴張防禦面。

後續原則：先證明「存在具體未覆蓋反例」再新增 hardening，不再因抽象風險無限追加 gate。

## 不變的安全邊界

此決策只替換 Final Risk reviewer model，不構成 Production DDL/DML/migration 授權，也不放寬：

- `PRODUCTION_DB_WRITER_URL` 專用 Writer credential；
- Classic/broad PAT 禁用；
- `postgres` 管理帳號不得作 automated writer；
- exact-main / exact migration bytes；
- TEST / recovery / release evidence；
- advisory lock / transaction / `APPLY_UNKNOWN` / G7 readback；
- 第一次正式 Production apply 的既有 admission。
