# AGENTS.md

這個檔案是**入口路由器，不是第二份治理手冊**。

## 每次開工只先做這些

1. `git fetch origin --prune`，以 current `origin/main` 為準。
2. 讀 live GitHub 的目標 Issue／PR、current main、exact head、required CI 與目前 TEST holder。
3. 讀 `docs/AGENT-EXECUTION.md`。它是本 repo 唯一日常執行入口。
4. 讀目標 Issue 指定的 canonical `docs/integration/**` 與真正相關的最新 Owner Decision。

**不要每輪無條件重讀 CLAUDE、MODEL-ROUTING、全部 B+ 歷史決策、Documentation Governance、
全部 Playbook、全部 metrics 或所有 skills。** `docs/AGENT-EXECUTION.md` 的 trigger table 決定何時展開。

## Trigger-based reads

| 情境 | 再讀 |
|---|---|
| Product 模型分工／Sol／Terra／Final Risk | `docs/MODEL-ROUTING.md` |
| `/goal`、長程 Loop、多 Agent、Closure／TEST handoff | `.agents/skills/vibeaico-agent-orchestration/SKILL.md` |
| Owner 說「復盤／複盤」 | `.agents/skills/vibeaico-agent-retrospective/SKILL.md` |
| LOCAL_ISOLATED／shared TEST／Issue #104 | `.agents/skills/vibeaico-isolated-test-orchestration/SKILL.md` + `docs/integration/12-TESTING-TDD.md` |
| Production DB release | `docs/PRODUCTION-DB-RELEASE-WORKFLOW.md` + 對應 Owner Decision |
| 新增／搬移 canonical 文件 | `docs/DOCUMENTATION-GOVERNANCE.md` |
| 已知錯誤／CI／migration 陷阱 | 搜尋 `docs/AGENT-PLAYBOOK.md` 的直接命中條目 |
| GUIDE UX／手機／LINE／付款 | Issue 指定的 integration 分冊 |
| 需要歷史裁示理由 | 精確讀相關 `docs/decisions/**`，不全量回放 |

如果使用的 agent runtime 會自動載入 `CLAUDE.md`，把它視為 runtime／架構補充；若與
current `docs/AGENT-EXECUTION.md` 的**執行流程**衝突，以 `AGENT-EXECUTION.md` 與更新的 Owner Decision 為準。

## Workstream

所有新 Issue／PR 必須只有一個：

```text
WORKSTREAM: PRODUCT_MAINLINE
```

或：

```text
WORKSTREAM: MODEL_GOVERNANCE
```

- Product runtime、API、schema／migration、tenant data、付款／退款、LINE/provider、部署、跨 repo Product contract → `PRODUCT_MAINLINE`。
- Agent／WIP／PR lifecycle、governance CI、scoreboard、model routing、治理證據 → `MODEL_GOVERNANCE`。
- 混合範圍能拆就拆；拆不開且碰 Product 高風險面時整張按 Product。

## 自然語言入口

```text
開始 Loop       → 建立或安全接續一輪 Product B+
繼續 Loop       → 從最新 live state / IN_PROGRESS Run 接續
復盤／複盤      → 唯讀複盤
復盤並優化      → 最多兩項 bounded governance 改良
/goal           → 有進行中 Run 就接續，沒有才開始
```

## 不可被簡化掉的安全底線

- 舊對話／舊 PR body 不是 current truth；先查 live state。
- 不 reset／force-push／重做已完成 migration。
- canonical TEST 的任何寫入都必須持有唯一 `TEST_VALIDATION` lane；E2E insert/delete 也算寫入。
- `POLICY_SKIP` 不得寫成 integration／E2E 已通過。
- Product 高風險改動依 `MODEL-ROUTING.md` 做 Final Risk；純治理不要求 Product Final Risk。
- Production DB 只依 machine policy gate；`AUTOMATION_READY=false` 時不得自行寫入。
- Production deployment、真實付款／退款／訂單／顧客通知沒有精確授權就禁止。
- Completion Truth 未驗證，不得宣稱 merge／close／deployment／migration 已完成。
- Product `CLOSED` 不等於 shipped；五階 Production truth 全成才是 shipped unit。

## Ledger / Scorecard

Run 只記**當下可觀測的原始事件**，不要在 closeout 猜百分比。

```text
npm run agent:run:init -- --run-id <RUN_ID> --closeout-owner PRODUCT_MAIN_SESSION
npm run agent:run:validate -- <run.json>
npm run agent:run:score -- <run.json>
npm run agent:run:review -- docs/metrics/agent-runs
```

2026-09-15 起的新 terminal Product Run 由 Scorecard 自動使用 `OBSERVED_V1`，從 tasks、CI、
Completion Truth、WIP、closure、quality/safety 等原始事件衍生分數；歷史 Run 仍原樣重播。
人工百分比沒有可靠 denominator 就保持 `null`，不再因此讓整輪 Scorecard 報廢，也不得補猜。

詳細規則全部在 `docs/AGENT-EXECUTION.md`，本檔不再複製。
