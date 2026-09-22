# VibeAI Admin Rebuild 完整複盤協議

> Canonical purpose：當 Owner 說「復盤／複盤」時，固定用同一套可重建流程檢查 Product delivery、environment delivery、governance evidence、CI／TEST、Scorecard／Scoreboard、WIP／Terra 與外部 provider 訊號。
>
> 這份文件規範「怎麼完整複盤」。實際 Agent 執行規則仍以 `docs/AGENT-EXECUTION.md` 為準；複盤 skill 仍由 `.agents/skills/vibeaico-agent-retrospective/SKILL.md` 觸發。

## 0. 核心原則

完整複盤不是「看最近 PR 然後講心得」，而是做一次 current-truth reconciliation（現況真相對帳）。

固定遵守：

1. **live state 優先**：舊 session、PR body、Issue body、metrics ledger 都只是線索；最終以 live GitHub / provider / DB readback 為準。
2. **Product 與 Governance 分帳**：產品施工、正式交付、治理施工、治理品質不可混成同一個分數。
3. **source delivery 與 environment delivery 分開**：程式 merge 不等於 TEST／Production schema ready，不等於正式登入驗收。
4. **unknown 不補 0**：沒有可重建分母、時間點、完整 Actions history、provider evidence，就標 `null / unavailable / unknown`。
5. **沒有證據就不下效率結論**：尤其 Terra utilization、WIP saturation、qualified wait、verify-tail wait、token efficiency。
6. **複盤只吸收治理問題**：若發現 Product runtime/schema/payment/LINE/部署缺陷，記錄根因與 Product owner，不塞進治理 PR 偷修。

---

## 1. 固定複盤時間窗

Owner 若指定「最近 N 小時」，使用 `Asia/Taipei` 解讀並寫出絕對時間。

輸出至少包含：

```text
WINDOW_START_TW
WINDOW_END_TW
OBSERVED_MAIN
OBSERVED_AT
```

若沒有指定時間窗：

- current incident / 卡住調查：最近 12 小時；
- weekly / trend review：依 Product Run 邊界；
- Governance Scoreboard：依該 scoreboard 的 observation window。

不得把不同時間窗的 PR、Gmail、CI 數字混在一起算比例。

---

## 2. 第一步：重建 live GitHub current truth

至少查：

- current `main` SHA；
- 最近時間窗內 merged/open/closed PR；
- open Issues；
- active Product candidates；
- Terra BUILD / verification tail / TEST holder；
- stacked PR 的 base/head；
- required CI；
- 最新 Product Run；
- 最新 Governance Scoreboard / observation。

遇到 stacked PR 時額外核對：

```text
PR 數 != Terra 數
```

只計真正在 BUILD／VERIFY／TEST 的角色；superseded carrier、closed helper、歷史 sync PR 不得繼續占 WIP。

每次 merge、base retarget、carrier close、supersede 後，重新讀 stack，不沿用舊 Janitor/WIP 留言。

---

## 3. 第二步：Product 主線複盤

### 3.1 先分「程式完成」與「正式交付」

對時間窗內每張 Product PR，至少記錄：

```text
PR
Issue
USER_VISIBLE_OUTCOME
SOURCE_VERIFIED
MERGED_TO_MAIN
AUTO_VERCEL_DEPLOYED
PRODUCTION_SCHEMA_READY
AUTHENTICATED_PRODUCTION_ACCEPTED
MIGRATION_TOUCH
Final Risk
External blocker
```

五階交付：

```text
SOURCE_VERIFIED
→ MERGED_TO_MAIN
→ AUTO_VERCEL_DEPLOYED
→ PRODUCTION_SCHEMA_READY
→ AUTHENTICATED_PRODUCTION_ACCEPTED
```

缺任一階都不得稱「完整上線」。

### 3.2 Product merge mix

每個時間窗分開計：

- Product PR merged；
- Governance / bookkeeping PR merged；
- Product-visible merge ratio；
- Production-accepted units。

不可用「PR merge 數」冒充「產品出貨數」。

### 3.3 Schema two-stage compliance（資料庫兩段式發布遵守度）

對每張 `MIGRATION_TOUCH=true` 的 Product PR 問：

1. 是否只有 schema-prep，尚未啟用依賴 runtime？
2. 若 runtime/UI/API 同張 PR 出現，它是否被預設關閉且能機械證明不會觸發新 schema？
3. canonical TEST 是否已套 exact main schema 並驗收？
4. Production schema 是否 ready 後才啟用功能？

若同張 PR 直接包含：

```text
migration + dependent runtime/API/UI
```

且 merge 後 `PRODUCTION_SCHEMA_READY=UNVERIFIED`，標：

```text
SCHEMA_STAGE_VIOLATION_CANDIDATE
```

再查 executable guard 是否有阻擋能力。只有 prose 規則而沒有 preflight/guard，根因記為：

```text
POLICY_EXISTS_BUT_NOT_EXECUTABLE
```

---

