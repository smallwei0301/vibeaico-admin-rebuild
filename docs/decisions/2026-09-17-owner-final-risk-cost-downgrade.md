# Owner Decision: Final Risk 單次昂貴諮詢與降級對抗審查

> 日期：2026-09-17；Issue：#552；WORKSTREAM：MODEL_GOVERNANCE。
> Owner 已接受降級風險，因昂貴模型反覆諮詢造成成本超支，明確授權本政策。
> 本文件取代 #533 的同級重試、Astra/Fable 互換及修復後再次昂貴諮詢規則。

## 1. 預算與適用範圍

同一 Issue／release 工作鏈（reviewLineage）總共最多一次 Astra/Fable 昂貴諮詢，不是各一次。
在既有 runtime 中使用 model selector，不搜尋外部 Astra plugin。不更改 Product 施工層級。
已經諮詢或派送過的在途工作也適用；新 head、新 digest、rebase、換 Session 或替代 PR 不重置預算。
開始前回讀 canonical reviews、原 Issue 與替代 PR 的派送／執行紀錄，保留永久 evidence reference。
歷史不明時優先降級，不能把 unknown 當成「還沒用過」。不得改寫舊使用量或把先前失敗清成零。

`final-risk-workflow.mjs prepare` 的 `RESERVE_ONE_PREMIUM_CONSULTATION` **不是直接派送許可**：
先在同一 lineage 的持久帳本／Issue 記錄唯一的 requestedAt、executionRef、requestedModel，
回讀確認預算已占用，才可派送；沿用 Final Risk 單線，禁止兩個代理同時預約同一預算。
排隊後只能觀察同一 executionRef，不再新建另一個昂貴子代理。無法保存預算證據就直接降級。

## 2. Timeout 的精確定義

起點為 runtime 收到 dispatch request 的 UTC `requestedAt`，上限 **300 秒**。
300 秒前沒有執行證據可繼續觀察原任務；到 300 秒仍沒有合格證據就 `START_TIMEOUT` 並降級。
合格證據必須具有同一 executionRef、時間、來源引用，以及 runtime 的 RUNNING、TOKEN_GENERATED
或 TOOL_EXECUTED 事件。QUEUED／ACCEPTED、主代理文字自述、工具已送出但沒有執行紀錄都不算。
時間缺漏／不合法、未來證據、不同 task id、超過期限才開始執行，都不能延長昂貴等待。
五分鐘是「尚無實際執行證據」期限，**不是總審查限時**；期限內已證明執行可以完成那唯一一輪。
明確派送失敗／無回應／環境不支援切換時不用再等 300 秒，直接降級；不做同級 retry。
降級前取消或隔離原在途任務（runtime 支援時），保存原紀錄；不要讓昂貴任務在旁繼續重跑。

## 3. 降級順序

- 第一次昂貴諮詢提出 finding：回 source fix，修復後直接 Sol／Opus 對抗重審。
- 已派送但無回應、timeout、模型不可用：直接 Sol／Opus，不再 Fable↔Astra。
- Sol：`gpt-5.6-sol`；Opus：`claude-opus-5`，依 runtime 可選型號選擇。
- runtime 無 model selector：目前 agent/model 做對抗審查，明記非獨立指定模型。
- 便宜 reviewer 也不可用：park 當前候選，繼續獨立 BUILD／Closure／TRIAGE，不自動 PASS。
- 真正安全拒絕不是模型故障，不得改派來繞過安全限制。

scope 的 FULL／DELTA 仍依 #533 檢查；FULL reset 不會恢復昂貴預算。
已有同 digest 的有效 PASS 仍可 reuse，不為政策成本版本更新硬叫模型重審。

## 4. WIP 與發布 gate 的共同證據契約

`models.finalRiskAllowedModels` 保留第一輪昂貴模型；`finalRiskDowngradeAllowedModels` 為 Sol／Opus。
CURRENT_AGENT 是受條件限制的執行模式，不是把所有模型加入全域 allowlist。
共用 `final-risk-cost-policy.mjs` 驗證器；WIP/semantic reuse 與 DB release 不再各自維護矛盾模型門禁。
既有 ASTRA_*／ASTRA_APPROVED 名稱只為歷史相容，不能因此宣稱實際用了 Astra。

降級 canonical astra-review 除既有 repository、digest、policy、TEST/schema、PASS/FIX_REQUIRED、report
與可信提交者外，保存：reviewerTier、costPolicyVersion、downgradeReason、downgradeEvidenceRef、
reviewLineage、executionRef、adversarialEvidence、priorFindingsReviewed、unresolvedFindingCount。
AUDIT 必須 requestedModel=actualModel 為 Sol／Opus，identityEvidence=OPERATOR_ATTESTED。
CURRENT_AGENT 必須 modelSelectionAvailable=false、requestedModel=not_requested、
executionEvidence=OPERATOR_ATTESTED；不知道型號就 actualModel=unknown、identityEvidence=UNKNOWN。
知道型號才如實背書，禁止把目前模型重新命名成 Sol、Astra 或 Fable。

adversarialEvidence 要能查到真實反例／負向測試、先前 finding 的逐項修復與未驗證界線，
不能只寫「我同意」。未解 finding 不得為零，未解即 FIX_REQUIRED；修復後要對新 digest 重新審查。
原有 trusted actor、來源凍結、CI／必要 TEST、最新否決、digest/基線與 Production 授權都保留。
資料庫發布仍須自己的 release plan/evidence 綁定；source PR 的 PASS 不直接變成 DB 操作許可。

WIP candidate=3、BUILD=2、shared TEST=1、Final Risk/merge 單線不變。降級不占新 BUILD slot；
source fix 前仍須從 AUDIT_READY 回 IN_PROGRESS 及重新取得合法施工位置。

## 5. 驗證與版本

`finalRiskCostControl.version=2026-09-17.1` 是獨立的成本／降級契約版本。
不更改既有 semantic digest 版本，不使內容未變的既有可信 premium PASS 全部失效。
測試覆蓋 299/300 秒、queued/錯 task/壞時間、已諮詢修復重審、不能選模型、未知身分、假降級、
未解 finding、stale digest、可信作者及 DB release 不授予寫入權限。
