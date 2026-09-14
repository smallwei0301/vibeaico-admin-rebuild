# Owner Decision：正式資料庫由逐次人工核准改為條件式放行

> 裁示日期：2026-09-14
> 政策版本：2026-09-14.1
> 狀態：Owner 已要求此政策變更；正式 repo 規則須經正常 PR 合併 main 後生效。
> 工作分類：MODEL_GOVERNANCE（本次只改政策文件，不執行資料庫或發布工作）

## 裁示與目的

Owner 要求取消 Production 套用資料庫前逐次人工同意，改由資料庫一致性、真實測試、
高風險審查與其他明確檢查共同決定放行，並委託 Agent 制定流程與更新執行規則。

採用有界的 `POLICY_GATED` 長期授權：只有
`smallwei0301/vibeaico-admin-rebuild` 的正式庫 `egehnijjpgijmccagxac`，
且完整符合 `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md` 的允許範圍及 G0–G7 契約。
`PER_RUN_OWNER_APPROVAL=NOT_REQUIRED`；沒有任何一關可以用人工「同意」代替。
一致性不是把 TEST 資料複製到正式庫；需要辨認精確預期待套用差異，並擋住所有未解釋差異。
所有正式庫寫入都要求真實的允許模型高風險審查，不沿用純治理免 Final Risk 的例外。

## 精確取代範圍

只取代舊文件中「本政策涵蓋的 Production DB 操作，必須另向 Owner 逐次具名授權」。
這包含 `AGENTS.md`、`CLAUDE.md`、`docs/AGENT-EXECUTION.md`、
`docs/MODEL-ROUTING.md`、`docs/SCHEMA-TRUTH-GOVERNANCE.md`、
`docs/DELIVERY-CHAIN.md` 及舊 decision 對該授權方式的敘述；依文件治理衝突順位採本次新裁示。
舊次別的操作紀錄、審查結果及曾經取得的授權不改寫，也不批次更動任何既有 Issue 狀態。

#197／2026-09-14 的「canonical migration 必須先進 current main 才能套遠端」維持。
為避免先測才能合併、先合併才能測的循環，允許嚴格分開資料庫準備與功能啟用；
只調整純資料庫準備的 source merge 與遠端驗收順序，不免除必要 source checks、review 或真正 TEST。
具體入口與先後順序收斂在 `docs/AGENT-EXECUTION.md` §3.2 及工作流程 §2。

不取代：分支／環境／工具安全保護、產品模型分工、可信模型證據、TEST 唯一持有者、
秘密保護、真實付款／退款／顧客通知／LINE、網站發布／流量切換的各別規則。
不授權 tour-platform 資料庫；不授權災難性刪除、正式庫 reset／seed 或不可復原資料變更。

## 規則與實作分開

此裁示不證明自動 apply workflow 已實作，不把既有 observer 的
`authorizesDatabaseWrite=false` 改成授權，也不建立生產憑證或排程。
正式庫寫入必須等完整受控執行器及其正反例證據成立，否則記 `IMPLEMENTATION_BLOCKED`。
缺審查、備份、證據或工具時，用精確技術阻塞分類；不得把人工批准重新列為通過條件。
執行器、憑證邊界與發布接線另外依 `PRODUCT_MAINLINE` 完成，不在文件 PR 偷渡。

## 落地位置

- `docs/AGENT-EXECUTION.md`：日常入口、授權表、必要放行條件。
- `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`：唯一詳細工作流程與自動化驗收契約。
- `docs/OWNER-DECISIONS.md`：決策索引，歷史不改寫。
