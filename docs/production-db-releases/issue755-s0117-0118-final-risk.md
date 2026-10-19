# #755 Production DB release — 0117 客服對話＋0118 平台贊助 Final Risk 載體

本檔只作為 `production-db-release-orchestrator` `mode=execute` 的 `final_risk_pr` 審查載體（G5），
不改任何程式、migration 或 workflow；Production DB 寫入仍只由既有 G6 writer 在 `production-db-writer`
Environment 內執行。

- Scope：`ISSUE_25_0117_0118`（0117_issue_25b_support_chat_threads → 0118_issue_25c_platform_donations；已套用前置 0001／0003 須 EXACT）
- Trusted main：`bf3e8d5e49880ae3b800b188fabf72d44d197da6`
- Release：`issue755-bf3e-s0117-0118-20261019121000`（readiness 39249977718、G3 39249981245、collect 39266034331）
- 審查綁定：astra-review 的 `productionDbReleaseId`／`productionDbPlanDigest`／`productionDbEvidenceDigest`
  必須等於 collect bundle 的 plan 與 base packet（source／consistency／test／recovery）摘要
- 本 PR 不預計合併；execute 完成後關閉。
