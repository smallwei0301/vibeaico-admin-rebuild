# #755 Production DB release — 0131＋0134 原子化團次人員指派 Final Risk 載體

本檔只作為 `production-db-release-orchestrator` `mode=execute` 的 `final_risk_pr` 審查載體（G5），
不改任何程式、migration 或 workflow；Production DB 寫入仍只由既有 G6 writer 在 `production-db-writer`
Environment 內執行。

- Scope：`ISSUE_37_0131_0134`（0131_issue_37_atomic_departure_staff → 0134_issue_37_rpc_invoker_owner_compat；已套用前置 0066／0092 須 EXACT）
- Trusted main：`bf9a16d1d602cc0134dc6be598291b69b06ce26a`
- Release：`issue755-bf9a-s0131-0134-20261019073400`（readiness 39216734016、G3 39216811347、collect 39229906662）
- 審查綁定：astra-review 的 `productionDbReleaseId`／`productionDbPlanDigest`／`productionDbEvidenceDigest`
  必須等於 collect bundle 的 plan 與 base packet（source／consistency／test／recovery）摘要
- 本 PR 不預計合併；execute 完成後關閉。
