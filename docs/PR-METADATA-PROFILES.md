# PR Metadata Profiles

> Owner 2026-09-15：降低 PR metadata 的**輸入摩擦成本**。這不是放寬 WIP / TEST / Final Risk / Completion Truth；只是把可機械推導的固定欄位交給工具產生，作者只填真正需要判斷的內容。

## 核心原則

```text
作者填 compact body
→ PR_PROFILE materializer 產生完整 explicit metadata
→ 現有 agent-wip-preflight 用同一套 validator 驗證
→ PASS 後才拿 materialized body 建 PR
→ remote Agent WIP Policy 繼續讀完整 explicit contract
```

GitHub 上的最終 PR body **仍保留完整 metadata**，所以 audit / historical replay / 舊 guard 都不需要理解隱藏 defaults。減少的是「作者手填」，不是「repo 留存證據」。

## 指令

```bash
node scripts/agents/pr-metadata-profile.mjs \
  --body /tmp/pr-body.compact.md \
  --changed-files /tmp/changed-files.txt \
  --number <PR_NUMBER_OR_PLACEHOLDER> \
  --output /tmp/pr-body.md
```

成功：

```text
PR_METADATA_PROFILE_PASS profile=<PROFILE> generated=<N> output=/tmp/pr-body.md
```

失敗時不寫可用的 PR body，先修 compact input。禁止把 remote CI 當欄位猜謎器。

## Profile 1：`GOVERNANCE_SOURCE_ONLY`

適合純 `MODEL_GOVERNANCE`、不碰 Product runtime / schema / Auth / payment / LINE / deployment / TEST DB 的治理 PR。

### 作者只需填真正會變的欄位

最小範例：

```markdown
<!-- pr-lifecycle
issue: 472
state: ACTIVE
supersedes:
-->

PR_PROFILE: GOVERNANCE_SOURCE_ONLY
WORK_ORIGIN: OWNER
LANE_STATE: ACTIVE
CLOSEABILITY_SCORE: 5
SELECTION_REASON: GOVERNANCE
REMAINING_AUTONOMOUS_STEPS: focused tests → source CI → merge → main reread
OWNER_OR_EXTERNAL_BLOCKER: none
CLOSURE_SWEEP_TARGET: #472
GOVERNANCE_SCOPE_EXCEPTION: none
ASTRA_RATIONALE: pure source-only governance metadata tooling; no Product or provider behavior
```

### 工具固定產生

- `WORKSTREAM: MODEL_GOVERNANCE`
- `DELIVERY_UNIT_TYPE: GOVERNANCE`
- `COUNT_IN_DELIVERY_OUTCOME: false`
- `RETROACTIVE_TRACKING_MIGRATION: false`
- `USER_VISIBLE_OUTCOME: none`
- `BPLUS_MODE: false`
- `RUN_ID: none`
- `SCORECARD_PATH: none`
- `AGENT_LANE: GOVERNANCE`
- `ACTIVE_CANDIDATE: false`
- `TEST_LANE_REQUIRED: false`
- `RESERVE_BOUNDARY: none`
- `WHY_NOT_CLOSER_CANDIDATE: none`
- `ASTRA_RISK: NONE`
- `FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY`
- `ASTRA_TEST_BASELINE: none`
- `ASTRA_SCHEMA_BASELINE: none`
- `DUAL_TERRA_PILOT: false`
- `TERRA_SLOT: none`
- `PRIMARY_ISSUE: none`
- `TEST_PROFILE: SOURCE_ONLY`
- `FINAL_CANONICAL_REQUIRED: false`
- `PAID_PREVIEW_BRANCH_STATUS: DEFERRED_NOT_IN_CONSIDERATION`
- `MIGRATION_TOUCH: false`
- `AUTH_TOUCH: false`
- `STORAGE_TOUCH: false`

沒有可靠 model identity 時，另提供 default：

```text
REQUESTED_MODEL / ACTUAL_MODEL: requested=not_requested; actual=unknown
```

如果有可靠 actual model，可以在 compact body 明確覆寫這個 **default**。固定欄位則不可覆寫；例如 `GOVERNANCE_SOURCE_ONLY` 卻填 `ASTRA_RISK: PAYMENT_CONSISTENCY` 會 fail closed，應重新分類而不是硬改 profile。

## Profile 2：`PRODUCT_TERRA_BUILD`

只處理常見 Product 主施工線中**與產品內容無關的 topology 常數**：

- `WORKSTREAM: PRODUCT_MAINLINE`
- `BPLUS_MODE: true`
- `AGENT_LANE: TERRA_BUILD`
- `LANE_STATE: ACTIVE`
- `ACTIVE_CANDIDATE: true`
- `COUNT_IN_DELIVERY_OUTCOME: true`
- `RETROACTIVE_TRACKING_MIGRATION: false`

`SCORECARD_PATH` 由作者填的 `RUN_ID` 機械產生：

```text
RUN_ID: 2026-09-15-product-r01
→ SCORECARD_PATH: docs/metrics/agent-runs/2026-09-15-product-r01.json
```

### Product 仍必須明確填的內容

Profile **不猜**：

- `RUN_ID`
- lifecycle Issue
- `DELIVERY_UNIT_TYPE: SLICE | STANDALONE`
- `PARENT_EPIC`
- `USER_VISIBLE_OUTCOME`
- `CLOSEABILITY_SCORE`
- `SELECTION_REASON`
- `REMAINING_AUTONOMOUS_STEPS`
- `OWNER_OR_EXTERNAL_BLOCKER`
- `CLOSURE_SWEEP_TARGET`
- `WHY_NOT_CLOSER_CANDIDATE`
- `REQUESTED_MODEL / ACTUAL_MODEL`
- `TEST_LANE_REQUIRED`
- `TEST_PROFILE`
- `FINAL_CANONICAL_REQUIRED`
- `MIGRATION_TOUCH / AUTH_TOUCH / STORAGE_TOUCH`
- `ASTRA_RISK / ASTRA_RATIONALE / FINAL_RISK_POLICY`
- 需要 Final Risk 時的 test/schema baseline

這些欄位會隨真正的 Product 風險與驗收改變，不能用「省事」當理由自動猜。

## Conflict 規則

### Fixed profile field

如果 compact body 明確填入與 profile 固定值不同的值：

```text
PR_PROFILE: GOVERNANCE_SOURCE_ONLY
ASTRA_RISK: PAYMENT_CONSISTENCY
```

結果：

```text
PR_METADATA_PROFILE_FAILED
```

不是「explicit wins」。這通常表示 profile 選錯。

### Default field

只有被定義為 default 的欄位可以由更可靠 evidence 覆寫，例如治理 actual model identity。

### Derived field

由其他欄位機械推導的值也不可矛盾。例如 Product `SCORECARD_PATH` 必須與 `RUN_ID` 一致。

## 舊 PR 相容

沒有 `PR_PROFILE` 的既有 PR **完全不改**。它們繼續使用現在的 explicit metadata 與現有 remote guard。

Profile 是新的 authoring path，不是 history migration，也不會回寫舊 PR。

## 為什麼不讓 remote guard 自己偷偷套 defaults

因為那會讓 GitHub 上的 PR body 缺少實際被採用的 metadata，audit 要再重算 hidden defaults；而且不同 workflow 若各自展開 profile，容易重演「local 綠、remote 紅」。

所以這一版採：

```text
compact authoring
→ 一次 materialize
→ explicit durable PR body
→ 現有 validator / guard
```

這樣同時達成低摩擦與可重建。
