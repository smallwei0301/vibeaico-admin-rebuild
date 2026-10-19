# #755 Production DB release — 0137 create_tour_order_quoted Final Risk 載體

本檔只作為 `production-db-release-orchestrator` `mode=execute` 的 `final_risk_pr` 審查載體（G5），
不改任何程式、migration 或 workflow；Production DB 寫入仍只由既有 G6 writer 在 `production-db-writer`
Environment 內執行。

- Scope：`ISSUE_749_0137`（只含 `0137`；已套用前置 0110／0111／0128／0130／0132／0136 等須 EXACT）
- Trusted main：`0d56e74128ffb37c8665343830876903e3497051`
- Release：`issue755-0d56-s0137-20261019031547`（readiness 39193562785、G3 39193853052、collect 39200857784）
- 審查綁定：astra-review 的 `productionDbReleaseId`／`productionDbPlanDigest`／`productionDbEvidenceDigest`
  必須等於 collect bundle 的 plan 與 base packet（source／consistency／test／recovery）摘要
