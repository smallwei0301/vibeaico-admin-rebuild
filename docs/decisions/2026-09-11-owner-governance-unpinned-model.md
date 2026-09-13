# Owner Decision：MODEL_GOVERNANCE 不指定執行模型

日期：2026-09-11（Asia/Taipei）
Issue：#360
WORKSTREAM: MODEL_GOVERNANCE

## Owner 決定

Owner：「那這樣，直接把模型治理工作流中的指定模型拿掉」。

純模型治理改為由目前可用模型直接完成 TRIAGE → IMPLEMENT → VERIFY → REVIEW → CLOSEOUT。
取消 Sol／Opus-only、audit-tier-only、指定 executor model 與允許模型清單；不再以模型執行回執或 actual=unknown 單獨阻擋開工、PR 或合併。

本決策在 MODEL_GOVERNANCE 執行模型議題上，取代 2026-09-10 的 two-workstream-sol-governance／governance-audit-tier-models 決策及較舊文件中的指定模型措辭。歷史文件與歷史執行紀錄保留，不能據此改寫先前的 actual。

## 真實性與必要驗證不變

- 沿用 `REQUESTED_MODEL / ACTUAL_MODEL` 作紀錄：未指定填 `requested=not_requested`；actual 無可靠來源填 `unknown`。有真實指定／執行資訊才填具體型號。
- 不因取消門禁把 UNKNOWN 升成 PROVIDER_VERIFIED 或 OPERATOR_ATTESTED，不偽造模型、測試、review 或 token 用量。
- 保留工作流、GOVERNANCE lane、實際 changed files、範圍預算與單一 active implementation。
- 保留 source CI、必要單元與反例測試、最終 diff 審查、合併後 main／Issue 回讀。治理主 Session 可完成結案，不另要求指定模型 reviewer。
- 純治理仍為 `ASTRA_RISK: NONE`、`FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY`。
- 不占用 Product Terra／Reserve／shared TEST lane；這是車道隔離，不是模型型號限制。

## Product 邊界不變

PRODUCT_MAINLINE 的模型分工、Final Risk allowlist、trusted reviewer、政策版本、必要測試與 Production 授權維持原規則。

含 Product runtime、schema/migration、付款、退款、LINE/provider、tenant data flow 或部署行為的變更，先拆 PR；無法拆分則歸 PRODUCT_MAINLINE，不能使用治理豁免。

本決策不授權修改分支保護、偽造 status／review、未驗證 merge、Production 操作或真實顧客通知。trusted-main 舊模型檢查若仍阻擋這個政策 PR，必須如實記錄新舊政策的啟動銜接，不得填假的 Sol／Opus 身分。

## 既有工作收斂

- #359：原生模型收集器不是治理開工／合併前置，只可列為非阻塞觀測改良；不再為它要求 Owner 提供模型 API key。
- #354：舊模型 membership 解析器在本政策實作中移除。合併後按 superseded 核對，保留原候選分支／測試歷史，不把舊模型白名單測試套到新政策。
- #347：Markdown metadata 容器／重複欄位的獨立問題仍保留，不夾帶進本次變更。

機器設定以 `scripts/agents/model-routing.json` 為準，執行方式回併 `docs/MODEL-ROUTING.md` 與 orchestration skill。本文件是決策紀錄，不是本次模型執行證明。
