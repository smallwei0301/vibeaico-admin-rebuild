# Owner Decision：Production DB 改採 Machine Policy Gate，分階段啟用

> 裁示日期：2026-09-14
> 狀態：DECIDED
> 啟用狀態：`POLICY_APPROVED_AUTOMATION_PENDING`
> 目標狀態：`POLICY_GATED_ACTIVE`

## 裁示

Owner 要求本 repo 的 Production DB release 不再永久依賴每次人工「同意套用」，避免人工漏判、誤判與重複等待。
最終授權模式改為 machine-verifiable policy gate：資料庫一致性、真實 TEST、備份/復原、Production Final Risk、唯一 writer lock、
exact pending-set、post-apply readback 等技術關卡全數成立後，受控 writer 可自主執行，不需逐次 Owner approval。

但政策與 executor 必須安全分階段 rollout：

1. 本裁示與 workflow 先經正常 PR / required CI 進 `main`；
2. read-only evidence / preflight、backup observer、Final Risk adapter、writer lock、controlled writer、postcheck 依正常 PR 建置驗證；
3. 在 executable policy 尚未證明 `AUTOMATION_READY=true` 前，現行逐次 Production DB Owner gate 暫時保留，避免文件先解除保護、writer 還沒接好；
4. 當 trusted-main executable policy 同時產生：
   `AUTOMATION_READY=true` 與 `PRODUCTION_DB_AUTHORIZATION_MODE=POLICY_GATED_ACTIVE`，
   本 workflow 範圍內自動切為 `PER_RUN_OWNER_APPROVAL=NOT_REQUIRED`，**不需要 Owner 再做第二次人工啟用裁示**。

這個 bootstrap gate 是暫時安全條件，不是永久人工流程。

## 平衡原則

安全 gate 必須 risk-adaptive，避免正常工程進度被不相關檢查卡死：

- `ADDITIVE` migration：走共同 G0–G7，不額外強迫 AUTHZ / BACKFILL 專屬測試；
- `AUTHZ`：才加 tenant boundary、非法角色與跨租戶負向測試；
- `BACKFILL`：才加 preimage backup、row cap、批次與並行寫入保護；
- destructive / unknown：v1 不用人工特批硬過，改成可逆的 expand → migrate → contract。

無關 main 前進不使所有昂貴證據失效；只有 source/plan/relevant schema/risk-policy digest 改變才重跑語意審查。
Final Risk 在 plan/source/relevant state 不變時可依 canonical workflow 的有效期重用；G6 live state 永遠重新查證。

一致性判準是 **unexplained drift = 0**，不是要求 TEST 與 Production 所有 surface 永遠 differenceCount=0。
Production 可以只差本次精確 planned pending diff，或保有已審查且綁 fingerprint / Issue / expiry 的 intentional difference。

## 適用範圍

- repo：`smallwei0301/vibeaico-admin-rebuild`
- Production Supabase：`egehnijjpgijmccagxac`
- canonical TEST：`nmwhwngojosmagjuvxol`
- 詳細流程：`docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`
- 日常入口：`docs/AGENT-EXECUTION.md` §3.2

最終 ACTIVE 後可自主執行的 v1 範圍：向後相容 migration、明確結構/ACL/RLS 修復、可恢復且有界的非金流 backfill。

不在 v1：Production reset/seed、drop/truncate、不可逆 destructive data change、真實 payment/refund/order fact mutation、
customer notification/LINE switch、Vercel Production promote/rollback/traffic、其他 Supabase project、`tour-platform` Production DB。

## Canonical source 與既有安全規則

#197 / 2026-09-14「遠端 schema 只能使用 current main canonical migration」維持。
Branch-only migration、open PR、local overlay、TEST/Production live state 都不能單獨成為 execution authority。

為解除「未合併不能 TEST、沒 TEST 又不該啟用 runtime」的循環，新 schema 採 database preparation / feature activation 分段：
純 schema preparation 先經 source review/isolated proof 合併 main，再進 canonical TEST / Production gate；依賴新 schema 的 runtime 必須等 `PRODUCTION_SCHEMA_READY` 後才啟用。

## 取代關係

本裁示一旦進 main，取代舊文件對「未來 workflow 仍永久要求逐次 Owner Production DB approval」的政策方向；
但在 `AUTOMATION_READY` 尚未由 trusted-main executable policy 證明之前，舊逐次 gate 作為 bootstrap safety 仍有效。

歷史逐次授權紀錄不改寫。MODEL_GOVERNANCE model-agnostic #360 不適用於 Production DB Final Risk；正式庫寫入仍必須有 allowlisted reviewer 的可信執行證據。

## Completion Truth

文件合併不代表 automation ready，更不代表 Production DB 已獲得 writer access。
在 full gate / writer / backup / lock / postcheck 未完成前，狀態只能是 `IMPLEMENTATION_BLOCKED` 或 `AUTOMATION_PENDING`，不能宣稱已取消現行 runtime safety。
