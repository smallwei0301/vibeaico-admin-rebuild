# Agent 常駐自主執行規則

> Owner 首次裁示：2026-08-28
>
> 最近更新：2026-10-07
>
> 現行 Product B+ 以本文件為單一操作入口。歷史基線見
> `docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`；後續已收斂裁示包含：
> 2026-09-07 交付完成／v4 結案／條件雙 Terra、2026-09-09 active candidate 上限、
> 2026-09-10 lane 對應模型層級／多環境 base freshness／Product Final Risk、
> 2026-09-11 雙 Workstream 與純治理模型解綁、2026-09-15 qualified dual Terra continuous refill，
> 以及 2026-09-22 的 Environment Delivery backpressure、跨 PR schema dependency #659、
> merge 後 main CI truth #670、Run closeout grading preflight #675。
>
> 最新 Production DB 授權裁示：`docs/decisions/2026-09-14-owner-production-db-policy-gate.md`；見 §3.2。
>
> 本文件是本 repo 的 Agent 執行方式唯一正式版本。產品規格仍以各
> `docs/integration/**` 分冊為準；Owner Decision 保留「為什麼改」，本文件負責「現在怎麼做」。
>
> **產品交付鏈路**（每一關要抓什麼、通過的證據長什麼樣）另見 `docs/DELIVERY-CHAIN.md`：
> 本文件規範**執行模式與 WIP 上限**，該文件規範**交付流程與證據標準**，兩者互補。

## 1. 預設工作模式

- 主 Agent 是專案主導者，不只是回報者。收到 Issue、`/goal` 或「繼續」後，持續完成
  所有安全且可自主施工的工作，直到符合 §11 停止條件。
- CI、TEST、Preview、Agent 或外部讀取正在等待，不代表整個 goal 暫停。若現有 Product 候選已
  source-frozen、符合 `AUDIT_READY` verification-tail 契約，且仍有 qualified independent slice，
  應 continuous refill 空出的 BUILD slot；不得因此突破 candidate=3、Terra BUILD=2、shared TEST=1
  或 hot-boundary／ownership 安全限制。
- 每次接手先讀 live GitHub：current `main`、open Issue、open PR、exact head、CI、
  shared TEST holder 與最新 scorecard。舊對話只當線索。
- 優先接續既有可用 branch／PR，不 reset、force-push 或重做已完成的 migration／測試。

### 1.1 Owner 控制訊號

```text
OWNER_MODEL_SWITCH    Owner 為切換模型速度、深度或角色而重送 /goal
OWNER_STEER           Owner 改變限制、授權或方向
OWNER_CONTINUE        Owner 要求同一工作繼續
AGENT_PREMATURE_STOP  Agent 明確終止，但當時仍有可施工工作
UNKNOWN_CONTROL_EVENT 證據不足
```

Owner 重送 `/goal`、`/steer` 或「繼續」本身不等於前一位 Agent 提早停止。模型切換後保留
branch、PR、exact head、TEST lane、Run ID 與目前 stage。

### 1.2 先分 Workstream，再選流程

所有新 Issue／PR 必須有且只有一個：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

或：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

- 使用者可見功能、API/runtime、schema/migration、tenant data、payment/refund、
  LINE/provider、Product deployment、跨 repo Product contract → `PRODUCT_MAINLINE`。
- 模型治理、Agent orchestration、WIP／PR lifecycle、governance CI、scoreboard、
  model routing、governance evidence → `MODEL_GOVERNANCE`。
- 混合範圍優先拆 PR；拆不開且碰 Product runtime／schema／付款／LINE／部署／跨 repo
  Product contract 時，整張按 `PRODUCT_MAINLINE` 處理。
- `PRODUCT_MAINLINE` 走 Product B+。
- `MODEL_GOVERNANCE` 不啟動 Product Terra／Reserve／dual-Terra，也不要求 Product Final Risk；
  改走 bounded governance flow：

```text
current truth
→ bounded governance implementation
→ source CI / regression tests
→ final exact-diff verification / counterexample review
→ merge / closeout
```

純治理依 2026-09-11 #360 不指定執行模型；`requested=not_requested`，沒有可靠來源時
`actual=unknown`。取消模型門檻不代表取消驗證。

Product workstream 的結果另分 `USER_VISIBLE_PRODUCT`、`ENVIRONMENT_DELIVERY`、`PRODUCT_INFRA`；三者可屬 PRODUCT_MAINLINE。每日成果回報先以逐項 Issue／PR 證據分三類列示，不用同一標籤數量冒充可見產品進展。旅客 INSTANT 下單屬前者、Production migration 屬第二者、release risk classifier 屬第三者。現有 canonical ledger／scorer 只產生 aggregate `shippedUnits`，尚未提供這三類的機械分項；此總量不得宣稱為 user-visible throughput，也不宣稱已自動分項。沒有可回讀的逐項分類證據時，分項數量記 UNKNOWN；若以成果列表人工計數，附該列表及計數方法，明確區別於 canonical scorer 輸出，不回填或改寫歷史 ledger。分類報表缺少分項數字不形成新的 Product blocking gate。此輪只規範成果呈現，不新增 ledger 欄位、scorer、模型或人工 approval，安全門檻不變。

### 1.3 工作線隔離與純記帳分類（#500 收尾）

- 先用本 PR 的完整 actual changed-file list（包含 rename 前後路徑）、既有 scope 白名單、
  Workstream 與 lane metadata 驗證分類，不能只因自稱 `MODEL_GOVERNANCE` 就跳過檢查。
- 合法的純治理 PR 不讀取或繼承其他 Product PR 的 Terra／Reserve／candidate／shared TEST
  global-WIP 錯誤；自己的 scope、metadata、source CI、反例審查與 branch protection 仍必須通過。
- Product／混合範圍、分類不明或自己契約不完整的 active Agent PR，維持完整 Product WIP 檢查。
  這不授權治理工作使用 shared TEST，也不放寬 Product 的 ownership 或任何安全上限。
- 純 `docs/metrics/**` 或 `docs/schema-truth/**` 的獨立記帳 PR 屬 `MODEL_GOVERNANCE`。
  記錄 Product Run 不等於本次工作是 Product；不得借用 Product Run 名稱占 Product candidate。
  真正包含 runtime／schema／provider 變更的混合 PR 仍按 Product，不以文件路徑掩蓋它。
- preflight、必要的 WIP guard、分類 workflow 與 Completion Truth 共用
  `scripts/agents/governance-workstream-boundary.mjs` 的對應判準；不能只補本機檢查而漏掉遠端入口。
- BUILD／VERIFY 繼續遵守 §5 的 qualified `AUDIT_READY` 語意，不恢復舊的
  `TEST_VALIDATION` active-candidate tail 設計。

### 1.4 分類防復發：入口、事件重查與唯讀巡查（#520）

- Issue 在建立前執行 `node scripts/agents/issue-provenance-policy.mjs --body <issue.md>`。
  本文欄位或表單 `WORKSTREAM` 標題只能有一份有效宣告；相同值重複也拒絕。
  程式碼圍欄、引用範例與 HTML 註解不是 Issue 分類來源；漏填／衝突不能當通過。
- Issue 宣告是規劃，不是產品安全豁免。PR 仍須依 §1.3 用完整實際檔案與 rename 兩端
  通過原有 preflight、分類及必要 WIP 檢查；不得按標題、模型、父 Issue 或 Run 名稱猜分類。
- Issue／PR 建立、修改本文、重新開啟及增刪分類標籤時，由現行 workflow 重新讀 live 資料。
  只增刪自己管理的標籤，不整包覆寫；失效事件不得改寫 closed PR 的歷史狀態。
- `agent-workstream-watch` 每日 UTC 22:17（台灣 06:17）、手動及分類巡查程式合併後執行。
  唯讀盤點全部 open Issue／PR 與最近 72 小時更新的 closed Issue／PR，重用現行分類器，
  檢查本文、分類標籤、純記帳範圍與完整檔案證據；舊 PR grandfathering 保留並另外計數。
- 巡查留下 `workstream-observation.json` 與 Actions summary：一致才 PASS，發現錯誤為
  DRIFT_DETECTED；讀取失敗、分頁不完整或讀取中版本變動為 EVIDENCE_UNAVAILABLE。
  未知不補成零；報告綁觀測時間與 trusted policy SHA，不是一次檢查永久有效。
- 巡查只報告，不改本文、不關單、不合併、不派 Product、不占 TEST、不取得 Production 權限。
  修正者依具體 finding 核對後正常更新，不能為了讓報告變綠而刪除歷史證據。
- #558：已結案 Issue 不因關閉就退出近期巡查；closed 項目殘留 active/candidate/待升級標籤或
  正式 LANE_STATE=ACTIVE、ACTIVE_CANDIDATE=true 也列為 finding。範例／引用不是正式宣告。
  讀取前後生命周期標籤不同時保留 unavailable，不能把變動中的狀態當穩定證據。
  報告以 inventoryVersion=2 標明擴大範圍；不能直接拿舊總數減新總數當修復率。
- #566：分類器新增本地 import 或讀檔相依時，必須同步 trusted workflow 的 sparse-checkout 清單。
  送出前以該清單複製到乾淨目錄並實際載入分類入口；完整 checkout 的測試成功不能替代它。
  相依缺檔是檢查器啟動失敗，不是 Product 分類錯誤；修補合併後重查目前事件，不重寫歷史結果。
- 路徑與欄位檢查不能證明每個語意都正確；最終 exact-diff／反例審查及原有安全關卡仍必要。

### 1.5 Environment Delivery backpressure：環境與使用者可見產品雙車道

Product 主線的 throughput 目標是**可用成果**，不是單純增加 merge 數。每次 live inventory 後，先把已 merged／已存在 main 的 Product work 分成：

```text
SOURCE_ONLY
TEST_VERIFIED
PRODUCTION_SCHEMA_READY
ACTIVATION_PENDING
AUTHENTICATED_PRODUCTION_ACCEPTED
```

另保留 `HISTORICAL_SHAPE_WITHOUT_CANONICAL_LEDGER`、`VERIFIED_NOT_APPLIED`、`OWNER_BLOCKED`、
`EXTERNAL_BLOCKED` 等真實例外；不得硬塞進成功階段。

依 [Owner 2026-10-06 throughput recovery 裁示](decisions/2026-10-06-owner-product-throughput-recovery.md)，常態保留兩條有價值且 qualified 的車道：

- `LANE A = ENVIRONMENT DELIVERY`：TEST、G0–G7、Production schema、activation／acceptance，優先清既有交付尾項。
- `LANE B = USER-VISIBLE PRODUCT`：旅客旅程、auth UX、LINE、booking／checkout 等真正可見成果；不直接依賴 Lane A 同一 schema／hot boundary 的 slice 繼續施工。

環境阻塞只停止受影響步驟，不得吃掉全部 Product capacity。兩條 BUILD 不得同時被 release helper、validator、manifest、risk classifier 或 governance repair 占滿；有 qualified 工作時至少維持一條 user-visible lane。沒有合法獨立 slice 時如實列 blocker 與恢復條件，不為湊數施工，也不降低 §5 的容量、ownership 或 isolation qualification。

Lane A 內的優先順序為：

1. `TEST_VERIFIED → Production controlled release → PRODUCTION_SCHEMA_READY`。
2. `SOURCE_ONLY migration/schema → canonical TEST → TEST_VERIFIED`。
3. `PRODUCTION_SCHEMA_READY → 重新驗 current-main runtime → activation／merge／deploy`。
4. `MERGED/AUTO_DEPLOYED → authenticated Production acceptance`。
5. 同一環境交付線沒有可安全推進的高優先尾項後，才新增該線的 source slice；獨立 Lane B 不受此等待條件阻擋。

Lane A 內改變上述優先序的例外只限：Owner 明確改優先序、P0 安全／資料損失／付款事故、或新 source 是解除同一 release 阻塞的必要前置。
即使例外成立，也要在 Run／PR 記錄原因；不能以「Terra slot 空著」作為新增 source 的理由。

#### 1.5.1 Schema release debt：TEST 通過即形成必須清掉的正式環境責任（Owner 2026-10-07）

資料庫相關 Delivery Slice 一旦到達 `TEST_VERIFIED`，同一條 Environment Delivery 工作線必須持續推進到
`PRODUCTION_SCHEMA_READY`，或留下可回讀的精確 G0–G7 stage／evidence blocker。不得因 migration/source 已 merge、
本輪 source 任務已完成、Terra slot 空出或另一張 schema Issue 比較容易，就改做無關的新 schema source。