## 4. 第三步：CI / TEST / Environment delivery 複盤

不要只看 workflow conclusion。

固定拆：

```text
classify / metadata
source check
integration
E2E
Preview
canonical TEST schema
Production schema
authenticated Production acceptance
```

### 4.1 CI 紅燈先分群，不以 test count 當 bug count

若 integration 顯示大量 failed tests：

- 先看 failed files；
- 找 beforeAll / seed / shared setup；
- 同根因連鎖失敗只算一個 failure cluster；
- 再分：schema drift / ACL / fixture / auth / RPC / runtime / runner。

禁止：

- 看到 196 failed tests 就宣稱 196 個 bug；
- 未對齊 TEST baseline 前直接刪斷言；
- 連續 blind rerun。

### 4.2 TEST DB 真相

只讀查 canonical TEST 的實際欄位／policy／migration ledger，回答「DB 本體是否有」；不要把 PostgREST cache、migration source、TEST DB 三者混為一談。

若 main 已要求欄位但 TEST DB 本體不存在，記：

```text
ENVIRONMENT_DELIVERY_LAG
```

Product remediation 優先順序：

```text
exact main schema/ACL/RPC dependencies
→ canonical TEST alignment
→ real query/readback
→ rerun integration
→ remaining fixture/auth/RPC/runtime failures
```

---

## 5. 第四步：Product Run / Live Scorecard 複盤

讀 `docs/metrics/agent-runs/<RUN_ID>.json` 與 markdown，但不能只看 markdown 分數。

固定驗：

```text
run-ledger-v2 validate
scorecard-readiness --strict-live
current score dispatcher
Completion Truth claims
```

### 5.1 VALID_V2 != raw facts 正確

`VALID_V2` 只表示 schema 格式合法。

下列任一存在就標 `NEEDS_CAPTURE`：

- `delivery.issuesClosed` 與 verified ISSUE_CLOSED claims 不一致；
- task counters 與 `modelUsage.tasks` 對不起來；
- invalid reruns > full CI；
- closure advanced > closure sweeps；
- duplicate task id；
- Observable event 已發生但 ledger 沒 raw event。

### 5.2 shared TEST / WIP counters 要和 live observation 對帳

例如 ledger 寫 `sharedTestPeak=0`，但 live WIP guard 在同 Run 曾記 `Remote TEST validation: 1/1`：

- 先查兩欄語意是否相同；
- 若不同，寫清楚 contract；
- 若相同，修 capture；
- 查清前不得自行把 0 改 1。

### 5.3 Scorecard output

Active Run：

```text
PRODUCT_RUN_TREND: NOT_GRADED
LIVE_CAPTURE: LIVE_CAPTURE_READY | NEEDS_CAPTURE
```

只有 terminal + truth-verified + comparison-eligible runs 才可做效率趨勢。

---

## 6. 第五步：Governance Scoreboard / Current observation

Product `NOT_GRADED` 也不能省略 Governance。

固定看：

- workstream classification accuracy；
- historical drift inventory；
- full CI / first-pass / invalid rerun；
- metadata recovery；
- duplicate tasks；
- ownership collision；
- stale active labels；
- final-head reconciliation；
- zero-content PR evidence；
- current merged/open governance sample。

### 6.1 新樣本改善 != 舊存量清零

例如最近 3 張 bookkeeping PR 分類都正確，只能說：

```text
new-sample classification improved
```

不能說：

```text
repo classification findings = 0
```

除非重新跑完整巡查並可解釋每一筆 findings 增減。

### 6.2 缺 Actions history 就保持 unavailable

以下沒有完整 history 時不得補 0：

```text
first-pass CI
same-head rerun
metadata recovery
cycle-time breakdown
```

---

## 7. 第六步：Terra / WIP 複盤

固定報 raw peaks：

```text
Terra BUILD peak
active candidate peak
shared TEST peak
Reserve peak
```

時間型效率只有 durable event 才計：

```text
Terra utilization %
WIP saturation minutes
qualified wait minutes
verify-tail wait minutes
```

不得用「PR created → merged」總時間替代 build occupancy。

### 7.1 擴 WIP / 擴 Terra 的門檻

只有同時滿足才可建議提高：

- 至少 3 個 terminal truth-verified comparable Product Runs；
- observed wait/occupancy 證明 BUILD 真的是瓶頸；
- shared TEST / Final Risk / merge / environment delivery 不是主要瓶頸；
- 沒有因擴線造成 ownership/hot-boundary/rework 上升。

否則維持：

```text
candidate cap = 3
Terra hard max = 2
shared TEST = 1
```

---

## 8. 第七步：Gmail / Provider 複盤

用精確時間窗查：

- GitHub Actions；
- Vercel；
- Supabase；
- Resend / Email；
- LINE；
- 當輪實際碰到的 provider。

區分：

```text
zero relevant notifications found
GMAIL_EVIDENCE_UNAVAILABLE
GMAIL_FULL_BODY_NOT_VERIFIED
```

