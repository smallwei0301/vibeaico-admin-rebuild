# 模型分工與 Astra 最後風險評估

Owner 於 2026-09-07 授權依治理提案實作；追蹤 #209。
模型 ID、風險代碼、Final Risk Agent trust root 與保守路徑底線只維護在
`scripts/agents/model-routing.json`。本規則不改變既有 TEST 排隊、Sol 結案權限或
Production 授權。

2026-09-10 Owner 依 Final Risk 實際 finding yield / review cost 收斂路由，詳見
`docs/decisions/2026-09-10-owner-final-risk-roi-routing.md`。核心原則是保留高後果 Final Risk，
但不再因「治理」兩字把純 fail-closed hardening 自動升級；同時明定 Astra/Fable 是 reviewer
**模型選擇**，不是外部 plugin／connector／reviewer channel。

2026-09-10 #335 再補一層 Agent-native trust：正常高風險 Agent PR 可以由 trusted-main
明確 allowlist 的 Agent bot 自己提交 Final Risk evidence 並刷新 gate，**Owner action NOT_REQUIRED**。
這不是信任所有 bot，也不是取消 branch protection；GitHub 原生 required status 仍保留
`Agent WIP Policy` 與 `check`。

### 最後風險 gate 的生命週期

Final Risk 是合併前的風險 gate，不是讓停泊中的 PR 持續輪詢模型的活性檢查。Draft、`PARKED`、
`COMPLETE`、`OWNER_BLOCKED`、`HISTORICAL` 與 `READY_FOR_PROMOTION` 只會延後 Final Risk；
它們不代表已通過，也不會清除既有 metadata、CI 或 WIP 錯誤。此時 `Agent WIP Policy` 保持
`pending`，絕不寫成 success 或 approval。當 PR 回到 active 且非 Draft 的可合併流程時，
原本的高風險分類、`changeDigest`、基線與真實模型證據要求全部恢復。未知 lane state 仍 fail closed。

> **2026-09-08 Owner 裁示：最後風險評估的預設模型改為 Fable（`claude-fable-5-1`）；
> 現行 allowlist 另允許 Astra（`gpt-6-astra`）。**
>
> 「Astra」在本文與 `ASTRA_*` 欄位名中保留為這道關卡的名稱；`models.finalRisk` 是預設模型，
> `models.finalRiskModelCatalog` 是支援的模型身分，guard 只接受其中的
> `models.finalRiskAllowedModels` 子集。現行兩份清單都為 `gpt-6-astra` 與
> `claude-fable-5-1`，且 `requestedModel` 與 `actualModel` 必須是同一個允許模型。

## 路由

Luna 窄盤點 → Sol 選題／風險分類 → Terra 施工 → 必要測試與 Sol 審核 →
僅高風險交 Astra/Fable 最後評估 → Sol 結案判定 → 核實外部結果。

### Lane 對應的模型層級（Owner 2026-09-10 裁示）

`Luna / Terra / Sol` 是**工作層級**的名字，不是廠牌。同一條鏈在兩側各自對應：

| Lane | 職責 | OpenAI | Anthropic |
|---|---|---|---|
| `scout` / Luna | 盤點 | `gpt-5.6-luna` | `claude-haiku-4-5` |
| `build` / Terra | **施工** | `gpt-5.6-terra` | **`claude-sonnet-5`** |
| `audit` / Sol | 審核 | `gpt-5.6-sol` | `claude-opus-5` |

機器可讀的來源是 `scripts/agents/model-routing.json` 的 `anthropicEquivalents`；本表與它必須一致。
model ID 逐字取自 Anthropic 官方型號表，**本身即完整，不得附加日期後綴**。

**Terra 一律用 Sonnet。** 拿 audit 層的 Opus 去施工是超規，不是謹慎——它把審核層的成本花在施工上，
並且讓審核層去審自己的產出；拿 scout 層的 Haiku 去施工則是不足。兩個方向都不由執行者自行裁量。

因此 `AGENT_LANE: TERRA_BUILD` 的 PR，其 `REQUESTED_MODEL / ACTUAL_MODEL` 必須宣告 build 層級的模型。
`actual=Opus 5` 出現在 `TERRA_BUILD` 上是路由違規，應如實記為違規，不是中性註記。

本節與下方 Final Risk 閘門彼此獨立：不論由哪一層施工，高風險變更的最終評估都必須委派
`claude-fable-5-1`；施工層正確不免除 Final Risk，Final Risk 通過也不使施工層變得正確。

平台無法證明實際執行模型時，`actual=unknown` 仍是誠實值（見 `docs/AGENT-EXECUTION.md`），
但它不是規避宣告層級的方式。