Environment Delivery queue 只要仍存在可安全推進的 `TEST_VERIFIED`／`PRODUCTION_PENDING` schema release，
Lane A **不得開始無關的新 migration/schema source**。唯一例外：
1. 新 source 是解除同一 bounded release blocker 的必要前置；
2. P0 安全、資料損失或付款事故；
3. Owner 明確改變 release 優先序。

同一 release 依賴鏈可以一起規劃，但必須在 queue 中綁定同一 bounded release plan、TEST evidence、Production stage
與下一步；不能把「屬於同一產品」當成無上限追加 migration 的理由。

#### 1.5.2 Delivery drain mode：不讓 Production Pending 只停留在報表

`production_pending` 是排程訊號，不只是複盤數字。若連續兩次正式複盤都同時觀察到：
- `production_pending` 沒有下降；且
- 新的 Product source／main 成果仍持續增加；

則 Lane A 自動進入 `DELIVERY_DRAIN_MODE`（交付清淤模式）：只處理現有 Environment Delivery queue 的
TEST → Production → activation → authenticated acceptance，不新增無關 schema source。直到 pending 明顯下降、
queue 只剩真實 Owner／External blocker，或 Owner 明確解除。

`DELIVERY_DRAIN_MODE` **不停止 Lane B**。獨立、無相同 schema／migration ledger／auth/RLS／payment/refund／provider
hot boundary 的 user-visible Product 仍依正常 WIP 規則 continuous refill。此模式不新增任何 G0–G7 gate、
人工 approval、第二套 writer 或新的資料庫一致性檢查器。

**continuous refill 是交付流水線補位，不是 source 產量 KPI。** 若唯一可選工作會與 shared TEST、
同一 migration ledger、auth/RLS、payment/refund 或 mutable provider hot boundary 衝突，寧可序列化，
不得為了把兩個 BUILD slots 填滿而製造更多 environment debt。

Environment Delivery／Production acceptance 本身屬 `PRODUCT_MAINLINE` 的正式施工，不得被當成「只是部署」
而排除於 Product Run。完成一個環境階段後，立即依 §9.0.2 更新 live Issue 與 §10 raw facts；
不得等下一次複盤才發現 source 與 environment 已分岔。

## 2. 強制開工順序（低摩擦 default entry）

原則：**本文件是 default execution entry，不再每輪無條件重讀整套治理背景。** 安全規則沒有減少，改成依任務 trigger 載入，降低 context、時間與「讀太多反而用錯舊規則」的摩擦。

每次接手固定只做：

**HARD STARTUP GATE：在完成第 1–2 步以前，不得做施工判斷、Issue／PR 寫入、TEST／Production 動作、merge、
close 或部署。不得用記憶、舊 Session、先前下載副本代替 current-main 規則。**

1. `git fetch origin --prune`，從 live GitHub 重建 current `main`、open Issue／PR、exact head、CI、shared TEST holder。
2. 以剛取得的同一個 `origin/main` SHA **完整讀取 `AGENTS.md` 與 `docs/AGENT-EXECUTION.md`**；再讀 `CLAUDE.md`、
   `docs/OWNER-DECISIONS.md` 中與本 Issue／領域直接相關的現行裁示，以及比本文件更新且命中本範圍的 Owner Decision。
   交接／Run 至少記住本次 `RULES_MAIN_SHA`。若首次寫入前 main 因治理／release contract 的相關變更前進，
   重新讀受影響章節；無關 main 前進不強迫整包重讀。
3. 先確認 `WORKSTREAM`；只有 `PRODUCT_MAINLINE` 才套 Product B+ lane／model／Final Risk 規則。
4. 讀 Issue 指定 canonical 文件與直接相關的 integration／testing 章節；Playbook 只搜尋本次錯誤、Issue 或領域，不全量重讀。
5. Product Run 建立或接續 `RUN_ID`，記錄 main、open Issue／PR、lane、TEST holder 與 raw-event 基線，並跑一次 §10 Live Scorecard readiness。
6. **選下一個 Product source 前先讀 §1.5／§2.0.3 Environment Delivery queue。** 依序檢查：
   `TEST_VERIFIED → Production`、`PRODUCTION_SCHEMA_READY → activation`、`deployed → authenticated acceptance`；
   Lane A 有可安全推進的既有尾項時，不得先選無關的新 migration/schema source。
7. Product B+ 由窄範圍 Luna/scout 盤點，再由一位 Aggregator 去重；Sol 只根據精簡包選 MAIN、可選 RESERVE 與 Closure target。
8. 同一 Run 若有兩張 executable Guard 判定 qualified、互不衝突的 Product slices，應主動維持兩個 BUILD slots；沒有第二張安全候選、candidate cap 不足或隔離／hot-boundary 條件不成立時安全降級為一條。

以下文件改為 **trigger-based load**，不是每輪 mandatory read：

| 文件／skill | 何時載入 |
|---|---|
| `docs/MODEL-ROUTING.md` | Product lane/model routing、Final Risk、模型層級衝突 |
| `docs/AGENT-BPLUS-DELIVERY-LOOP.md` | 本文件與 B+ 背景規則有衝突、需追溯歷史裁示 |
| `docs/DOCUMENTATION-GOVERNANCE.md` | canonical docs、文件延伸、文件治理範圍 |
| `.agents/skills/**` | 對應任務真的觸發該 skill 時 |
| `docs/AGENT-PLAYBOOK.md` | 以錯誤碼／Issue／領域關鍵字搜尋直接相關條目 |
| 最近 1～3 份 Run | 接續同一 Run、做 score/retro、或需要比較上一輪建議時 |

### 2.0.1 Deterministic metadata：preflight-first

PR body、`TEST_PROFILE`、lane、candidate、Closure、Final Risk metadata 等 deterministic contract，**不得把 remote CI 當互動式表單驗證器**。

```text
填 metadata
→ local / trusted preflight
→ PASS
→ 才 push / dispatch remote CI
```