Gmail quiet 不能證明 provider healthy。

若 GitHub 內部 guard 失敗很多、供應商通知為零，優先調查 repo governance/CI，不先甩鍋 provider。

provider notice 要再用 live API/dashboard 驗 current state；舊 email 不證明現在仍失敗。

---

## 9. 第八步：Root cause tree（根因樹）

每個紅燈必須落入：

```text
PRODUCT_SOURCE
ENVIRONMENT_DELIVERY
TEST_BASELINE
FIXTURE
GOVERNANCE_GATE
METRICS_CAPTURE
WIP_SCHEDULING
EXTERNAL_PROVIDER
OWNER_BLOCKED
UNKNOWN
```

對每個根因寫：

```text
SYMPTOM
EVIDENCE
ROOT_CAUSE
WHY_EXISTING_GUARD_DID_NOT_STOP_IT
OWNER / PRODUCT / GOVERNANCE RESPONSIBILITY
BOUNDED_FIX
ACCEPTANCE
```

「修了這次 bug」不是完整 root cause；要回答為什麼制度允許它進來。

---

## 10. 固定輸出格式

每次完整複盤至少輸出：

1. **Current Truth**：main、時間窗、重要 live state。
2. **Product Delivery**：Product merges、使用者能力、五階交付、Production pending。
3. **Environment Delivery**：TEST / Production schema / Preview / E2E。
4. **Product Scorecard**：Run status、Live Readiness、Completion Truth。
5. **Governance Scoreboard**：當期 observation + 歷史存量界線。
6. **Terra / WIP**：raw peaks + unavailable timing metrics。
7. **Gmail / Provider**：通知與 live provider 差異。
8. **Root causes**：最多 3 個最高影響根因；其餘放 backlog。
9. **下一步**：最多兩個主要治理改良；Product bug 交 Product Issue。
10. **Unproven**：所有還沒驗證的地方。

### 10.1 Final execution gate

`RETROSPECTIVE_EXECUTION_RECEIPT_REQUIRED`

送出「完整複盤」前，必須附 Retrospective Execution Receipt。固定執行：

```bash
node scripts/agents/run-ledger-v2.mjs validate <latest-product-run.json>
node scripts/agents/scorecard-readiness.mjs <latest-product-run.json> --json
node scripts/agents/score-run-current.mjs <latest-product-run.json>
node scripts/agents/review-runs-v2.mjs docs/metrics/agent-runs
node scripts/metrics/governance-scoreboard.mjs <latest-reproducible-governance-run.json> <matching-review-evidence.json> docs/metrics/governance-scoreboard-policy.json
node scripts/metrics/governance-observation.mjs --repo smallwei0301/vibeaico-admin-rebuild --since <WINDOW_START_UTC> --until <WINDOW_END_UTC> --json
```

Active Product Run 另外實跑 `scorecard-readiness --strict-live` 並保存真正 exit code；非 0 可以是正確的 `NEEDS_CAPTURE`，不得把它改成 0 或省略。
每一項收據都要保存 command、input、terminal result/exit、output 或 artifact reference、observed main。
正式 Governance Scoreboard 與 current observation 是兩層證據：前者驗可重建正式 contract，後者描述本次時間窗；不得互相冒充。
若任一 mandatory command 未執行，final 必須標 `PARTIAL_RETROSPECTIVE` 並列出缺項。Product `NOT_GRADED` 不得跳過 Governance。

---

## 11. 復盤後治理整改的優先序

預設排序：

```text
P0 Safety / delivery-truth hole
P0 Environment gate hole
P0 Scorecard raw-capture inconsistency
P1 Repeated CI/WIP friction
P1 Classification / evidence drift
P2 Telemetry enhancement
```

每個治理整改：

- 一個 concern 一張 bounded PR；
- <= 8 files / <= 800 changed lines；
- executable guard 優先於再加 prose；
- 不放寬 Product Final Risk、branch protection、candidate=3、Terra=2、shared TEST=1；
- exact-head CI + counterexample review + main readback 後才算完成。

---

## 12. 本協議的 negative controls（反例）

以下說法一律視為複盤失敗：

- 「3 張 Product PR merge，所以 3 個功能完整上線」；
- 「Issue closed，所以 shipped」；
- 「check 綠，所以 integration/E2E 也綠」；
- 「Gmail 沒信，所以 Vercel/Supabase 沒問題」；
- 「196 tests fail，所以有 196 個產品 bug」；
- 「PR 有 3 張，所以現在有 3 個 Terra」；
- 「sharedTestPeak=0，所以沒人用 TEST」而未查 live WIP evidence；
- 「最近治理 PR 分類都對，所以歷史 findings 已清零」；
- 「沒有時間資料，所以 utilization=0%」；
- 「規則文件有寫兩段式 schema release，所以系統一定有阻擋同張 migration+runtime PR」。

完整複盤的目的，是把「看起來完成」拆成可重建的真相，並把真正造成下一輪阻塞的制度缺口轉成 bounded governance fix。