- 一般文案、UI、小型接線不強制 Final Risk；一般 DB 接線也不因碰 DB 就升級。
- PAYMENT_CONSISTENCY：付款、退款、名額及重複請求的一致性，包括單一 repo。
- TENANT_AUTH_BOUNDARY：跨店讀寫、登入、權限與秘密保護邊界。
- IRREVERSIBLE_DATA：有資料損失風險、難以復原的資料變更。
- CROSS_REPO_CONTRACT：前後台的重要預約／訂單／付款契約。
- GOVERNANCE_GATE：會**擴大可接受／可放行候選集合**、降低既有 gate、增加 bypass／waiver／exception，
  或可能把原本 failure/pending 變成 success/approval 的治理變更。
- UNRESOLVED_HIGH_RISK：Sol 已查證仍無法裁決的重大疑點。

2026-09-10 起，純 fail-closed governance hardening 若**不命中 sensitive path**，而且只增加拒絕條件、
證據完整度、reconciliation、metrics／observability，沒有增加任何可 merge／deploy／取得權限的狀態，
可填 `ASTRA_RISK: NONE`，以 Sol final audit + adversarial／negative tests 收尾。不能只靠 PR 自稱
hardening；Sol 必須能證明方向只會收緊。方向不明、同時含 relaxation，或可接受狀態集合被擴大時，
仍使用 `GOVERNANCE_GATE` / `UNRESOLVED_HIGH_RISK`。

Sol 在開工時填 `ASTRA_RISK` 與具體 `ASTRA_RATIONALE`。實際 changed files（含 rename 前後路徑）
命中設定內 sensitive path 時，不能用 NONE 降級。路徑底線並非完整語意分析；其他位置的高風險仍須申報。

預設每個 semantic `changeDigest` 一次 Final Risk；只有 blocking finding 導致內容實質修改才進下一輪。
純 rebase／unrelated-main advancement 且 `changeDigest` 不變，**不重跑 semantic Final Risk**，但新 head
仍要重跑 required exact-head CI。

Final Risk 模型不可用的判定必須發生在實際嘗試 Agent／子代理 model selector 之後；只有 runtime
確實沒有可指定 allowlist 模型的委派能力，或 allowlist 模型都被 runtime 明確拒絕，才可標
`MODEL_EXECUTION_UNAVAILABLE` / `ASTRA_PENDING`。不能把「主 Session 不是 Astra/Fable」誤報成需要外部 reviewer 通道。

## 技能與事前檢查

高風險工作載入 `.agents/skills/vibeaico-astra-review/SKILL.md`。
所有新 PR 在建立前使用既有 `agent-wip-preflight.mjs --body <file> --changed-files <file>`；
CLI 會檢查分類及實際檔案清單，建立 PR 不要求尚未完成的 Final Risk。
`validateWipPreflight` 函式的舊呼叫者保持相容；需要路由檢查時明確設
`requireAstraClassification=true`。

## 最後評估的證據

確認確實呼叫 `models.finalRiskAllowedModels` 中的指定模型並取得結果後，將報告保存於 GitHub，
再在候選 PR 提交一筆 COMMENT review。不得只填 PR body 的 PASS。

```astra-review
{
  "repository": "smallwei0301/vibeaico-admin-rebuild",
  "baseSha": "完整40碼基底版本",
  "headSha": "完整40碼候選版本",
  "changeDigest": "64碼變更內容指紋",
  "policyVersion": "2026-09-08.4",
  "testBaseline": "Final Risk reviewer 當時實際採用的測試證據",
  "schemaBaseline": "reviewer 當時採用的 schema 版本或不適用理由",
  "requestedModel": "claude-fable-5-1",
  "actualModel": "claude-fable-5-1",
  "identityEvidence": "OPERATOR_ATTESTED",
  "verdict": "PASS",
  "report": "https://github.com/組織/專案/議題或審核報告連結",
  "findings": "具體審核結論、已驗證事項及剩餘限制"
}
```

`requestedModel` / `actualModel` 必須與當時 `model-routing.json` 的
`models.finalRiskAllowedModels` 清單內同一模型；清單缺失、格式錯誤、catalog 外模型或兩者不一致都擋下。
`policyVersion` 同理。

### 誰可以提交可信 Final Risk review

可信 submitting actor 有兩條路，任一成立即可：

1. GitHub repo permission 為 `write` / `maintain` / `admin` 的 actor；或
2. `model-routing.json.finalRiskTrust.trustedAgentBots` 內的明確 Agent bot。

Agent bot trust **不是名稱比對**。login、immutable GitHub user id、account `type=Bot` 必須三者全部吻合；
設定缺欄、重複或格式錯誤時，Agent bot trust root fail closed。現行第一個 trust root 為
`claude[bot]` / user id `209825114` / `Bot`。新增其他 Agent App 必須修改 trusted-main 設定，
不能由 PR 自己宣告可信。

