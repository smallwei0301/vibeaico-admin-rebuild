# 模型分工與 Astra 最後風險評估

Owner 於 2026-09-07 授權依治理提案實作；追蹤 #209。
模型 ID、風險代碼及保守路徑底線只維護在 `scripts/agents/model-routing.json`。
本規則不改變既有 TEST 排隊、Sol 結案權限或 Production 授權。

## 路由

Luna 窄盤點 → Sol 選題／風險分類 → Terra 施工 → 必要測試與 Sol 審核 →
僅高風險交 Astra 最後評估 → Sol 結案判定 → 核實外部結果。

- 一般文案、UI、小型接線不強制 Astra；一般 DB 接線也不因碰 DB 就升級。
- PAYMENT_CONSISTENCY：付款、退款、名額及重複請求的一致性，包括單一 repo。
- TENANT_AUTH_BOUNDARY：跨店讀寫、登入、權限與秘密保護邊界。
- IRREVERSIBLE_DATA：有資料損失風險、難以復原的資料變更。
- CROSS_REPO_CONTRACT：前後台的重要預約／訂單／付款契約。
- GOVERNANCE_GATE：放行條件、模型路由、證據判定或權限門禁變更。
- UNRESOLVED_HIGH_RISK：Sol 已查證仍無法裁決的重大疑點。

Sol 在開工時填 ASTRA_RISK 與具體 ASTRA_RATIONALE。實際 changed files（含 rename 前後路徑）
命中設定內敏感路徑時，不能用 NONE 降級。路徑底線並非完整語意分析；其他位置的高風險仍須申報。
預設每個證據版本一次最後評估，不設可讓必要風險審核被跳過的配額。
Astra 不可用、模型無法確認或證據缺漏時保留 ASTRA_PENDING，继续可安全工作，不能代填通過。

## 技能與事前檢查

高風險工作載入 `.agents/skills/vibeaico-astra-review/SKILL.md`。
所有新 PR 在建立前使用既有 `agent-wip-preflight.mjs --body <file> --changed-files <file>`；
CLI 會檢查分類及實際檔案清單，建立 PR 不要求尚未完成的最終評估。
`validateWipPreflight` 函式的旧呼叫者保持相容；需要路由檢查時明確設 `requireAstraClassification=true`。

## 最後評估的證據

操作者確認確實呼叫設定中的 Astra 並取得結果後，將報告保存於 GitHub，然後在候選 PR
提交一筆 COMMENT review（審核紀錄），使用下列 JSON 格式。不得只填 PR body 的 PASS。

```astra-review
{
  "repository": "smallwei0301/vibeaico-admin-rebuild",
  "baseSha": "完整40碼基底版本",
  "headSha": "完整40碼候選版本",
  "policyVersion": "2026-09-07.1",
  "testBaseline": "與PR ASTRA_TEST_BASELINE完全一致的測試證據及環境版本",
  "schemaBaseline": "與PR ASTRA_SCHEMA_BASELINE完全一致的資料庫版本或不適用理由",
  "requestedModel": "gpt-6-astra",
  "actualModel": "gpt-6-astra",
  "identityEvidence": "OPERATOR_ATTESTED",
  "verdict": "PASS",
  "report": "https://github.com/組織/專案/議題或審核報告連結",
  "findings": "具體審核結論、已驗證事項及剩餘限制"
}
```

缺實際模型證據不能使用 OPERATOR_ATTESTED。GitHub 只能核對具 write／maintain／admin
權限操作人的背書，**不能獨立證明模型身份**；不可稱為供應商簽章證明。
檢查器使用 GitHub review 的 commit_id、狀態與操作者權限，不信任 PR 自填的 trusted 欄位。
同一候選以最新可信評估為準；後續要求修正／撤銷／不通過會撤回先前通過。
程式、base、政策、測試或 schema 基線變更即失效；修正涉及共同前提或範圍不明時擴大重審。
環境變更需更新 PR 的基線並重新評估；本 Hook 不會自行監控遠端資料庫變動。

## 可信執行與啟用

WIP Guard 一律 checkout 預設分支，既有 `Agent WIP Policy` 加入最後評估結果。
不執行 PR 的程式、不從 PR 載入路由設定、不把 PR 自填報告當可信審核。
Pending Astra 不阻擋收集 TEST 證據，但 policy status 保持 failure。
PR 更新時重新判斷。提交／編輯／撤銷 review 後，具寫入權限操作者必須留言
`/astra-review-check` 觸發可信預設分支 workflow；review 事件本身不直接執行特權 workflow。
在重新檢查前舊 status 可能存在，故合併前必須主動刷新；不得宣稱即時自動撤回。主分支前進後，合併前須再檢查
base、證據與最新 policy，必要時更新 PR 觸發既有事件。不要製造 no-op commit。

初次安裝本規則的 PR 仍由舊 main 檢查器執行，須附獨立 Sol 與 Astra 評估作為一次性導入證據；
不能宣稱它已受尚未合併的新門禁保護。真正阻止合併仍依 GitHub ruleset 要求
`Agent WIP Policy` 狀態；未驗證 ruleset 時只能聲稱會產生檢查結果，不能聲稱不可繞過。

## 本輪驗證教訓

技能正常升版不應被無關的固定版本字串擋住；複盤測試仍驗證 Gmail 證據先於評分、
全文讀取、無法讀取時的誠實標記等行為，只把版本格式與具體版號分開。