- **推送驗證與傳輸分開（Owner 2026-10-07，PB-038）**：已授權的 GitHub connector 僅可向具名工作分支（不得為 `main`）傳輸；在原 `scripts/agents/verify-before-push.sh` verify-only 成功後，依 [PB-038](AGENT-PLAYBOOK.md#pb-038) 的同 SHA／狀態重查／非 force 寫入及回讀要求承接最後傳輸；CLI `--push` 仍有效。verify-only 的 `VERIFY_PASS` 與本澄清均不授予 connector 直接寫入 `refs/heads/main` 的權限；合入 main 仍走正常 PR／CI／審查及適用 merge gates。必要測試、獨立審查、ownership、適用 gates 與分支保護不變，傳輸成功不等於驗證或發布完成。
- metadata 到 CI 才第一次被擋，優先視為 **preflight coverage gap**；補 shared validator／parser，而不是再教每個 Agent 背一段 prose exception。
- metadata 修正不靠 blind rerun；workflow 若不監聽 `edited`，使用既有 `workflow_dispatch` 或下一個**真實內容變更**觸發，不堆 no-op commit。
- 同一 deterministic error 不用多輪 CI 猜合法值；先讀 validator 或讓 preflight 直接呼叫與 CI 相同的判定函式。
- **Agent PR publication receipt（#724）**：#736 實際 merge 時間是不可變的 rollout 邊界；該時間以前建立的 PR 永久 grandfather，即使 live base 前進也不追討歷史 Draft receipt。新建立的 Agent-origin PR 先以 Draft 作 staging；OWNER／UNKNOWN 與 grandfathered PR 不套用新 publication validator。trusted-main guard 用 `agent-wip-preflight.mjs` 的共用 deterministic validator 驗 exact body + GitHub actual changed-file inventory；PASS 才由 `github-actions[bot]` 留 immutable `PUBLICATION_PREFLIGHT_RECEIPT`，其 digest 綁 exact body、files、base SHA、head SHA。轉 ready／ACTIVE 時 receipt 必須仍精確匹配；body edit、source synchronize、base/head/file inventory 改變都會讓舊 receipt 失效，必須回 Draft 取得新 receipt。main push 會喚醒以 main 為 base 的開放 Agent PR，重新驗證 base-bound receipt 並更新當前 head 的 required status；定時 recovery 仍保留。若 push 喚醒無法取得 PR 清單，該 run 失敗，但先前 head 的成功 status 不會自動失效；合併者必須核對最新 base、receipt 與本次有效 guard，不能將失敗 run 當成 PASS。純 MODEL_GOVERNANCE 仍只驗自己的治理 metadata，不借 Product Run。
- receipt 不是 Final Risk、CI、TEST 或 merge approval，也不能由 PR body 自稱 PASS 取代；remote WIP/Final Risk/TEST/schema/branch-protection 規則照常執行。no-op commit 只會改 head 並使 receipt 失效，不是修 metadata 的手段。

### 2.0.2 Final Risk blocker 判讀：審查、提交證據、Owner action 必須分開

遇到 Product Final Risk 紅燈時，**不得把「審查尚未被 guard 接受」直接翻譯成「等待 Owner 簽核」**。日常處置固定遵守以下三點：

1. **審查執行者、GitHub 證據提交者、Owner 核准者是三個不同角色。**
   §7.2 允許的 Final Risk 可以是首次 Astra／Fable、降級 Sol／Opus，或無 model selector 時的
   `CURRENT_AGENT` 真實對抗審查。canonical `astra-review` 仍須由 guard 接受的 trusted actor 提交：
   `model-routing.json.finalRiskTrust.trustedAgentBots` 內明確 allowlist 的 bot，或 GitHub live permission
   可驗證為 `write`／`maintain`／`admin` 的 actor。trusted actor 把**真實已發生**的審查證據提交成
   COMMENT review，不等於冒充 Owner，也不等於宣稱該 actor 就是被選定的 Astra／Fable。
   除非某一條現行政策明文要求 Owner action，正常 Product Agent-native attestation 不應再要求 Owner
   把同一份審查重新貼一次。

2. **沒有具體權限拒絕證據，不得標成 `OWNER_BLOCKED` 或「等 Owner／claude[bot] 簽核」。**
   先讀 exact-head `Agent WIP Policy`、canonical PR reviews 與當前 `changeDigest`，把 blocker 精確分類：
   `STALE_ATTESTATION`（test/schema/changeDigest 不符）、`LATEST_VERDICT_NOT_PASS`、
   `REVIEW_IDENTITY_INVALID`、`DEFERRED_NON_ACTIVE`、`TRUSTED_SUBMITTER_UNAVAILABLE`、
   `ACTUAL_PERMISSION_DENIED` 或其他真實錯誤。若目前 GitHub actor 符合 trusted actor 條件，應使用現有
   允許路徑提交誠實 review／refresh guard，而不是因「本 Session 不是 Astra/Fable」自行停工。
   只有實際呼叫被權限、GitHub 或外部平台拒絕，而且合法替代路徑也不存在時，才可把 Owner／external
   action 列為唯一 blocker；交接必須附上被拒的 action、actor、錯誤與 exact head，不能只寫「需要簽核」。

3. **`manifest re-pin` 是完整性中繼資料維護，不是 Final Risk 簽核。**
   migration SQL 因合法修正而改變位元內容，使 fresh-install compatibility manifest 的 digest／mainHead
   過期時，先確認 SQL 變更本身是預期內容，再依 canonical script／既有先例重算 pin，且**不得修改、刪除
   或放寬防竄改檢查邏輯**；之後重跑 baseline／integrity 相關測試與必要 CI。若執行環境的 safety
   classifier 或工具層真的阻擋 re-pin，應記為 `ENVIRONMENT_BLOCKER`，附上實際被拒 action／command／錯誤；
   不得把它混報成 Astra／Owner Final Risk blocker，也不得要求 Owner 以「授權弱化 guard」方式解決。

在任何「等待 Owner」結論前，Agent 必須能回答三個問題：**到底哪個機械條件失敗？目前 actor 依法能否
自行修復／提交？Owner 或外部人類是否真的是唯一剩餘動作？** 任一題沒有 live evidence，就繼續調查或走
現有自主路徑，不得先停工再把責任上拋。

### 2.0.3 Environment Delivery triage：先看真實環境，再選下一張 Product

若本次 Goal 涉及 migration、schema-dependent runtime、正式功能驗收或「收尾」，在 Sol/Terra 選新 source 前，
對**本次相關物件**做 bounded live readback，不要求每輪全庫掃描：

- current-main canonical migration / runtime dependency；
- TEST affected schema + migration ledger；
- Production affected schema + migration ledger；
- 對應 readiness receipt / G3 / Production release artifact 是否存在且仍綁 current source；
- runtime PR 是否 PARKED / ACTIVATE / superseded；
- authenticated Production acceptance 是否真的做過。

然後建立最小 Environment Delivery queue，至少列：

```text
MIGRATION / FEATURE
CURRENT_MAIN_SOURCE
TEST_STATE
PRODUCTION_STATE
RUNTIME_ACTIVATION_STATE
PRODUCTION_ACCEPTANCE_STATE
NEXT_SAFE_ACTION
```

**live shape 與 ledger 必須分開記。**「table/column 已存在」不等於 canonical migration identity 已套；
「ledger 有一筆」也不單獨證明目前 shape／ACL／RLS 正確。歷史等價 shape 不盲目重跑 migration，
應記 `HISTORICAL_SHAPE_WITHOUT_CANONICAL_LEDGER` 並走 provenance／precondition 收斂。

若 Issue 本文與這次 live readback 矛盾，先依 §9.0.2 把 CURRENT TRUTH／checklist／remaining scope 更新到 GitHub，
再由下一位 Agent 接續；不得把過期 Issue body 當 release blocker 或重做已完成步驟。

### 2.1 Branch base freshness 現行規則

- 新施工從當下 current `main`，或已具備必要 canonical decisions 的指定 integration branch 開始。
- 工作分支建立後，不得只因無關的 main 前進就 rebase／重建。
- 只有 material migration-ledger change／prefix collision、實際 merge conflict、
  shared contract 或 acceptance precondition 改變，或 CI 證據顯示新 base 會實質影響候選時，
  才 re-align。
- `HEAD^ == origin/main` 不是全域必要條件。

## 3. 長期授權與禁止事項

| 動作 | 預設權限 | 必要條件 |
|---|---|---|
| 讀 repo、Issue、PR、CI、Preview、報告 | 允許 | 使用 live 狀態，不洩漏秘密 |
| 修改程式、測試、文件；建立 branch、commit、PR | 允許 | 遵守 Workstream、B+／治理流程、Issue 範圍與文件治理 |
| 更新 PR／Issue 證據與標籤 | 允許 | 必須是 exact-head 真實證據 |
| 關閉 Issue | 允許 | 最終分支含實作，且依所屬 Workstream 的驗收／review 成立 |
| TEST Supabase 操作 | 允許 | 僅限 §3.1 TEST project，且持有唯一 TEST lane |
| Vercel Preview 驗證 | 允許 | 不提升 Production |
| docs-only 輕量路徑 | 允許 | 只在文件治理白名單內；**不得繞過 live branch protection**，若 main 要求 PR／required checks 就正常走 PR |
| 程式／workflow／skill 合併 main | 需明確任務授權 | CI、Audit、安全邊界成立；不得偷渡產品發布 |
| Production DDL／DML／migration | **staged policy gate** | §3.2；`AUTOMATION_READY` 前沿用現行逐次 Owner gate，ACTIVE 後改由機器關卡放行，不需逐次人工批准 |
| Production reset／seed／災難性刪除 | **禁止** | 不在 §3.2 允許範圍，不能藉人工同意跳過關卡 |
| Production deployment／promote／流量切換 | **禁止** | 需新授權 |
| 真實付款、退款、訂單或顧客通知 | **禁止** | 測試只用 sandbox、mock 或明確安全接收者 |
| 輸出或提交 token、密碼、key、完整 `.env` | **禁止** | 秘密只在執行環境短暫使用 |

### 3.1 TEST Supabase 長期授權

僅限 project ref：`nmwhwngojosmagjuvxol`。

每次必須：

1. 重新確認 project ref。
2. 記錄 migration／schema 基線與 exact head。
3. API schema 變更後刷新 PostgREST cache 並跑真實目標查詢。
4. reset／seed 只清 TEST 測試資料。
5. 不呼叫真實付款或通知。
6. 全 repo 同時只有一位 `TEST_VALIDATION` holder。

### 3.2 Production 資料庫：Machine Policy Gate（分階段啟用）

Owner 2026-09-14 裁示見 `docs/decisions/2026-09-14-owner-production-db-policy-gate.md`。
唯一詳細流程是 `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md`；本節是日常操作入口，不維護第二份不同的門檻。

```text
AUTHORIZATION_MODE: POLICY_APPROVED_AUTOMATION_PENDING
TARGET_MODE: POLICY_GATED_ACTIVE
PER_RUN_OWNER_APPROVAL: REQUIRED_UNTIL_AUTOMATION_READY
PRODUCTION_PROJECT_REF: egehnijjpgijmccagxac
PRODUCTION_FINAL_RISK_REQUIRED: true
```

只授權本 repo 明確範圍內的相容式 migration、結構／權限修復及可復原的有界非金流資料回填。
正式庫套用、資料修復與執行器接線屬 `PRODUCT_MAINLINE`，不能借純治理免審查規則放行。
其他 Production 專案、網站發布、真實付款／退款、顧客通知與 LINE 仍依原本領域授權。
正式庫 reset／seed、災難性刪除、不可復原的資料變更不在本政策允許範圍。

| 關卡 | 沒有此證據就停止 |
|---|---|
| G0 計畫鎖定 | 唯一 release ID、精確 main SQL 與 digest、相依、對象、筆數上限、復原及副作用範圍 |
| G1 來源與 CI | canonical migration 已在 current main；實際 SQL 相同；必要 CI／schema tests 真正執行 |
| G2 資料庫一致性 | 重建標準、TEST、Production 的結構／權限／帳本及依賴逐項比對；未解釋差異為零 |
| G3 真實 TEST | 空白重建、正式庫形狀升級、正反例、必要 API／E2E、重跑及清理證據；不是 POLICY_SKIP |
| G4 備份與復原 | 可用且涵蓋範圍正確的備份、復原演練、線上相容與健康檢查 |
| G5 高風險審查 | 獨立執行允許模型，對本次操作計畫與正式庫基線留下可驗證 PASS |
| G6 寫入前再次檢查 | trusted-main 機器驗證、單次限時回執、正確 project、跨工具互斥鎖與基線重查 |
| G7 套用後回讀 | 實際結構、權限、資料／帳本及安全通路驗證相符，才能 APPLIED_VERIFIED |

在 `AUTOMATION_READY` 前，G0–G6 全成仍保留現行逐次 Owner gate，作為 bootstrap safety。當 trusted-main executable policy 證明 `AUTOMATION_READY=true` 且 `PRODUCTION_DB_AUTHORIZATION_MODE=POLICY_GATED_ACTIVE` 後，G0–G5 及寫入當下 G6 全成即可由受控執行器套用，不需再等 Owner 逐次「同意」。此切換不需要 Owner 第二次啟用裁示。
一個 observer MATCH、main merge、CI 綠燈、人工 checkbox 或舊 source review 都不能單獨授權。
精確的待套用差異／受審查修復走詳細流程，不要求「先完全一樣才能修」，也不允許籠統豁免。
缺證據、審查、備份或執行器時，分別記 EVIDENCE_BLOCKED、REVIEW_BLOCKED、
RECOVERY_BLOCKED、IMPLEMENTATION_BLOCKED／EXECUTION_BLOCKED。automation pending 期間若其餘技術關卡已全成，才可如實記 `BOOTSTRAP_OWNER_GATE_PENDING`；ACTIVE 後不得再把逐次 Owner approval 列成常態 blocker。

遠端只套 main SQL 的規則不變。新 schema 使用「資料庫準備」與「功能啟用」兩段：
先隔離演練與必要 source review／CI，再合併不會啟用相依程式的 schema 準備，
之後套 canonical TEST 並驗收，再走正式庫關卡；正式 schema ready 後才啟用相依功能。
一般 Product 驗收不變；既有 guard 不支援安全分段時先補接線，不繞過檢查。`agent-wip-preflight` 與必要的 `Agent WIP Policy` 共用 `schema-staged-release-policy.mjs`：

- **同 PR migration + Product runtime/API/UI** 預設拒絕，除非 PREPARE 的**每個變更 runtime 檔**都可機械追蹤至同一個 `DEFAULT_OFF` gate，且每個 exported entry 的第一個可執行分支都是 gate 關閉時 `return/throw` 的早退；所有 top-level DB/network 副作用也會被拒絕。
- **拆成不同 PR 不是豁免。** #659 起，runtime-only PR 若以 `SCHEMA_DEPENDENCY`，或 legacy `DEPENDS_ON_PR`
  明確宣告依賴另一張 migration/schema PR，也必須走 staged release。readiness 尚未成立時只能是
  PREPARE + mechanically proven default-off；後續 ACTIVATE 才能打開。
- ACTIVATE PR 不得再帶 migration，且只能引用 current base 已存在、不可由該 PR 補造的 schema readiness receipt。
  trusted guard 重新查 canonical `ci` 的 integration + E2E 真實成功，以及 read-only
  `agent-schema-drift-watch` 成功；兩者 head 必須是 receipt 的 schema-prep commit，並驗證該 commit 是目前 base 祖先。
- 單純 schema prep、migration 加文件／測試、或明確 `SCHEMA_DEPENDENCY: none` 的普通 runtime 不因本規則誤擋。
  除此之外，runtime-only PR 如果**首次加入直接呼叫某個資料庫 RPC 的程式**（例如 `client.rpc('create_tour_order_quoted')`），
  即使填寫 `SCHEMA_DEPENDENCY: none`，既有 `Agent WIP Policy` 仍會從 exact base/head 程式內容辨識新增 RPC 名稱，
  並要求 `RPC_TEST_RUN_ID` 指向該 PR exact head 的真實 canonical TEST `ci`，其 integration 與 E2E 必須實際執行成功。
  `POLICY_SKIP`、只有 typecheck/build 綠燈、舊 SHA 或口頭說明不算證據。已宣告 schema 相依的 PREPARE／ACTIVATE 仍走原本的分段發布與正式環境驗證，不另造放行關卡；
  未新增 RPC 名稱的一般 runtime／Lane B 不受此額外要求。動態組合 RPC 名稱與非字面呼叫仍需 Final Risk 人工審查。

Production release 也不得因 pending migration 很多就「照編號整批套」。先依 §2.0.3 的 queue 與相依／風險建立 bounded release plan：
已 `TEST_VERIFIED` 的項目優先進 G0–G7；main-only 項目先取得唯一 canonical TEST holder；
`PRODUCTION_SCHEMA_READY` 後才恢復 PARKED runtime。每個 release 都只認自己 exact planned set，
不得把其他 pending migration 的存在視為順便放行。

**政策制定不等於自動化已上線。** 本文件不建立生產排程、憑證或可寫工作；
完整 gate／writer／備份／審查／互斥鎖未經實作驗證前，不得宣稱 AUTOMATION_READY 或直接套用。
所有舊文件的逐次人工 DB 授權敘述，在 automation pending 期間仍是 bootstrap safety；trusted-main 證明 ACTIVE 後，才在上述精確範圍內由新裁示自動取代。

### 3.2.1 Release Guard v1 freeze 與 machine-ready 判讀

以 current main 現有 release tooling 為 v1 baseline，先真跑 bounded G0–G7，卡哪一關只修該 technical blocker。真實 execution 包含對現有 G0–G7 gate 實際執行的對抗 case：若可回讀證據顯示 gate 錯誤放行，即屬實際失效，不以程序 exit 0 冒充安全，也不必等待 Production 事故。沒有實際執行暴露新 blocker，不得以 reviewer 理論推演繼續增加 release-tool hardening 或占 Product BUILD slot。

新增修補須同時有四項證據：實際 run 失敗或上述已實跑對抗 case 證明 gate 錯誤放行、可重現 counterexample、既有 gate 尚未覆蓋的不同 failure mode，以及 wrong project／wrong SQL／auth bypass／destructive apply／partial apply／stale evidence／writer collision 等實際風險。四項缺一不可；純 hypothetical edge case 記 backlog，不阻擋目前 release。本段不授予執行 TEST／Production 或其他副作用的權限，對抗 case 仍須遵守適用授權與安全邊界。

在結論為「等待 Owner」前，重驗 current trusted-main readiness 與其 machine evidence。若 `AUTOMATION_READY=true`、`POLICY_GATED_ACTIVE`、`PER_RUN_OWNER_APPROVAL=NOT_REQUIRED` 仍成立，G0–G5 與寫入當下 G6 PASS 後依既有政策由 controlled writer execute；G7 readback 完成才是 APPLIED_VERIFIED。readiness 是政策就緒，不是單次 release 全 gate PASS，也不是 database mutation 許可本身。若退化，指出失效的具體 machine evidence，不能用籠統 Owner gate 代替。

不得增加 validator 的 validator、reviewer 的 reviewer、等價 exact-head／lock／digest／TEST 的第二份證明或重複人工 approval。每個 gate 必須指出尚未被其他 gate 覆蓋的 failure mode；答不出來時，經正常差異審查選擇 REMOVE／MERGE／DOWNGRADE_TO_NONBLOCKING，不可直接跳過現有 required protection。canonical main migration、exact bytes/digest、canonical TEST、tenant/RLS正反例、Production project identity、dedicated controlled writer、writer lock、apply前live recheck、G7、payment/refund Final Risk、destructive fail closed、跨租戶、partial apply／APPLY_UNKNOWN、Production reset／seed restriction 全保留。

## 4. Product B+ 角色與模型路由

Owner 2026-10-01 00:47 UTC 細化：在同一執行環境用 subagent／multiagent 明確 request 角色模型，主 Agent 保留 ownership，回收結果後核對來源／exact diff／測試再繼續；委派不是交給外人後停工。OpenAI Luna=`gpt-6-luna` 做窄盤點／Aggregator，Sol=`gpt-6.1-sol` 做施工與普通審查，獨立 reviewer 用不同 actor／fresh context。Astra=`gpt-6-astra` 只做 classifier 確定的高風險 Final Risk，不施工、不盤點、不處理普通風險；Anthropic 對應不變。無 model selector 如實記限制並用既有合法 fallback，不假稱 served model；歷史 context／role unknown 不改寫。
CURRENT_AGENT fallback 不得讓 builder 自審放行；仍需不同 actor／fresh context 做對抗審查並如實 actual unknown。沒有獨立 actor 可用就 park，不虛稱獨立 PASS，不改 #552 attestation 身份／來源契約。

本節只適用 `PRODUCT_MAINLINE`。

```text
LUNA_FAN_OUT → LUNA_FAN_IN → SOL_TRIAGE
                         ↓
          MAIN_TERRA BUILD（qualified target 2）
                         ↓
           AUDIT_READY verify tail（釋放 BUILD slot）
                         ↓
                 EARLY_SOL_DIFF_AUDIT
                         ↓
                  TEST_VALIDATION
                         ↓
                 FINAL_SOL_AUDIT
                         ↓
              LUNA_CLOSEOUT + METRICS
                         ↓
                     NEXT LOOP
```

`AUDIT_READY` tail 只釋放 BUILD occupancy，不增加 WIP 上限，也不讓 TEST／Final Risk／merge 變成多線。

PROVIDER_FIRST（Owner 2026-09-30 澄清）：先以 session／runtime 的 provider metadata 判定 OpenAI 或 Claude；不能由 `CLAUDE.md` 檔名、repo SDK 或模型前綴猜 actual。再查該環境的 runtime catalog，依角色、任務大小與風險選擇可用模型，記錄 provider 證據及 requested／actual；無可靠 observed identity 就填 unknown。其他 provider 的模型缺席不是 blocker，禁止派送不可用的跨 provider 模型。

OpenAI：Luna6 做窄盤點／QA；Owner 2026-10-01T00:01:00Z 因成本／可用性將 OpenAI Terra 施工模型改為 `gpt-6.1-sol`，同 ID 可分別承擔 build 與 audit，但必須由不同 actor／session 獨立審查，builder 不得自審放行。Claude：依任務選 Haiku／Sonnet5.5／Opus5.5，Sonnet 對應 build、Opus 對應 audit；對應不變。真正缺少本地適任 builder 才記 local builder blocker。決策：`docs/decisions/2026-10-01-owner-openai-sol61-builder.md`。

| 角色 | 主要工作 | OpenAI | Anthropic | 禁止事項 |
|---|---|---|---|---|
| Luna / scout | 真實盤點、Closure、CI 摘要、Janitor、文件、QA、Metrics | `gpt-6-luna` | `claude-haiku-4-5` | 不做產品／安全決策，不展開大型 code |
| Terra / build | Product 施工（MAIN／RESERVE） | `gpt-6.1-sol` | `claude-sonnet-5-5` | 不擴大驗收、不自行關 Issue、不自審放行 |
| Sol / audit | TRIAGE、早期 diff audit、模糊 CI、高風險設計、final Audit | `gpt-6.1-sol` | `claude-opus-5-5` | 不做 grep、輪詢、一般 CRUD、完整舊對話重讀 |

2026-09-30 Owner 只更新目前 role model 版本：Sol 6.1、Luna 6、Sonnet／Opus 5.5；
該歷史版本裁示的 OpenAI Terra 已由 2026-10-01 決策更新；Astra／Fable 及角色／風險／可信審查契約保留。設定的 `modelMappingVersion`
與審查 `policyVersion` 分開，既有 receipt 不改寫。派工前查 runtime catalog；
模型已發布或已寫入設定，不代表本 runtime 可用；目前派工依上方 PROVIDER_FIRST 選擇原則。

Product lane 決定工作責任與所需能力。Terra 一律使用 build 層；不得用 scout 或未獲 build 授權的 audit 層模型做任何 Product 施工（OpenAI `gpt-6.1-sol` 已獲 build 授權；Anthropic Opus 仍禁止施工），
也不得把 builder 自審宣稱為獨立 audit。模型版本表是 provider-local 選擇起點，不是跨 provider 強制派工。平台無法證明 actual model 時填 `actual=unknown`，
不得由 lane 名稱推定。

## 5. 全域 B+ WIP 上限

```text
MAIN_TERRA BUILD qualified target 2；不 qualified safety fallback 1；hard max 2 → AGENT_LANE=TERRA_BUILD
VERIFY_TAIL      qualified TERRA_BUILD + ACTIVE + AUDIT_READY；不占 BUILD slot但仍占 ACTIVE_CANDIDATE
RESERVE_TERRA    max 1；雙 Terra BUILD 時固定 0 → AGENT_LANE=TERRA_RESERVE
LUNA_CLOSURE     max 1 → AGENT_LANE=LUNA_CLOSURE
TEST_VALIDATION  max 1 → AGENT_LANE=TEST_VALIDATION
ACTIVE_CANDIDATE max 3 → BUILD 與 AUDIT_READY tail 合計仍不得超過 3
LUNA_TASKS       default 4，max 6，另有 1 位 Aggregator
```

### 5.1 MAIN_TERRA

- 有兩張同 Run、互不衝突、executable Guard 判定 qualified 的 Product slices 時，throughput target 是維持兩個 BUILD slots；沒有第二張安全候選、candidate cap 不足、local isolation 不健康或 hot boundary 衝突時安全降級一條。
- 雙 Terra qualification 不變：不同 primary Issue、`TERRA_SLOT` 1／2、不同 `TEST_ENV_ID`、零重疊 `FILE_OWNERSHIP`、各自健康的 local isolated 證據，且 Guard 在啟動前判定 qualified。兩張 BUILD 同時存在時 Reserve 固定為 0。
- Source exact head 完成並凍結後，`TERRA_BUILD + LANE_STATE=ACTIVE + ACTIVE_CANDIDATE=true + COMPLETION_CLAIM=AUDIT_READY` 只有在 `DUAL_TERRA_PILOT=true` 且上述 isolation／ownership contract 完整時，才不再占 BUILD slot；它仍占 active candidate WIP，仍走原本 CI／TEST／Final Risk／merge。
- `AUDIT_READY` verification tail 期間不得修改 source。CI／review／Final Risk 要求 source repair 時，必須先把 `COMPLETION_CLAIM` 降回 `IN_PROGRESS`，再改 source；修完並重新驗證後才能再次宣告 `AUDIT_READY`。
- BUILD slot 因 `AUDIT_READY`、merge 或完整 blocker 釋放後，只要 `ACTIVE_CANDIDATE < 3` 且有另一張 qualified independent Product slice，就 continuous refill；但候選排序必須先套 §1.5 Environment Delivery backpressure。已 merged source 等待 TEST／Production／activation／acceptance 時，由 Lane A 優先推既有交付尾段；獨立 Lane B 依 §1.5 維持使用者可見施工，不因 unrelated environment debt 一併停工。
- 新 BUILD 與 `AUDIT_READY` tail，以及兩個 verification tail 彼此的 `FILE_OWNERSHIP` 不得重疊。相同 schema／migration ledger、auth／RLS、payment／refund、mutable provider boundary 視為 hot boundary，不平行施工。
- 必須一路做到 `CLOSED`、`AUDIT_READY` 或完整 `OWNER_BLOCKED`。`PR 已開`、`CI 綠`、`正在等 Preview` 本身不是完成。
- WIP=3、Terra BUILD hard max=2、shared TEST=1、Final Risk=1、Merge=1 均不因 continuous refill 改變。

### 5.2 RESERVE_TERRA

- 只有 MAIN 正在等 CI、TEST、Preview 或外部唯讀結果，且 MAIN 沒有可繼續的 source 工作時
  才可啟動。
- 必須明寫 `RESERVE_BOUNDARY`。
- 只做必要規格、紅燈測試、獨立 source slice、unit／typecheck／build、最多一個原子 commit。
- 不得持有 TEST lane、進 Sol Audit、開第二輪 full CI、碰 MAIN hot files或吸入鄰近問題。
- 完成後停在 `READY_FOR_PROMOTION`；MAIN 進入出口後由 Sol 決定升格或 Park。

### 5.3 LUNA_CLOSURE

- 每輪固定執行；優先掃 open PR、近期 CI、上一輪 closeability ≥3 候選，先限 5 個。
- 可整理 exact-head 證據、checkbox、Preview、Janitor、機械 closeout。
- 沒有候選必須輸出 `EMPTY_WITH_SCAN` 和已檢查清單。

### 5.4 ACTIVE_CANDIDATE

- 全 repo最多 3 張（Owner 2026-09-09 由 2 調整）。`AUDIT_READY` verification tail **繼續算 active candidate**，所以可存在 2 BUILD + 1 tail，但第 4 張 candidate 仍必須 fail closed。
- RESERVE、TEST、Parked、Historical、Owner-blocked 不得標 active candidate。
- 舊 Mode C PR 不是因為 open 就自動 active；必須經 B+ TRIAGE 重新分配。

## 6. Luna 小隊與 Token 節流

預設可並行：

```text
LUNA_TRUTH
LUNA_CLOSURE
LUNA_CI
LUNA_JANITOR
LUNA_DOCS
LUNA_QA
LUNA_METRICS
```

每個 Luna 任務必須包含：

```text
TASK_ID
ISSUE / PR
EXACT_HEAD
單一 QUESTION
READ_ONLY_PATHS
DO_NOT_READ
OUTPUT_MAX_LINES（預設 15）
ALLOWED_RESULT
```

- 不把完整舊 Session 或全 repo 複製給每位 Luna。
- 不讓兩位 Luna 重做同一盤點。
- 一位 Luna Aggregator 把結果壓成最多 30 行再交 Sol。
- Luna 發現新問題只分類為 blocking／backlog／duplicate／Owner-blocked／needs-triage；不得
  自行把所有問題塞進 MAIN PR。

## 7. Sol 使用上限與 Product Final Risk

一般 Issue：

```text
TRIAGE 1 次
AUDIT  1 次
```

只有 Auth、DB、付款、權限、跨租戶、安全、模糊 CI 或重大 collision 才允許一次額外
DIAGNOSE。平台不能證明實際 delegated model 時記 `actual=unknown`，不得冒充。

TRIAGE 固定輸出：

```text
RUN_ID
MAIN_TERRA
RESERVE_TERRA
CLOSURE_TARGET
CLOSEABILITY_SCORE
SELECTION_REASON
DEPENDENCIES
OWNER_OR_EXTERNAL_BLOCKER
TEST_REQUIRED
RESERVE_BOUNDARY
RISK
ACCEPTANCE_GATES
WHY_NOT_CLOSER_CANDIDATE
```

Closeability：5 幾乎可關；4 差一步；3 最多兩步可 Audit；2 需明顯施工；1 主要外部或
大型依賴；0 stale／duplicate／superseded。

### 7.1 Early Sol 與 final Sol 不可混用

- Terra 有可審完整 diff 後可做一次 early Sol diff audit。
- early audit 只能給建議或 `FIX_REQUIRED`，不得 `CLOSE_APPROVED`。
- 必要修正、local isolated／canonical TEST 完成後，final Sol 必須對 final exact head 重讀。
- head 真正改變時不得拿 early verdict 當放行。

### 7.2 Product Final Risk

#### 獨立角色來源與 provider-local catalog 准入

`openaiBuilderDecision.independentReviewerRequired=true` 時，live review approval 必須有 current builder 與 reviewer 的獨立執行來源；只設 flag、換模型 ID 或在 review 自填 `trusted=true` 不足以放行。
PR body 增加 `BUILDER_EXECUTION_RECEIPT: https://github.com/<owner>/<repo>/pull/<n>#issuecomment-<id>`（同 repo 的 Issue comment 亦可）；canonical `astra-review` 增加 `reviewerExecutionReceipt` 指向另一筆同 repo comment。兩個 locator 不作證據本身：GitHub adapter 必須 GET 回讀、驗 canonical html_url、可信 write/maintain/admin 提交者或既有 trusted bot，不執行 comment 內容。
每筆 comment 只有一個 `agent-role-execution` fenced JSON，schema：`role`=BUILD|REVIEW、`repository`、`headSha`、`changeDigest`、runtime `actorId`／`sessionId`／`executionRef`、UTC `startedAt`／`completedAt`、`executionEvidence`=OPERATOR_ATTESTED；REVIEW 另有 `freshContext: true`。這是可信操作者對角色執行的背書，不是 provider-signed telemetry；缺實際 actor/session capture 就 pending，不能由 PR author／lane／requested model 推定。
回讀內容必須綁 reviewed head/digest/repository；普通 Sol 是 current exact head，高風險純換底只可依下述 semantic reuse 沿用原 reviewed head。review actor/session/execution 與 builder 不同，review 開始不早於 builder 完成，review executionRef 等於 attestation executionRef。comment updatedAt 不能晚於 review submittedAt、completedAt 不能晚於 comment；編輯後須新 review。缺、foreign、stale、self-review 或 latest finding 未解均不 approval。歷史 source/model metadata 可只讀還原，不取代 live role gate。
角色獨立不把 `actual=unknown` 升為 served verified。AUDIT／PREMIUM 保留原模型 identity 契約；無 selector 的 CURRENT_AGENT 如實 unknown，但仍需另一 actor/fresh context 的實際角色證據。沒有合規獨立 actor 就 park，不虛稱 PASS。

普通 Product final Sol 也須獨立角色，不因 `ASTRA_RISK:NONE` 或 Final Risk `NOT_REQUIRED` 略過。是否進 final 准入由 live PR open/draft/lane 決定，不能用 payload 自填 BUILD 豁免；Draft 施工仍可收集 TEST 證據，純治理免 Product 角色收據。
可信 canonical `sol-review` JSON 記 `repository/headSha/changeDigest/policyVersion/requestedModel/actualModel/identityEvidence/executionRef/reviewerExecutionReceipt/verdict/report/findings`；REVIEW 角色收據另記 `provider/providerEvidenceRef/requestedModel`，驗同 provider 的 Sol／Opus request。未知 actual 只能 `identityEvidence: UNKNOWN`、`servedVerified: false`，不能冒充模型已驗；普通審查不要求 Astra 諮詢或 ASTRA schema baseline。
高風險 semantic reuse 必須是最新可信 canonical PASS，GitHub `commit_id` 等於 attested 原 head，且 repository/digest/policy/test/schema 基線與現在一致；原角色收據/source/time/model 不改寫。實質變更或最新 finding 仍拒絕，新 head 仍須 exact-head CI，不重置 #552 budget。
review submitted/edited/dismissed 的無權限 wake-up 由 trusted-main guard 回讀 canonical event/PR/reviews 再刷新 stable status；不信任分支程式、artifact 或 producer 結論。review 事件不派 TEST，最新否決不可留下舊成功放行；工具或來源無法查證時如實 pending。

新 premium reservation 和 audit fallback 先驗 `provider`=OPENAI|ANTHROPIC、明確 `availableModels`、當次 `runtimeCatalog`（provider／models／providerEvidenceRef／evidenceRef／captureStartedAt／observedAt），captureStartedAt ≤ observedAt ≤ current request `now`。來源須為當次 runtime metadata/catalog 觀測，不是 repo config 或模型發佈消息；函式只驗觀測 record，不認證 backend 可用性，不另創 TTL。
OpenAI premium 只 Astra、Anthropic premium 只 Fable；audit 只同 provider 已觀測的 Sol／Opus。缺／未知 provider/catalog 不回退全 allowlist 或猜另一 provider 模型：有 selector 但證據缺就 park，只有明確無 selector 才走既有 CURRENT_AGENT。#552 同 lineage 合計一次、零昂貴同級 retry、300 秒無執行證據及首次 infra failure 降級數值全部保留。

DB release preflight 尚未接入可信 role context；enabled policy 下缺此證據安全拒絕，不把本節 source review 當 Production 操作許可。

#### 有界原生任務身分試行（Owner 2026-10-09；2026-10-10 精確範圍更新）

當前 active singleton 只限 #848：trusted-main `model-routing.json.nativeRolePilot` 已啟用且
repository=`smallwei0301/vibeaico-admin-rebuild`、PR=848、exact head
`8e85baf04a3e9a8d556ed8abd71c2ad789be468b`、完整四檔 changeDigest
`d9c1f7cffeeed4436e4bd31ea211e1235d70e83294c12a876c249793b1539790`、
`PRODUCT_SOURCE_FINAL_RISK` 全相符，才可用 `executionIdentityKind=NATIVE_TASK`。
Owner `2026-10-10T12:46:54.792160Z` 批准此有界治理改動；正常治理測試／獨立審查／main 合併及回讀後才生效。
新的 BUILD 任務必須新鮮接手並完整驗證上述既有 source，明寫 adoption／full verification，不能冒稱原作者。
不得重用或重建原 BUILD 缺失的 spawn UTC／actor/session，也沒有新增歷史身分或時間豁免。
#848 的 `adoptionApprovedAt` 必須保留上述精確 UTC；BUILD／REVIEW spawn 均不得早於批准，
以完整小數秒比較，不向下截成毫秒。BUILD 另保存親見 `nativeTaskEvidence.policyReadback`：
`sourceKind=OPERATOR_WITNESSED`、當前 version、mainSha、observedAt；批准 ≤ BUILD policy 回讀 ≤ spawn ≤ work start。
BUILD 與 REVIEW 的 policyReadback.mainSha 必須相同；canonical 路徑另比對既有 trusted
`nativePolicyEvidence.reviewedMainSha`，沿 adapter 的真實 main bytes／ancestry／config generation 驗證。
候選自填 main 或公開摘要不能自行啟用；缺回讀、不同 main/version、回讀晚於 spawn 均 pending。
這個精確採用時間窗只限 #848，#843 歷史時序／NOT_CAPTURED 條件不變。
新 FINAL 必須另建獨立任務，沿下列原有完成、canonical BUILD 與 enabled-main 回讀順序執行。

#843 的 exact47f `47f259db7b2f4ab50b08c0962cc8d6f676575fd0`／六檔 digest
`18ee75322cafca9148e043cee7ba518ea767ab4f8449fd6eb655c8cb5192b6ba`（Owner 2026-10-10 01:09:48 UTC），以及
原初版 exact07d `07d360c50c6eb60486fa4f3bc21d0f713d6e2bbb`／六檔 digest
`8da954f36f1e6ea03bac4be9c24f203f75273494dab11b8f49829fca2d7664a3`（Owner 2026-10-09）保留為歷史設定／shape fixtures；
兩者都不是當前准入範圍。沒有 multi-scope allowlist；其他 repo／PR／head／digest／surface、
#836、DB release／G5／writer 均不適用。治理 bootstrap PR 不能用此規則自批。
BUILD／REVIEW 仍是原角色；actorId／sessionId 必須 null、backendIdentityAvailability=UNEXPOSED，
actualModel=unknown、identityEvidence=UNKNOWN、servedVerified=false。task_name／executionRef 是操作者限定範圍內的
識別，不是平台 actor/session，也不宣稱全球唯一。舊完整 backend 來源契約維持不變。

同一 canonical 角色 comment 內的 `nativeTaskEvidence` schemaVersion=1 保存 operatorLogin/id、namespace、
captureGeneration、taskName、executionRefBasis=OPERATOR_SCOPED_NATIVE_TASK、performedWorkScope、compiledAt，
以及 spawn（親見 request/result、角色與 UTC）、work（親見或明標 WORKER_REPORTED、起點與成果 hash）、
completion（親見 BOUNDED_WORK_COMPLETED、停筆、head/digest 與 UTC）。原 request message 應逐字保存；
下列相容性只描述原初版 exact07d／原 digest 的既有 BUILD `/root/implement_843_pg_harness`，不移植至新版本。其親見 spawn 參數與工作／完成已記錄但
原 message 未保存時，可明寫 `spawn.request.message=null`、`spawn.requestMessageAvailability=NOT_CAPTURED`。
這是 capture 缺口，不准用後來的摘要補成原 prompt；不能省略其他必要親見事實、model／fork／reasoning／UTC／hash。
有原文者維持非空 message，availability 可省略或為 CAPTURED；相矛盾或未知 availability 拒絕。
新版本 BUILD 與所有新 REVIEW 必須保存真實原 message（公開 CAPTURED 或下列私下保留模式），不能沿用這個歷史 BUILD 表示；其他 task／PR／head／DB 不適用。
此分支另綁既有 `executionRef=native-task:/root/implement_843_pg_harness`，以及2026-10-09 UTC的
spawn觀測14:28:16Z、work起點14:32:26Z、bounded完成15:32:00Z；比較相同瞬間，不接受較晚同名任務或寬時間窗。
起點來自既有 worker checkpoint、完成來自父方親見完成回報，仍不是精確first/last-write或backend生命週期。
歷史namespace／capture generation未保存，保持UNKNOWN；receipt的scope labels只限定當次operator整理範圍，
不補造歷史UUID。這組ref／時間只拒絕已表達的不同事件，仍不能認證完整倒填舊值的操作者背書真偽。

當前 #848 exact8e85／完整四檔 digestd9c 的私下保留模式，須由 trusted-main pilot 明開
`privateMessageMode=PR848_RETAINED_ORIGINAL_V1`。BUILD／REVIEW 必須確實保存新任務的真實原 request message；可公開 CAPTURED，或使用下列 private commitment。
歷史 #843 exact47f／digest18ee 的 `PR843_RETAINED_ORIGINAL_V1`（Owner 2026-10-10 02:25:29 UTC）
只保留原精確 shape 回播，不是現行 active scope；舊模式不能接受 #848，新模式不能接受 #843。
兩個模式共用以下真實保留／格式／角色綁定限制，不以 hash 冒充原文。私下保留時使用
`spawn.requestMessageAvailability=WITHHELD_PRIVATE`、`spawn.request.message=null`，另放 `spawn.privateMessage`：
- schemaVersion=1、encoding=UTF-8、sha256 為逐字原 message UTF-8 bytes 的完整 SHA256、byteLength 為正安全整數。
- retention=ORIGINAL_VERBATIM_RETAINED_PRIVATELY；操作者必須確實私下保留原文，不公布私密原文或內部路徑。
- attestation=OPERATOR_ATTESTS_ORIGINAL_CAPTURE_HASH_AND_SCOPE；publicWorkScope 是可公開的工作範圍，
  必須等於 performedWorkScope，不是原始 message 或其逐字替代品。
- repository／prNumber／headSha／changeDigest／role 綁精確來源；taskName／executionRef／operatorLogin／operatorId
  綁該角色操作者；spawnObservedAt／workStartedAt／workCompletedAt／workArtifactSha256／attestedAt
  分別逐字等於該角色的 spawn.observedAt／startedAt／completedAt／work.artifactSha256／compiledAt。
原文與私密 commitment 不可混用；CAPTURED／NOT_CAPTURED 不得帶 privateMessage。沒有保存原文者不能使用此模式。
GitHub 公開讀取端只驗格式、提交者及上述一致性，**無法重算私下原文的 hash、證明 byteLength、retention 或工作範圍背書真實**；
完整偽造且自洽的操作者背書仍可能通過。Owner 明確接受此限制；hash 不冒充原文，也不宣稱防止所有偽造。
既有 separate fresh FINAL REVIEW、BUILD 完成後及 main 政策／canonical BUILD 回讀後才 spawn 的時間關卡不變。
其他 repo／PR／head／digest、DB／Production、治理 bootstrap 均不適用；歷史 NOT_CAPTURED 的精確條件完全不擴張。

時間以 OBSERVED_ROLE_WORK 表示真實
工作區段，不冒稱精確 first/last-write 或 backend session 起訖；CI 結束不能代替角色完成。
REVIEW 另需不同 task/execution/comment、reviewPhase=FINAL、participatedInBuild=false、contextIsolationAttested=true；
原 spawn request 必須 fork_turns=none，freshContext=true 是 receipt 背書，**不是 spawn 參數**。
新 final REVIEW 必須在 BUILD 完成及 canonical receipt／已啟用 main 政策回讀後才新建，保留 builderReadback 的 URL／body hash／updatedAt／
observedAt，以及已啟用 main 的 policyReadback（version／mainSha／observedAt）；兩項均明標親見。
canonical review 另綁 nativeRolePolicyVersion；既有 EARLY 不重命名為 final。初版完整欄位由 shared
`nativeRoleShapeErrors` 與 synthetic regression 定義；local preflight 永遠 canonicalReadbackVerified=false。

這是 Owner 明確接受的**可信操作者親見背書**。GitHub 回讀核實 comment 提交者權限、bytes、時間與一致性，
無法獨立認證內嵌工具摘錄、原 spawn 或隱藏 session 是否真的不同；完整不實背書仍可能無法辨識。
沒有親見必要事實就 pending，不補造來源、時間或身份。新 reviewer 必須親見政策已進 main 後才開始工作。
adapter 重新核 current-main policy bytes、當前 config generation 與所錄 main 的 ancestry；branch-only 設定不能啟用。
config generation 改變（含中間 disable／re-enable）後須重新留證；無關 main 前進但 config 不變不強迫重審。
policy 關閉、source 漂移、證據缺漏或矛盾即無 native 准入資格。沿既有同 PR comment edit/delete、review 及 main
wake-up 重查；來源定位／讀取／status 寫入失敗記 REFRESH_UNVERIFIED，舊綠可能仍可見，不能聲稱已撤回。
合併前必須核 live policy、有效 guard、body/files/base/head publication receipt 及其他全部 gates。
#552 成本／provider／模型身份、source GOVERNANCE_GATE、最新 finding、ownership／容量、CI／TEST、發布保護不變。
source-only transport 的 canonical TEST 仍是合併後另依授權執行；本試行不新增前置 TEST、不授予 DB／Production 權限。

Product 高後果範圍才需要 Final Risk，例如：

- `PAYMENT_CONSISTENCY`
- `TENANT_AUTH_BOUNDARY`
- `IRREVERSIBLE_DATA`
- `CROSS_REPO_CONTRACT`
- 不可拆的 `GOVERNANCE_GATE`
- `UNRESOLVED_HIGH_RISK`

Owner 2026-09-17 #552 已授權成本降級，取代 #533 的同級重試／互換：

Owner 2026-09-30 11:59 UTC（#700）補充：模型派送、可用性或身份證據失敗不得形成無限阻塞。
先保存可回讀的失敗原因，再由可用 reviewer／目前 agent 執行真實替代對抗審查，並把預防方式記入 Playbook；
引用必須由可信讀取端回讀本 repo 本次 PR 的確切 comment／review 與 current-main immutable Playbook blob；候選 payload／工作樹不能自證來源。失敗與替代來源限定同一 PR，沿既有 comment edit/delete 與 review edit/dismiss 喚醒即時重驗；不能引用未納入反向喚醒的其他 Issue／PR。
正常 release gates 通過後可放行，不因 `actualModel=unknown` 再向 Owner 索取授權。
canonical review 使用 `reviewerTier=EVIDENCE_FALLBACK`、`fallbackPolicyVersion=2026-09-30.1`、
`downgradeReason=REVIEWER_INFRASTRUCTURE_FAILURE`；記錄 `failureClass`、`failureEvidenceRef`、
`failureDiagnosis`、`replacementReviewRef`、`playbookEvidenceRef`，以及原有 lineage／executionRef／反例／finding 核對。
`executionEvidence=OPERATOR_ATTESTED` 只證明真實審查執行；未知模型必須 `actualModel=unknown`、`identityEvidence=UNKNOWN`，
requested 型號不當成 actual 證據。共享驗證器仍要求可信提交者、精確 digest、實質 PASS、零 unresolved finding。
已知 actual 必須為允許的 audit 模型且 requested=actual；未知身份的指定 reviewer 仍選 audit 層級，
無 selector 的目前 agent 記 not_requested。Playbook ref 綁 review.repository 的 main，不借別 repo／未合併 branch。
實質 code/security finding、SAFETY_REFUSAL／SAFETY_CLASSIFIER、失敗 CI／TEST 或 Production gate 不適用此替代路徑。
此規則不擴張 Product builder 模型權限，不授予 Production 寫入；#552 的歷史有效證據仍可沿用。
此替代路徑仍須通過本節 current builder/reviewer 獨立角色回讀與 provider-local runtime catalog；
有 selector 但缺本地 audit catalog 仍 park，明確無 selector 保留 CURRENT_AGENT。DB adapter 缺可信角色 context 仍拒絕。

- 同一 reviewLineage 最多一次 Astra/Fable 昂貴諮詢，兩者合計，不是各一次。
- 第一次諮詢後修改重審，或已派送無回應／環境不支援，直接 Sol／Opus，不再昂貴第二輪。
- 派送起 300 秒沒有同 executionRef 的實際 RUNNING／token／tool 執行證據就降級；
  排隊、接受請求、自述執行不算。已證明執行的唯一一輪不以五分鐘總時長截斷。
- 無 model selector 時，允許目前 agent/model 真實對抗審查；未知型號如實記 unknown，不能冒充。
- prepare/recover 使用 `scripts/agents/final-risk-cost-policy.mjs`。首次昂貴派送前先保存及回讀
  唯一預算紀錄；新 head／Session／替代 PR 不歸零，歷史不明就降級。
- 降級仍需 current digest、真實反例、舊 finding 核對、可信提交者與新 PASS；不是免審。
- tier／reason／lineage／executionRef／adversarialEvidence 必須記進 canonical review；WIP
  與 DB release 共用同一驗證器，CURRENT_AGENT 不視為獨立指定模型審查。
- 取消／隔離超時原任務後再降級（runtime 支援時），不得並行燒兩份審查；無可用便宜路徑才 park。
- Final Risk blocker 的日常判讀一律依 §2.0.2；**缺 PASS、證據過期或 deferred 本身不等於 Owner blocker**，不得把可由目前 trusted actor 自主提交／refresh 的證據工作上拋給 Owner。

完整欄位與證據契約：`docs/decisions/2026-09-17-owner-final-risk-cost-downgrade.md`。
模型型號由 trusted-main `scripts/agents/model-routing.json` 維護；本授權不改 Production 操作門檻。
一般 Sol AUDIT 次數不拿來阻擋本授權的降級 Final Risk；同一份當前來源對抗證據能同時滿足兩者時，不重複派工。

- 一般 UI、文案、小型接線不因是 Product PR 就自動要求 Final Risk。
- 正式庫寫入是 §3.2 的獨立操作關卡：本次 Production DB release 一律要高風險審查，不能只沿用 source PR 的免審分類。
- Final Risk 綁 `changeDigest`／實質 changed-file blobs，不因無關 main 前進或純 rebase 自動重跑 semantic review。
- 最新 `FIX_REQUIRED`／`CHANGES_REQUESTED`／`DISMISSED` 不得被較舊 PASS 蓋掉。
- 純 `MODEL_GOVERNANCE` 不要求 Astra/Fable Final Risk。

## 8. CI 與 shared TEST

- docs-only 不安裝 npm、不讀 TEST secret、不跑 Chromium。
- 一般 runtime PR 跑 typecheck／unit／build，但若不是唯一 Active `TEST_VALIDATION` holder，
  integration／E2E 留下成功的 `POLICY_SKIP`，不得碰 shared TEST。
- 只有唯一 TEST holder 與 `main` push 可以使用 TEST secrets 並進
  `shared-test-supabase-integration`。
- Branch 手動 full CI 必須證明 exact PR、exact branch、exact SHA 與唯一 holder。
- 同一 exact head、同一環境、同一命令不盲目重跑。
- 一般 CI 環境錯誤連續兩次後停止該路徑；Final Risk 昂貴派送適用 §7.2，更嚴格為首次故障直接降級，不套用兩次重試規則。
- 任何 Git Data API／遠端 tree 重建完成後，必須先驗證 exact head：
  `npm run guard:repo-integrity` → `npm ci` → `npm run typecheck` → `npm test` →
  `npm run build`。前一步未通過，不得更新 `preview/**`、不得把 Vercel build 當第一道語法檢查，
  也不得用另一個 no-op commit 重試。
- 完整性閘門至少驗證 `package.json`、`package-lock.json`、`src/app/`、`src/server/` 仍存在，
  刪檔量未超過安全上限，且受控程式檔沒有單獨一行的 40 碼 Git SHA。
- 相依套件只接受 lockfile 可重現的版本；`package.json` 與 `package-lock.json` 一起改，乾淨
  `npm ci` 是必要證據。不存在的版本、peer 衝突或 lockfile 不一致都在 Preview 前停止。

CI 失敗由 Luna 先壓縮：exact head、job／step、suite／case、錯誤碼、重現性、TEST holder、
環境變化。明確 code bug 交 MAIN Terra；模糊或高風險才交 Sol。

### 8.1 候選 regression 與既有 main-health defect 分開判斷

對 unrelated TEST／E2E failure 做 current-main baseline comparison：同一可比較的環境、命令／case 與失敗特徵，候選 exact head 的 scoped acceptance 全 PASS，且 current main 也出現同一 failure，才記 `CANDIDATE_REGRESSION=NO`、`MAIN_HEALTH_DEFECT=YES`。保留兩個 SHA、run／job／case、環境與時間證據；單次 timeout、舊 baseline 或相似錯誤訊息不夠。

原 Product candidate 繼續自己的 merge／acceptance gate；既有 main-health Issue 可沿用，缺少時建立有實證的對應 Issue。無關 welcome-card、chat、report failure 不得自動把整張無關 Product PR PARKED。若可能共享 auth、RLS、DB transaction、payment、tenant boundary、migration dependency 或同一 runtime contract，仍 fail closed；無法排除依賴時先查明。

這不把失敗 check 改成成功，不以 scoped PASS 代替其他適用必要驗證，也不繞 branch protection。現有 required check 不支援此區分時，只修它實際的分類／接線問題或保留精確 technical blocker，不能要求 Owner 豁免安全，也不新增大型治理系統。

## 9. PR、Janitor、Completion Truth 與交接

- 一個 Issue 只保留一張 ACTIVE implementation；必要時一張短命 VALIDATION。
- `PARKED` PR 不派 Agent、不 push、不 rerun、不輪詢；重新啟動前先依所屬 Workstream 重新 TRIAGE。
- Janitor 只有 explicit supersedes、同 Issue、同 repo、ancestry／patch coverage 與 mutation
  前重新驗證都成立才自動關；否則 `JANITOR_REVIEW`。
- 交接只傳 Issue、stage、lane、base/head、PR、scope、changed、evidence、latest error、
  TEST、risk、unproven、next、requested／actual model、RUN_ID 與 scorecard path。
- 不貼整份 CI log，不複製完整舊對話。

### 9.0 收尾以 GitHub 真實開關狀態為準

- 已合併 PR 清除 `state:active`／`candidate:active` 與已終止的 lane 警報，標示
  `state:complete`；未合併而關閉的 PR 標示 `state:historical`，不能冒充已完成產品。
- closed 事件只收工作位置與標籤，不重寫歷史 CI／review／WIP 結果為 pending，不觸發 TEST。
  清除警報標籤不表示那次錯誤沒有發生；原留言與執行歷史必須保留。
- 分類與 WIP workflow 只增刪各自管理的標籤，不能用整包取代抹掉另一支 workflow 的更新。
- 重複候選先逐項確認被取代的內容與真正殘留缺口，再沿用既有 PR 縮範圍；不得重做已合併工作。
- stacked PR（相依分支）不是 WIP 豁免。需明確列出當前施工者、等待的相依與短命驗證位置；
  清理者不能擅自停掉其他 Agent 的在途工作、刪其分支，或為消除警報虛構 Owner 例外。

### 9.0.1 POST_MERGE_CLOSEOUT Lite：truth sync 阻塞、行政收尾背景（Owner 2026-10-06）

原 PR 依 §9.2 驗證已 merge 到目標 main 後，同回合先完成 BLOCKING CLOSEOUT（下列1–4及PR current-state同步），確認下一個安全施工slice即可refill。下列5–6與 metrics／scorecard 的報表評分整理、歷史文書清理、完整 ledger 文書及 lifecycle 美化屬 NONBLOCKING CLOSEOUT，由背景或 Closure lane 接續，不阻止同 Issue 下一個 bounded Product slice。依既有 §10 要求在下一次派工前完成的 raw fact／Completion Truth capture、readiness，或現有合法 RUN_CAPTURE_HANDOFF，仍屬 BLOCKING truth sync；不得以「ledger 文書」之名延後必要事實記錄或略過該准入。

若涉及 safety violation、tenant isolation、payment/refund、data loss、Production incident，或schema/runtime compatibility仍不明，維持完整同步阻塞。行政尾項仍須完成；不得把實際安全／相容／Completion Truth證據缺口改名為行政事項。
1. **重新讀 live Issue／PR／main。** 核對 merged PR、merge commit、current main、關聯 Issue、
   acceptance checklist、相依與尚未完成範圍，不能用 merge 前快照清理。
2. **清 Issue state 與 labels。** 已完成就用正確 state reason 關閉，移除已失效的
   `state:active`、`candidate:active`、舊 lane、已解除的 blocked／pending 警報；保留 workstream、origin、
   歷史／稽核分類。若仍有真實未完成範圍，不得為了漂亮狀態硬關，必須留下精確 remaining scope。
3. **同步 Issue body 本體。** 更新 checklist、CURRENT STATUS、已解除 blocker／dependency、被取代敘述與
   `REMAINING_BOUNDED_SCOPE`；保留問題背景與歷史決策，不把舊內容刪到無法稽核。舊 body 若會讓下一個
   Agent 誤以為已完成工作仍需重做，必須明確標示 resolved／superseded，而不是只靠最新留言猜現況。
4. **留下 authoritative closeout comment。** 至少寫 PR、merge SHA、current main、exact-head CI／必要驗收、
   Issue 最終或剩餘狀態、以及 `PLAYBOOK_DELTA`。歷史留言、CI、review 不刪除；新的 closeout comment
   是接手者判讀 live 狀態的最後索引，不把錯誤曾經發生過的證據洗掉。
5. **檢查 PR→merge 過程的問題與教訓。** 至少掃過 preflight／metadata、CI、TEST、review／Final Risk、
   branch/base/merge、provider／環境、post-merge reread。若出現實質失敗、錯誤診斷、重跑、阻塞、
   lifecycle 漂移或可重用教訓，必須在 `docs/AGENT-PLAYBOOK.md` 更新相同根因的既有 PB 條目；沒有相同
   根因才新增 PB。更新至少包含最近發生、次數、Issue／PR／CI 證據、本次修正、預防與驗證。
6. **Playbook 必須真的進 main。** 若教訓在原 PR merge 後才完整形成，開最小 docs-only governance follow-up
   讓 Playbook 更新經正常 branch protection 進 main；在該更新 merge 前，原 Issue 的 closeout 只能記
   `PLAYBOOK_DELTA: PENDING`，不能稱完整收尾。若本次沒有任何新的或重複的實質教訓，禁止硬造條目，
   closeout comment 明寫 `PLAYBOOK_DELTA: NONE` 與查核範圍即可。
7. **防止下一個 Agent 重工。** 只有 Issue state／labels／body／closeout comment 與適用的 Playbook delta都完成，才算 `POST_MERGE_CLOSEOUT=COMPLETE`。BLOCKING CLOSEOUT完成後即可接已確認安全的 `REMAINING_BOUNDED_SCOPE`；仍待背景文書時明列未完成項目，不重做已merged範圍、不冒完整closeout。

**PR current-state 同步也是 closeout 本體，不是可選美化。** PR 一旦 merge／close，若本文仍留下
`MERGE_STATUS: NOT_REQUESTED`、`LANE_STATE: ACTIVE`、`ACTIVE_CANDIDATE: true`、舊 blocker 或其他會把
下一個 Agent 導回施工中的 current-state 欄位，同一工作回合必須更新為 live terminal truth；不能只靠 Issue
留言或 GitHub 的 merged badge 讓接手者自行猜。若工具／權限／併發使本文當回合無法更新，必須留下
`STATE_SYNC_PENDING`，精確列出 PR、已驗證 terminal state、尚未同步欄位、失敗 action／error 與下一個合法
寫入路徑；在清掉這個 pending 前不得宣稱 `POST_MERGE_CLOSEOUT=COMPLETE`。

### 9.0.1.1 Product Issue close admission：先證明可關，再送 close
Product Issue 的 GitHub `closed` 事件由 trusted `product-issue-close-guard` 機械驗證。關閉前同回合留下 `RUN_CAPTURE_HANDOFF`，至少含 `RUN_ID`、`EVENT: ISSUE_CLOSE_READY`、current-main canonical CI `EVIDENCE_REF`、同 Issue trusted final Sol `CLOSE_APPROVED_REF`、`REVIEWED_HEAD`、`OBSERVED_AT`、`WRITER_BLOCKER`、`NEXT_SAFE_WRITE_PATH`。
close guard 重新讀 live Issue、current main、owning v4 Product Run、open/merged PR、canonical CI 與 final Sol approval。handoff 必須在 close 前建立/最後編輯且不超過 6 小時；Run 必須 OPEN 且 sources 含本 Issue；final Sol approval 必須同 Issue／同 RUN_ID／本次 close generation，`EXACT_HEAD=REVIEWED_HEAD` 且等於本 Issue 最後一張已 merge Product PR 的 source head。Squash merge 的 ancestry 以該 PR `merge_commit_sha` 對 current main 驗證，不拿 source head 冒充 merge ancestry。
CI 必須是 `.github/workflows/ci.yml` 的 current-main exact SHA `push` success，且不能有同 Issue open PR。trusted reviewer 沿用既有 immutable Agent-bot allowlist或 GitHub live write/maintain/admin permission；不得另造信任名單。任一條不成立即 reopen 並標 `governance:premature-close`，label 建立須併發冪等。
合法 close 後 workflow 留下 `ISSUE_CLOSED_OBSERVED` handoff；owning Product session 仍須 reconcile `ISSUE_CLOSED` Completion Truth 與 `delivery.issuesClosed`、重跑 readiness，再完成 `POST_MERGE_CLOSEOUT`。只有正文與 managed label 一致為 `MODEL_GOVERNANCE` 且無 Product label 才豁免；缺失、歧義或衝突一律 fail closed。

### 9.0.2 STAGE_TRUTH_SYNC：環境階段一變，就更新，不等 closeout／複盤

POST_MERGE_CLOSEOUT 不是唯一同步點。以下任何一項發生時，都視為 Product delivery stage change：

- canonical TEST migration / integration / E2E / cleanup 變成 `TEST_VERIFIED` 或失敗；
- Production G0–G7 的 blocker、readiness、apply、postcheck 狀態改變；
- `PRODUCTION_SCHEMA_READY` 成立或失效；
- PARKED runtime 因 schema ready 可恢復，或因 source/main drift 必須繼續 park；
- Vercel Production deployment truth 改變；
- authenticated Production acceptance 成功／失敗；
- live readback 推翻 Issue body、PR body 或先前 blocker。

同一工作回合內必須：

1. 更新 Issue 的 `CURRENT TRUTH`、acceptance checklist、已解除／新增 blocker 與 `REMAINING_BOUNDED_SCOPE`；
2. 若有 Run，立即寫對應 raw fact / Completion Truth claim，再跑 Live Scorecard readiness；
3. 若 stage 產生可執行 successor（例如 schema ready → runtime activation），更新／解除 PARKED 狀態後才派工；
4. 若只完成 source 或 environment 中間階段，明確保留下一階，不能關 Issue 或宣稱 shipped。

目的不是增加留言，而是讓新的 Session **只讀 GitHub 就能知道下一個安全動作**，避免 #42／#46／#396
這類「實際環境已前進、Issue 本文仍停在舊狀態」造成重工與錯誤優先序。

### 9.1 `CLOSED` 不等於 shipped

Product Issue 只有以下五階全部成立，才可計為 `shipped_unit`：

```text
SOURCE_VERIFIED
→ MERGED_TO_MAIN
→ AUTO_VERCEL_DEPLOYED
→ PRODUCTION_SCHEMA_READY
→ AUTHENTICATED_PRODUCTION_ACCEPTED
```

最後一階必須是登入正式站後的真實接受測試。缺任一階就是 `PRODUCTION_PENDING` 或其他未完成狀態；
PR merged、CI 綠、Issue closed 都不能單獨冒充已出貨。

涉及新資料庫依賴時，§3.2 的安全執行順序優先：先 PRODUCTION_SCHEMA_READY，再啟用相依程式。
上列五項交付證據仍全數必要，不授權網站先啟用、之後才補資料庫；歷史帳本與評分不回寫。

### 9.1.1 工作分類、計數資格與上線驗收分開

- #555：交付欄位是來源無關的資料契約。有 WORKSTREAM 宣告或現行分類政策適用的 open PR，
  不因 WORK_ORIGIN=OWNER／UNKNOWN、Draft 或 lane 狀態而略過既有交付檢查。
  遠端 required guard 與 Completion Truth 共用 applicability；本機 preflight 仍先驗再提交。
  closed housekeeping 仍只清位置，不重寫歷史結果；未宣告且政策不適用的歷史記錄保留原相容性。

- `WORKSTREAM` 回答工作屬於哪一條線；`COUNT_IN_DELIVERY_OUTCOME` 只回答是否納入交付計數。
  `false` 不代表治理，不得使真實 Product migration／正式驗收變成 `NOT_APPLICABLE`。
- `SLICE`／`STANDALONE` 必須 `COUNT_IN_DELIVERY_OUTCOME=true`、
  `RETROACTIVE_TRACKING_MIGRATION=false`，並提供可追蹤 Issue 與 `USER_VISIBLE_OUTCOME`。
  本機 preflight 與遠端必要 WIP guard 使用同一支驗證器；契約矛盾必須拒絕，而不是改判治理。
- 計數資格成立不等於 shipped。尚未套用正式 schema、部署或登入驗收，仍如實保留未完成階段。
  Product 非交付記錄與資料不足記錄也不能因不計數，就取得假造的 schema-ready／accepted 證據。
- `NON_PRODUCT_GOVERNANCE` 僅用於完整實際檔案已驗證為純治理且自身契約合法的記錄。
  `DELIVERY_METADATA_INVALID` 表示契約錯誤，不能當成功；`PRODUCT_NON_SHIPPING` 不代表已出貨。
- 更正舊 PR 的分類或展示時附上查證來源，保留歷史執行結果；不得改寫舊 Run 數字、補造測試，
  或把修正計數資格當成正式站驗收完成。

### 9.2 Completion Truth

宣稱 merge、close、CI 全綠、migration 套用、部署或檔案已進 main 前，必須重新讀外部狀態。
宣稱 `MERGED_TO_MAIN` 至少包含：

```text
PR merged=true / merged_at
merge_commit_sha
current main head
merge commit 對 main 可達
after-merge ref=main 關鍵檔案重讀
```

只送出 API 或只看到工作分支，只能記 `*_REQUESTED_UNVERIFIED`；不得把請求成功當成完成。

**第六項：merge 後 main CI。** 前五項只證明「PR head 綠且 merge commit 已進 main」；
宣稱正式 acceptance／shipped 前，還必須讀 `merge_commit_sha` 上 canonical `ci` workflow：
依 `.github/workflows/ci.yml` 與 exact SHA 分類：source 只採 `pull_request`，merge commit 只採 `push`；
manual TEST／G3 dispatch 另留環境證據，不互相覆蓋。每類先取最新 run／attempt 再判結果，不能挑歷史綠燈。
canonical CI 完成後由 trusted-main `workflow_run` 刷新 merged PR 證據，不執行觸發分支程式或下載其 artifacts。
只有 `conclusion=success` 是綠；`cancelled`、`timed_out`、`startup_failure` 是未知，不得當成成功；
仍在執行是 `PENDING`，查無 run 是 `NOT_REPORTED`。由 Completion Truth 現行 helper 機械判定。
main CI 未成功時不得建立 `AUTHENTICATED_PRODUCTION_ACCEPTED` 的完成主張。

## 10. Ledger、Scorecard 與復盤

每輪提交：

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

JSON 是原始帳本。schema v2／`deliveryTruthVersion: 4` 新 Run 用
`scripts/agents/run-ledger-v2.mjs init --closeout-owner ...` 建立；schema v1 與歷史 DeliveryTruth v2／v3 僅可唯讀重算，不得改寫。

### 10.1 Current scoring truth：OBSERVED_V1

- `scripts/agents/score-run-current.mjs` 是 current Product Scorecard dispatcher。
- `startedAt < 2026-09-15T00:00:00Z` 的歷史 Run 保持 `LEGACY_V2` replay，不因後來結案而切換算法。
- cutoff 起才開始、terminal + v4 Product closeout 的 Run 使用 `OBSERVED_V1`，直接從 durable raw events 與 Completion Truth 衍生分數。
- legacy manual percentages（如 first-pass、人工 evidence coverage 等）保留為 supplemental telemetry，**不再是新 Product Run 的 grading hard gate**；沒有可信 denominator 就維持 `null`，不得為了評分猜值。
- Completion Truth 未 VERIFIED、沒有 observed task records、矛盾 claim、safety violation／hard fail 仍 fail closed。
- `CLOSED` 但 Production pending 可以被評分，但不算 shipped。

Markdown report 必須由 current dispatcher 重算；不得手工改分數或用舊 `score-run-v2.mjs` 冒充 current profile。

### 10.2 Live Scorecard Contract（不要等複盤才發現沒資料）

- #556：完整 preflight 與 required WIP gate 都檢查每張 Product PR 的 Run 綁定，即使沒有修改 ledger，
  也不因 OWNER／UNKNOWN 來源或 BPLUS_MODE=false 略過。純治理不借用 Product Run。
- RUN_ID 必須對上 `docs/metrics/agent-runs/<RUN_ID>.json`；SCORECARD_PATH 可指此 JSON 或同名產生的 Markdown，
  判定始終讀 JSON。遠端只讀 PR exact head 的檔案並驗證 blob bytes，不退回可變 main 或另一份歷史帳本。
- 綁定 Run 必須 v4、尚未關帳且由 Product/Owner 持有；sources 以 `issue/<number>` 精確引用本次議題，
  有真實 task 與 issuesStarted，並通過既有 strict-live 一致性規則。空白 Run 不能替實際施工背書。
- 同一 Run 可跨日接續，不要求每天新建檔案；不得把治理帳本、已關帳 Run、事後重建觀測冒充即時 Product capture。
  缺原始事件時保留 NEEDS_CAPTURE 與原因，交原 Product 工作線接續或如實交接，不補造零、不替它強行關帳。
- **宣告新 `RUN_ID` 時，既有還開著的 Run 要交代。** PR body 加一行
  `CONCURRENT_RUN_JUSTIFICATION:`，逐一點名 canonical main 上每個 `IN_PROGRESS`／`CLOSURE_RECOVERY`
  且 `closeout.state=OPEN` 的 Run，寫明為什麼不接續、也不收尾它（例如由其他 Session 持有）。
  只點名不寫理由、或寫 `none`／`TBD` 都不算交代。**接續既有 Run 不受這一關影響**，
  非 `PRODUCT_MAINLINE` 的 PR 也不受影響——要的是看一眼，不是停工。
  由 `scripts/agents/scorecard-required-gate.mjs` 的 `validateNewRunAdmission()` 機械執行。
  起因：2026-09-21-product-delivery-r03 還開著就又宣告了 2026-09-22-product-delivery-r01，
  兩份帳本各記一半，兩份都不是那一段時間的真相。
- #569：OBSERVED_V1 的 WIP 事件必須落在該 Run 的 startedAt 至 endedAt（若有）之內，邊界相等有效。
  排序與峰值自洽不能讓跨輪事件取得 LIVE_CAPTURE_READY；不得為過檢查倒填 Run 起始時間，
  或把 PR 建立時間當代理派送時間。時間檢查只證明一致性，不代表事件來源已查證；歷史 replay 不改寫。

Active Product Run 使用：

```bash
node scripts/agents/scorecard-readiness.mjs docs/metrics/agent-runs/<RUN_ID>.json
```

它只檢查 **raw-event capture health**，不產生分數、不參與跨 Run 比較，也不要求 legacy manual percentages。
固定 checkpoint：

1. **Run start**：建立／接續 ledger 後立即跑一次。
2. **Observable event**：accepted/rejected Agent task、full CI、invalid rerun、Audit／Final Risk、TEST collision、安全事件、closure sweep 後，先寫 raw fact，再跑 readiness。
3. **Delivery stage change**：merge、Issue close／owner-blocked、Vercel Production READY、Production schema readiness、authenticated Production acceptance 後，立即寫 Completion Truth evidence，再跑 readiness。
4. **Pre-closeout**：`rawCaptureGaps=[]` 且 `consistencyWarnings=[]` 才進 terminal closeout；已失去的歷史觀測不得用推算或預設 0 補綠。
5. **Grading preflight（#675）**：`status=COMPLETE` 前必須先讓 Completion Truth / `RUN_COMPLETE` 等現有評分條件成立。
   `run-ledger-v2.mjs closeout` 會直接重用 current scorer 檢查；若結果會永久 `NOT_GRADED`，以
   `CLOSEOUT_WOULD_NOT_GRADE` fail closed。先修 durable evidence，再關帳。
   `--accept-not-graded <reason>` 只允許明確、非佔位理由的知情例外，會寫入 notes；它**不會**讓該 Run
   變成 comparison-eligible，也不得用來湊 #104 的三輪樣本。

readiness 會把 `endedAt`、`main.endSha`、end inventory、closeout、Completion Truth 等 active Run 合理尚未具備的欄位列為 `terminalOnlyPending`，**不因它們 pending 而失敗**。

詳細 raw counter consistency 與操作例見 `docs/metrics/SCORECARD-LIVE-READINESS.md`。

### 10.3 事件發生時就記 raw facts

**同回合 capture 是硬規則。** 可觀測事件一旦在本工作回合被確認，就先寫 owning Product Run 的 raw fact／
Completion Truth，再繼續新的 Product 派工或送終止性 final。若目前 Session 不是該 Run owner、Run 檔不在可寫
head、或工具失敗而無法安全寫入，不得默默略過；必須留下 `RUN_CAPTURE_HANDOFF`，至少包含
`RUN_ID / EVENT / EVIDENCE_REF / OBSERVED_AT / WRITER_BLOCKER / NEXT_SAFE_WRITE_PATH`，並把該 Run readiness
明確維持 `NEEDS_CAPTURE`。handoff 不是補造 ledger 的授權，也不能把未知 counter 填成 0。

以下量必須在事件發生時即時寫入，不在 closeout 時倒推：

- `modelUsage.tasks`（含 accepted/rejected 與 count）；
- `flow` 的 Luna／Sol／Terra 委派 counters；
- `ci.fullCiRuns`、`ci.invalidReruns`；
- `delivery.issuesStarted` / `delivery.issuesClosed`；
- closure sweep count / advanced-or-closed；
- safety violation、reopen、post-merge regression、shared TEST collision；
- merge／close／Production stage 的 durable Completion Truth claims。

至少保留：

- main、open Issue／PR 起訖；
- MAIN／RESERVE／candidate／TEST 峰值；
- requested／actual Luna、Terra、Sol 任務與上下文大小；
- 實際 token／週 usage，或明確 `unavailable`；
- internal weighted usage（Luna=1、Terra=3、Sol=6，非官方換算）；
- `CLOSED`、AUDIT_READY、完整 OWNER_BLOCKED、carryover，以及 `CLOSED` 但仍 `PRODUCTION_PENDING` 的數量；`CLOSED` 不得單獨計入 shipped units；
- full CI、invalid rerun、品質、安全、Luna／Sol raw events；
- current score profile、scorecard 與最多 2 項下一輪調整。

### 10.4 復盤

Owner 說「復盤」或「複盤」時，載入
`.agents/skills/vibeaico-agent-retrospective/SKILL.md`，驗證並比較最近 3 輪；資料不足則讀全部。

- 只對 terminal + truth-verified + comparison-eligible Product Run 下效率趨勢結論。
- Active Run 可報 Live Readiness，但不得拿 readiness 百分比冒充分數。
- 若新 Run 仍因 raw evidence 缺失而 `NOT_GRADED`，復盤必須指出是**哪個 checkpoint 沒有留下資料**，而不是再用「資料不足」四字結案。
- 只提出一到兩項最有影響的治理改良，不在復盤時順便改產品。

### 10.4.1 Retrospective Execution Receipt（完整複盤 final hard gate）

`RETROSPECTIVE_EXECUTION_RECEIPT_REQUIRED`
`RETROSPECTIVE_EXECUTION_PREFLIGHT_REQUIRED`

**先做 execution-capability preflight，再做深度複盤。** 鎖定本次 `OBSERVED_MAIN`、Product Run 候選與固定時間窗後，
在大量 provider／DB／Gmail／歷史 evidence 讀取之前，先確認本 Session 真的有可執行 Node／repo runtime 與必需輸入，
並實際啟動最小 mandatory command preflight。若 scorer／runtime／input 在當前工具環境不可執行，立即把本輪標成
`PARTIAL_RETROSPECTIVE`，把缺失命令記為 `UNAVAILABLE`／`MISSING` 與原因；仍可繼續有價值的 live truth 調查，
但不得一路到 final 才第一次揭露 receipt 根本無法產生，也不得以人工讀檔冒充執行成功。

任何回覆要稱為「完整複盤」，final 前都必須真的執行既有兩個 score surfaces，不能用人工讀 JSON／Markdown 代替：

Product：
- `run-ledger-v2.mjs validate <run.json>`
- `scorecard-readiness.mjs <run.json> --json`；active Run 另記 `--strict-live` 的實際 exit/result
- `score-run-current.mjs <run.json>`
- `review-runs-v2.mjs docs/metrics/agent-runs`

Governance：
- 對最新可重建的正式 Governance Run 執行 `governance-scoreboard.mjs <ledger> <review-evidence> <policy>`；
- 對本次固定時間窗執行既有 `governance-observation.mjs` current observation，兩者不得互相冒充。

每一項 execution receipt 至少記：
`COMMAND / INPUT / TERMINAL_RESULT_OR_EXIT / OUTPUT_OR_EVIDENCE_REF / OBSERVED_MAIN`。
Product `NOT_GRADED`、active Run、重大 Product blocker、Gmail/provider/DB 調查都不得跳過 Governance score surface。
若命令因工具或證據缺失無法執行，必須標 `MISSING`／`UNAVAILABLE` 並說明原因，整份只能標 `PARTIAL_RETROSPECTIVE`，不得稱「完整複盤」。
這個 gate 不創造新分數、不改寫歷史 ledger；詳細步驟仍由 §10.4 載入的 retrospective skill 與 Protocol 執行。

## 11. 停止條件

只有以下情況可送終止性 final：

1. 所有 open Issue 都完成、合併到要求分支並依各自 Workstream 正確關閉；或
2. 剩餘項目只缺 Owner／外部人類／Production／合法 final gate，且 Product MAIN、RESERVE、
   Closure、TEST、可施工 backlog 與 active governance work 都已處理；或
3. 平台無法繼續，且已留下可直接接手的 exact checkpoint 與本輪 IN_PROGRESS report。

任何已 merge PR 若仍有 §9.0.1 的 Issue state／labels／body／closeout comment 或適用的 Playbook delta
未完成，都仍算可施工的 Closure 工作；不得因 source 已 merge 就送終止性 final。

結束前重新查 open Issue、open PR、CI、MAIN、RESERVE、Closure、TEST holder、Owner blockers、
active governance work、本輪 scorecard，**以及 §1.5 / §2.0.3 Environment Delivery queue**。
只要仍有可安全自主推進的 `SOURCE_ONLY → TEST`、`TEST_VERIFIED → Production`、
`PRODUCTION_SCHEMA_READY → activation` 或 `deployed → authenticated acceptance` 工作，就不符合停止條件；
不得把「Production 尚未 ready」籠統寫成 blocker 後停止。**同一 Environment Delivery queue 還有下一個安全階段時，
不得以「本次 source／migration PR 已完成」作為 Session 結束理由，也不得改做無關的新 schema source。**
最終報告不得只寫「目前進度」。

符合 §3.2 的 DB 變更在 `POLICY_GATED_ACTIVE` 後不再以逐次人工批准為停止理由；automation pending 期間保留 bootstrap gate，
技術關卡未過則保留**精確 G0–G7 stage / evidence blocker**。只有真的缺 Owner／外部人類且現有合法替代路徑不存在，
才可用 Owner／External blocker 結束該路線。