`OPERATOR_ATTESTED` 從此精確表示：**trusted submitting actor 對這次 model dispatch 的事實背書**。
它可以是上述 write-capable actor，也可以是 allowlisted Agent bot；不等於 Owner 親手貼文，也不是
provider-signed model telemetry。Agent 名稱叫 Astra/Fable 仍不構成模型身分證據，必須真的指定並執行
allowlist model。

正常 Agent Final Risk 流程不要求 Owner 把同一份 bot review 再貼一次。若 bot 不在 trust root、模型不符、
證據 stale、digest 不同或 verdict 不是 PASS，才是真的 Final Risk blocker。

### `changeDigest`：綁變更內容，不綁 commit 身分

`changeDigest` 取每一個 changed file 的（最終路徑、rename 前路徑、狀態、**head 上的 blob sha**），
排序後 sha256。取法見 `changeDigestOf()`；值由**受信任的預設分支**程式從 GitHub 直接給的
`pulls.listFiles` 算出，不採信 PR 或 attestation 自填的內容。guard 會在 summary 與 PR 留言印出
`ASTRA_CHANGE_DIGEST`，不必自行猜值。

排序用 JS 原生 `<` / `>` 的逐 UTF-16 code unit 全序，不用依 process locale 的 `localeCompare`。

`baseSha` / `headSha` **仍為必填且須為合法 40 碼**，但只作「當時審的是哪顆」的稽核紀錄，
不再要求等於 current base/head。真正綁 semantic content 的是 `changeDigest`。

### 多環境並行與純換底 reuse

main 在其他 Session／Agent 持續前進是正常狀態，不是自動重審理由。若 rebase／merge-main 後：

- PR changed-file blob 全部相同；
- `changeDigest` 相同；
- `schemaBaseline` 沒有實質改變；
- Final Risk `policyVersion` 沒變；
- 沒有較新的 FIX_REQUIRED / CHANGES_REQUESTED / DISMISSED；

則既有 Final Risk review **繼續有效**。不要重派 Astra/Fable，也不要因 head/base SHA 改變而重審。

`testBaseline` 是 reviewer 當時實際看過的測試證據。純換底後的新 exact-head CI 必須重跑，但新的 CI run id
應記在 PR completion evidence / closeout，不要只是為了更新 run id 去改寫 `ASTRA_TEST_BASELINE`，否則會把
原本有效的 semantic review 自己變成 stale。若測試內容／環境前提真的改變，而不是單純 CI run id 換號，
再由 Sol 判斷是否需重審。

只要任何 changed-file blob 改變，`changeDigest` 就改變，舊 review 立即失效。schema baseline 或 Final Risk
policy 真正改變也失效。檢查器永遠以**最新可信 review**為準，較新的否決不能被較舊 PASS 蓋掉。

**已知邊界**：changeDigest 涵蓋 PR changed files，不代表「合併後整棵樹已被 reviewer 看過」。main 若在
review 後改了共同依賴而造成語意衝突，仍由 exact-head CI、Sol 與必要 integration 驗證承擔，不能把 reuse
說成跨所有 integration context 的證明。

## 可信執行與啟用

WIP Guard 一律 checkout trusted default branch，不從 PR 載入 routing/trust policy，也不把 PR 自填
`trusted` 或 PASS 當證據。Pending Final Risk 不阻擋安全的測試蒐集，但 required policy status 不會假裝通過。

提交／編輯／撤銷 Final Risk review 後，以下任一 actor 可留言 `/astra-review-check` 觸發 trusted-main refresh：

- write／maintain／admin actor；
- `finalRiskTrust.trustedAgentBots` 的 allowlisted Agent bot。

命令可以是整段 comment，也可以是**第一行** `/astra-review-check` 後接工具自動 footer；不得因 Claude Code
自動簽名頁尾讓 refresh 永遠 skipped。未 allowlist 且無 write 權限的 actor 仍不能觸發特權 workflow。

PR 更新時重新判斷。合併前需確認 current required status；不要用 no-op commit 只為刷新狀態。
主分支前進後先重算 changeDigest 與跑 exact-head CI；digest 沒變就 reuse，不要重派 reviewer。

## 導入與 bootstrap

修改 trusted Final Risk gate 本身仍屬真正的 `GOVERNANCE_GATE`。因此引入或放寬 trust root 的 PR 不得使用
尚未合併的新規則替自己免審。bootstrap 可使用合併前 main 已接受的可信 Final Risk 路徑或 Owner 明確的一次性
transition authorization；不得偽造 Agent/model evidence。

一旦本 Agent-native trust 已在 main 且通過 required checks，owner-only waiver 不再是正常 Agent 作業的預設解法。

## 本輪驗證教訓

- 技能正常升版不應被無關固定版本字串擋住。
- 純 rebase 的新 CI run id 與 semantic Final Risk 是兩種不同證據，不要互相綁死。
- Agent App 能不能提交可信 attestation 應由 trusted-main identity allowlist 決定，不應每次把 Owner 叫回來當影印機。
