# Owner Decision — Final Risk 成本／速度／品質收斂 Phase 1 + 2

> 裁示日期：2026-09-16
> 追蹤 Issue：#533
> Workstream：`MODEL_GOVERNANCE`

## 1. 三條不可違反的原則

1. **讓失敗提早發生。** 能由 deterministic preflight（機械式前置檢查）發現的問題，不得等昂貴 reviewer 或 remote CI 才第一次發現。
2. **讓失敗代價變小。** metadata、來源凍結、digest、測試基線、scope 等準備工作先完成，才啟動 Final Risk reviewer。
3. **熔斷不能等於整個 loop 停機。** 同一路徑反覆出錯時停止燒同一種成本，但改走替代 reviewer、park 當前 candidate、refill independent BUILD、Closure／TRIAGE 等安全工作。

本決策不降低 Product Final Risk、shared canonical TEST、branch protection、Production DB gate 或 Completion Truth。

## 2. Phase 1：昂貴 reviewer 前先過 readiness gate

Product 高風險 candidate 在委派 Fable／Astra 前，必須先證明：

- PR metadata 已過現行 `agent-wip-preflight`；
- source 已 frozen，不再邊審邊改；
- exact head 與 changed-file inventory 完整；
- `changeDigest` 可由 changed-file blob 重算且一致；
- source CI、必要測試、核心 regression（回歸測試）均已 PASS；
- test/schema baseline 具體存在；
- reviewer packet 未超過 bounded context 預算。

任一條不成立，狀態是 `NOT_READY → RETURN_TO_PRECHECK`。這不是 Final Risk failure，也不消耗 reviewer round。

## 3. Reviewer packet：先整理病歷，再叫專科醫師

昂貴 reviewer 預設只收到 bounded packet：

- repository／PR／exact head／changeDigest；
- risk class／policy version；
- test/schema baseline；
- changed-file 名稱與 evidence references；
- 最多 30 行 TRIAGE 摘要；
- FULL 或 DELTA 所需的最小 scope。

reviewer 仍可按風險自行讀必要 patch、執行 adversarial test（對抗測試）或要求 FULL reset；packet 只是減少重複蒐集，不限制 reviewer 的安全判斷。

Final Risk 的工作仍是 concurrency、tenant boundary、rollback、permission bypass、fake-success、negative control 等正交風險，不是重新朗讀一般 CI。

## 4. Phase 2：FULL 第一次，finding 修復可用 DELTA

第一次 semantic Final Risk 一律 `FULL`。

若 FULL review 回 `FIX_REQUIRED`／`CHANGES_REQUESTED`，修復後只有同時滿足以下條件才可 `DELTA`：

- risk class 不變；
- Final Risk policy version 不變；
- current changed-file universe 沒增加新檔；
- 沒擴大 payment/auth/schema/provider 等 high-risk boundary；
- delta 由前後兩輪 changed-file blob 自動計算，而且只落在前一輪 reviewer 明確 finding paths／support files；
- core regression 全部重新 PASS；
- reviewer 沒要求 FULL reset。

任何一條失敗就 `FULL_RESET_REQUIRED`，不是硬擠進 DELTA。

DELTA **不是沿用舊 PASS**。它仍由 allowlisted Final Risk model 對新的 current `changeDigest` 做真正審查，並提交新的 trusted verdict。現有 merge admission gate 完全不變。

若 previous PASS 的 semantic `changeDigest` 完全沒變，沿用現行規則直接 reuse semantic attestation，僅重跑 exact-head CI；不再重新召喚 reviewer。

### 4.1 DELTA 證據必須可跨 Session 重建

不能靠「上一個 Agent 還記得它審過哪些檔案」。canonical GitHub `astra-review` JSON 除既有 merge-gate 欄位外，還要保存：

- `riskClass`；
- reviewer packet 原樣的 `changedFileRecords`（含 filename / previous_filename / status / blob sha）；
- blocking finding 的 `findingDetails`，至少含穩定 id、實際 paths、summary；
- 必要唯讀相關檔 `supportFiles`。

既有 `findings` 人類可讀字串仍保留，不改現有 Final Risk gate 契約。下一輪 `prepare` 從 live GitHub reviews 取**最新** trusted review 重建 previous state，不信 Session memory；最新 review 的模型身分、manifest、structured finding paths 或 digest 有缺漏時，fail closed 回 FULL，而且不得跳去較舊 PASS 偷渡。

這個設計讓 DELTA 是「可重建的省成本」，不是「只有同一個長對話才省得到」。

## 5. 熔斷與替代路徑

對 tooling／environment／model dispatch／rate limit／timeout／safety classifier 類錯誤：

```text
第 1 次同類失敗
→ RETRY_SAME_MODEL_ONCE

第 2 次同類失敗
→ current reviewer model 熔斷
→ allowlist 尚有另一模型：SWITCH_REVIEWER_MODEL

所有 allowlisted reviewer 都暫時不可用
→ 當前高風險 candidate 保持 blocked／parked
→ 有 independent Product slice：PARK_CURRENT_AND_REFILL_BUILD
→ 沒有：PARK_CURRENT_AND_CONTINUE_CLOSURE_TRIAGE
```

因此 breaker（熔斷器）保護的是「不要一直撞同一扇門」，不是「把整間工廠斷電」。

真正 reviewer finding 不算 infrastructure failure：直接 `RETURN_TO_SOURCE_FIX`，修完再依 FULL／DELTA eligibility 決定下一輪。

readiness／invalid input／packet budget 問題也不消耗 reviewer retry：直接 `RETURN_TO_PRECHECK`。

## 6. Context 預算

為避免 TRIAGE／reviewer 自動展開整個 repo：

- TRIAGE summary：最多 30 行、6000 字；
- reviewer changed-file scope：最多 40 檔；
- DELTA files：最多 20 檔；
- evidence refs：最多 30；
- previous structured findings：最多 20。

超過不是截斷後假裝完整，而是 fail early，要求縮小 scope 或重新整理 manifest。未知資訊不得補成 PASS。

## 7. 不做的事

本決策不：

- 自動把 Final Risk verdict 變成 PASS；
- 放寬 `scripts/agents/astra-review-policy.mjs` 的 trusted attestation／changeDigest gate；
- 讓 DELTA reviewer 跳過核心 regression；
- 因 breaker 打開就允許 merge blocked candidate；
- 因 breaker 打開就停止其他安全、獨立工作；
- 修改 Product runtime、schema、payment、LINE/provider 或正式部署行為。

## 8. 成功指標

未來至少觀察三輪 Product Run：

- weighted usage / delivery unit 是否下降；
- metadata／tooling invalid rerun 是否下降；
- Final Risk pure-churn round 是否下降；
- Final Risk substantive finding yield 不得惡化；
- P0/P1 regression／Production incident 不得增加；
- cycle time 應下降，但不能用降低安全門檻換速度。

目前 repo 已有 usage／quality Scorecard；本決策不另建第四套計分制度，只新增上述 raw event／routing outcome 的可觀測性。
