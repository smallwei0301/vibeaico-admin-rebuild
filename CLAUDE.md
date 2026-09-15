# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 對話輸出語言（強制）

對使用者的所有對話輸出——狀態回報、進度更新、解釋、提問、摘要——一律使用繁體中文，
不得夾雜整段英文說明；程式碼、指令、檔名、API／欄位名、錯誤碼、log、commit message
與 PR 內文不受此限，維持原有慣例（多數已是繁體中文，程式相關詞彙照舊不譯）。這條規則
沒有「情境許可就可以用英文」的例外；每一輪要輸出給使用者的文字前，先確認語言是否符合。
被 context 壓縮或恢復後，這條規則不因此失效，必須在下一次輸出前重新對齊。

## Mandatory start — low-friction current truth

`docs/AGENT-EXECUTION.md` is the canonical default execution entry. Before working on any Issue:

1. `git fetch origin --prune`.
2. Read `origin/main:AGENTS.md` and `origin/main:docs/AGENT-EXECUTION.md`.
3. Re-read the live Issue, PR, branch and CI state; old conversations are not current evidence.
4. Read only the Owner Decision and canonical `docs/integration/**` / testing sections directly relevant to the current Issue or domain.
5. Load `docs/MODEL-ROUTING.md`, `docs/DOCUMENTATION-GOVERNANCE.md`, B+ background decisions, skills, Playbook entries and historical Runs only when the trigger table in `docs/AGENT-EXECUTION.md` §2 says they are relevant. Do not preload the whole governance library “just in case”.
6. Start implementation work from the then-current `main`, or from a designated integration branch with the required canonical decisions. After the working branch exists, **do not rebase only because unrelated work advanced `main`**. Follow `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md`: re-align only for a material migration-ledger change/prefix collision, actual merge conflict, shared contract or acceptance-precondition change, or CI evidence that the new base materially affects the candidate. `HEAD^ == origin/main` is not a global invariant.

Final product, architecture, API and acceptance documentation lives on `main`. A branch-only document is a draft unless `main` explicitly says otherwise. If a working branch conflicts with a newer Owner Decision or canonical spec on `main`, **main wins**. Re-reading newer relevant decisions is required; rebasing unrelated file content is not.

## Default execution mode

Follow `docs/AGENT-EXECUTION.md`. The default is continuous autonomous progress: a status update
is not a stopping point, blocked work is parked while unrelated work continues, and already
recorded Owner decisions are not asked again. The same document defines model delegation,
standing TEST authorization, credentials, CI/DB serialization, evidence, and stop conditions.

## B+ delivery loop — 每一輪都要真的做，不是只填欄位

`docs/AGENT-EXECUTION.md` 定義了這個 loop，但它被違反的方式幾乎總是同一種：
**記帳的部分做了，施工的部分沒做**。欄位填得完整、Run ledger 建好了、closure sweep
的表格也貼了，然後所有工作還是同一個模型自己從頭做到尾。那不是 B+ loop，那是把
B+ 的表格填在單人作業上面。

每一輪按順序做這六件事，缺一件就要在 PR 裡如實寫出缺了哪一件，不得靜默跳過：

### 1. 真實盤點（Luna 層）

掃 open Issue／open PR／近期 CI／上一輪的 closeability 候選。這是**窄盤點**，
按 `CLAUDE.md` 的 Lane → model tier 表屬 `scout` 層，**應委派給 `claude-haiku-4-5`**。
每次委派即時寫進 `flow.lunaTasks` / `lunaAccepted`。

### 2. TRIAGE 選 MAIN（Sol 層）

選出這一輪的 MAIN、可選的 RESERVE 與 Closure target。高風險設計判定屬 `audit` 層
（`claude-opus-5`）。寫進 `flow.solTouches` / `solIssues`。

### 3. MAIN Terra 施工

**`TERRA_BUILD` 一律委派給 `claude-sonnet-5`。** 判準很機械：**新增或修改
migration、route、server 模組、頁面或測試，就是施工**。在 audit 層模型上做施工是
routing violation，要如實記為違規而不是中性註記——見 PB-036，它已經發生過三次，
每一次的藉口都是「我人已經在跑了，順手做完比較快」。

MAIN 必須一路做到 `CLOSED`、`AUDIT_READY` 或完整 `OWNER_BLOCKED`。
`PR 已開`、`CI 綠`、`正在等 Preview` 都不是完成。

### 4. LUNA_CLOSURE

每輪固定執行，沒有候選要輸出 `EMPTY_WITH_SCAN` **並附實際掃過的清單與各自不是
候選的理由**。只寫 `EMPTY_WITH_SCAN` 四個字不算數。寫進 `inventory.closureSweeps`。

### 5. 即時埋點——這一條是最常被跳過的

`modelUsage.tasks`、`flow` 的委派計數、`ci.fullCiRuns`、`delivery.issuesStarted/Closed`
必須**在事情發生的當下**寫進 `docs/metrics/agent-runs/<RUN_ID>.json`，不是收尾時回填。

理由不是形式：current `OBSERVED_V1` 直接從這些 durable raw events 衍生 Product Scorecard；
人工 `weightedUsageImprovementPercent`、`lunaDelegationRatePercent` 等 legacy percentages 對新 Run
只保留為 supplemental telemetry，不再是 grading hard gate。2026-09-14 以前的舊 Run 多數
`modelUsage.tasks: []`，因此缺少可重建的真實事件，歷史仍不能被事後補漂亮數字。

**把埋點欄位建好卻不埋，比誠實地說「沒埋點」更糟**：它看起來像有在做。這與 PB-039
（一個從來沒有受測對象的 guard）是同一種病。Active Run 依 `docs/AGENT-EXECUTION.md` §10
使用 `scorecard-readiness.mjs` 在事件發生時抓漏，不等複盤才發現。

### 6. 收尾判定

`docs/DELIVERY-CHAIN.md` 的五點 Completion Truth。Run 結束時以
`run-ledger-v2.mjs closeout` 收成 terminal，未埋點的量維持 `null`，不回填推算值。

### 自檢

每一輪結束前，對著這六點各回答一次「做了沒有」。任一項答「沒有」而 PR 沒寫出來，
就是把 B+ 的表格填在單人作業上面。

## Commands

```bash
npm run dev         # http://localhost:3000/tenant/dashboard
npm run build       # production build (also runs full type check)
npm run start       # serve production build
npm run typecheck   # tsc --noEmit — the primary gate; must be zero errors
npm test            # all unit tests
npm run test:integration  # HTTP + real TEST Supabase; serial only
npm run test:e2e    # Playwright user journeys
npm run test:all    # typecheck + unit + integration + E2E
```

`npm run lint` is `next lint`, which is deprecated in Next 15 and **hangs on an interactive
ESLint-setup prompt** — no ESLint config exists yet. Use `npm run typecheck` + `npm run build`
as the verification gate instead.

Vitest and Playwright are installed in this repo. Integration and E2E share one TEST Supabase,
so never run them concurrently with another reset/seed/migration lane. Use the repo scripts and
Node 22; do not hardcode one machine's global Playwright or Chromium path.

## What this repo is

A rebuild of the `vibeaico.com/tenant/*` multi-tenant shop-admin panel as a clean Next.js 15
App Router skeleton (React 19, TypeScript strict, Tailwind 3, lucide-react, zod). ~40 pages,
routes identical to the original site.

The repo now contains both paths: `NEXT_PUBLIC_USE_MOCK=true` remains the no-backend regression
and demo mode, while `src/app/api/**`, `src/server/**`, Supabase migrations and integration tests
implement the real backend in phases. Never assume the project is still mock-only; inspect the
latest `main`, open Issues and their canonical phase documents before claiming completeness.

## Architecture

### Pages never fetch

```
page.tsx → src/services/*  →  adapt(mock, real)  →  src/mock/  or  real API
```

Every page's only data entry point is a function in `src/services/*`. Those functions wrap both
branches in `adapt()` (`src/lib/api.ts`), so flipping `NEXT_PUBLIC_USE_MOCK=false` swaps the
data source without touching a single page component. Never add `fetch` to a page.

`request()` in `src/lib/api.ts` assumes a fixed response envelope: `{ success, data?, message?, code? }`.
Paged responses are Spring-style: `{ content, totalElements, totalPages, number, size }`, `number` 0-based.

### Business modes — "mode changes the signage, not the warehouse"

A tenant registers as one of three business types: `LOCAL_SHOP` (local shop), `GUIDE` (tour
guide), `CLINIC`. The mode only affects **what is displayed and what it is called** — nav layout,
labels, default feature grants, LINE keyword groups, storefront sections. The underlying data
tables stay structurally separate (`services` vs. `trips`/`trip_plans`/`trip_departures` are two
different inventory models and must not be merged).

- **`src/config/modes.ts` is the single source of truth.** `MODE_PRESETS` holds every
  mode-dependent decision. Do **not** scatter `if (businessType === 'GUIDE')` across pages, nav,
  or webhooks — add a field to the preset instead.
- `src/i18n/zh-TW/nav.ts` exports `navLabel(key, businessType)` for mode-specific nav wording
  (GUIDE's "預約管理" is really "訂單管理"; CLINIC's "員工" are "醫師").
- `useBusinessType()` / `useCurrentTenant()` from `src/components/layout/BusinessTypeContext.tsx`
  give pages the active mode and tenant.

### Mode-aware mock data (subtle — read before touching mock data)

`src/mock/index.ts` holds three complete datasets (`LOCAL_SHOP`, `GUIDE`, `CLINIC`) and exports
the shared ones as **ES module live bindings** (`export let MOCK_STAFF`, `MOCK_SERVICES`, …).
`AppShell` calls `applyMockMode(businessType)` on tenant switch, which reassigns all of them, so
every call site picks up the right dataset **without any call site changing**.

For mock data that lives inside a single page file, use the `byMode({ LOCAL_SHOP, GUIDE, CLINIC })`
helper from `@/mock`. Two rules:

1. **Call `byMode()` inside render or inside the data-loading callback — never at module scope.**
   At module-evaluation time `MOCK_MODE` has not been set by `AppShell` yet, so a module-level
   `const` freezes the wrong mode's data permanently. The same trap applies to any module-level
   `const` derived from `MOCK_*` (e.g. deriving a tag list from `MOCK_CUSTOMERS`) — compute it at
   render time.
2. When page-local mock data is keyed by id (`s_1`, `ml_2`, `b_1`…), remember the three datasets
   **reuse the same id sequences**. A single shared `Record<string, …>` will leak one mode's
   flavor text into another; give each mode its own record and select with `byMode()`.

Business-flavored strings (customer names, service names, product names, staff bios) must differ
per mode — this skeleton is used as a demo, so a salon service name appearing under a GUIDE
tenant is a real bug, not cosmetic.

### Multi-tenant settings: two distinct layers

| Layer | Stored in | Set by | Examples |
|---|---|---|---|
| Platform | `.env` → `src/config/env.ts` (zod-validated) | the deployer, once | DB URL, SMTP, platform OAuth, `SETTINGS_ENCRYPTION_KEY` |
| Tenant | DB `tenant_settings` → `src/config/tenant-settings.ts` | each shop, in the admin UI | LINE Channel ID/Secret/Access Token, business hours, notification toggles, points rules, brand colors |

**LINE Channel Tokens must never go in `.env`** — that would limit the whole platform to one
shop. Secret fields are AES-256-GCM encrypted with `SETTINGS_ENCRYPTION_KEY` before storage,
always returned through `maskSecret()`, and an empty string from the client means "leave
unchanged" (keep the existing DB value), not "clear it".

### Layout routing

`src/app/tenant/layout.tsx` branches on `pathname`: the four auth routes (`login`, `register`,
`forgot-password`, `reset-password`) render inside `AuthShell` with no sidebar/topbar/widgets;
everything else gets `AppShell`. This is deliberate — Next route groups were rejected because
they split one `/tenant` prefix across two layout trees. The exception list lives only here.

## Hard rules (from `docs/CONVENTIONS.md`)

1. **Zero hardcoded copy.** No Chinese string literals in page components. All text lives in
   `src/i18n/zh-TW/pages/<page>.ts` (imported as `import { xxxPage as t }`) or `common.ts`.
   Translating the app = copying the `zh-TW` folder; code must not change.
2. **Zero hardcoded design values.** No raw colors, radii, shadows, or font sizes — only Tailwind
   tokens (`bg-primary`, `rounded-lg`, `shadow-md`) or `var(--…)`. Theme changes touch only
   `src/styles/tokens.css`, which is the single source that `tailwind.config.ts` points at.
3. `src/lib/types.ts` is the frontend/backend contract. Extend it by **adding** types or optional
   fields; do not change existing field names or shapes.
4. Every client page starts with `'use client';`.
5. Standard list-page structure: `PageHeader` → `DataTableContainer` → `DataTableHeader` →
   `DataTable` → `DataTableFooter`/`Pagination`. Form pages use `Card` + `Tabs`.
6. Every page needs a loading state, an `EmptyState`, a `ConfirmModal` for deletes, and a success
   toast via `useToast()`.
7. Money columns use `formatCurrency()` with `numeric: true`; status columns use `<Badge tone>`
   with text from a `common.*` map. Icons are lucide-react only.

## Lane → model tier (Owner decision, 2026-09-10)

The `Luna / Terra / Sol` lane names in `scripts/agents/model-routing.json` name a **tier of work**,
not a vendor. On the OpenAI side they map to `gpt-5.6-*`; on the Anthropic side they map as below.
The mapping is mandatory in both directions — the lane picks the tier, and the tier picks the model.

| Lane | 職責（`docs/AGENT-EXECUTION.md`／`AGENTS.md`） | OpenAI | Anthropic |
|---|---|---|---|
| `scout` / Luna | 窄盤點、Closure、CI 摘要、文件、QA、Metrics | `gpt-5.6-luna` | `claude-haiku-4-5` |
| `build` / Terra | **施工**（MAIN／RESERVE 完整出貨線） | `gpt-5.6-terra` | **`claude-sonnet-5`** |
| `audit` / Sol | TRIAGE、高風險設計、最終 AUDIT、結案判定 | `gpt-5.6-sol` | `claude-opus-5` |

Model IDs are taken verbatim from Anthropic's model table and are **complete as written** — never
append a date suffix (`claude-haiku-4-5`, not a dated variant).

**Terra 一律用 Sonnet.** Doing `TERRA_BUILD` work on Opus is over-spec, not diligence: it burns the
audit tier's cost on construction and leaves the audit tier reviewing its own output. Doing it on
Haiku is under-spec. Neither substitutes for the other, and neither is the runner's call to make.

Two consequences worth stating, because both have already been violated in practice:

- A PR whose `AGENT_LANE` is `TERRA_BUILD` must declare a `build`-tier model in
  `REQUESTED_MODEL / ACTUAL_MODEL`. `actual=Opus 5` on a `TERRA_BUILD` lane is a routing violation
  and should be recorded as one, not left as a neutral note.
- This is separate from the final risk gate below. Where a change **is** high-risk, the Final Risk
  review must still be delegated to a model in `models.finalRiskAllowedModels` (default
  `claude-fable-5-1`; `gpt-6-astra` is also allowed) regardless of which tier built it. A correct
  build tier does not remove that requirement, and passing Final Risk does not make the build tier
  correct. Which changes are high-risk is decided by `docs/MODEL-ROUTING.md`, not by this section.

`actual=unknown` stays the honest value when the platform cannot prove which model ran
(`docs/AGENT-EXECUTION.md`) — it is not a way to avoid declaring the tier.

A scorecard's `requested` / `actual` fields must record what **actually** served the lane, never
this table by assumption — verify per `docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md` when a run claims
a specific model. The table says what should have run; only the run itself says what did.

### 文件與盤點的 scout 歸屬 —— 機械判準（Owner decision, 2026-09-14）

上面那段是散文，而散文擋不住「反正我已經在跑了，順手做完比較快」。PB-036 已四次因此
被違反，2026-09-14 第五次——違反者是 audit 層本身，而且就發生在它**同一輪**寫下 PB-050
批評「埋了點卻沒驗」的時候。

所以改成路徑判準：不看動機、不看大小、不看「只是順手」。

下列路徑的產出屬 `scout` 層（`claude-haiku-4-5`）。audit 層直接編輯即為 routing violation：

```
docs/AGENT-PLAYBOOK.md
docs/metrics/**
docs/schema-truth/**
docs/slices/**
```

三條執行規則：

1. **違反要記成違反。** 在 `modelUsage.tasks` 補一筆 `requestedModel: "luna"` /
   `actualModel: "sol"`，`role` 寫明是 audit 層代做。不得記成中性註記，也不得因為
   「內容是對的」而略過——PB-036 每一次的內容都是對的，那從來不是爭點。
2. **例外必須事前宣告。** 唯一免除情形是該文件的實質內容只有 audit 層持有（Final Risk
   的裁決理由、canonical 規格的設計判定）。宣告寫在委派紀錄或 PR body；寫在事後的檢討
   裡不算。
3. **「時間不夠，委派比自己做貴」不是例外。** 那是成本判斷，而成本判斷正是本節收回的
   權限。真的時間不夠，正確做法是不做、留給下一輪，不是在 audit 層做完再解釋。

## Final risk review models (Owner decisions, 2026-09-08)

The high-risk final review gate — the one that produces the `astra-review` attestation the
`Agent WIP Policy` check requires — keeps Fable (`claude-fable-5-1`) as the default and accepts
the explicitly configured allowlist: GPT-6 Astra (`gpt-6-astra`) or Claude Fable.

- The model IDs live **only** in `scripts/agents/model-routing.json`: `models.finalRisk` is the
  default, `models.finalRiskModelCatalog` records supported identities, and
  `models.finalRiskAllowedModels` is the active subset. `requestedModel` / `actualModel` must
  match the same allowlisted model verbatim.
- The name **"Astra" is kept** for the gate itself and for the `ASTRA_*` PR-body fields — those
  names are written into PR bodies, the guard workflow and existing review records, and renaming
  them would orphan the history. Astra = the gate; Fable and Astra = the currently allowed models.
- Running the review means actually delegating it to one explicitly allowlisted model (a subagent
  pinned to that model). Producing the attestation without that delegation is still forbidden.

## Key docs

- `AGENTS.md` — mandatory agent entry point
- `docs/MODEL-ROUTING.md` — model routing and the high-risk final review gate; see the decision above
- `docs/AGENT-EXECUTION.md` — canonical autonomous execution, delegation, permissions, safety and stop rules
- `docs/DELIVERY-CHAIN.md` — canonical product delivery chain: what each gate is there to catch and what its passing evidence looks like (Luna ownership check → Terra worktree build → Sol diff audit → local isolated Supabase → serialized canonical TEST → Completion Truth five-point verification)
- `docs/AGENT-PLAYBOOK.md` — required failure/lesson log; search only entries relevant to the task
- `docs/decisions/2026-09-10-owner-multi-environment-base-freshness.md` — current multi-environment branch freshness policy; supersedes PB-015's old “always latest main / HEAD^” prevention sentence while preserving its base-evidence lesson
- `docs/DOCUMENTATION-GOVERNANCE.md` — canonical docs, direct-main docs-only rule, branch policy
- `docs/CONVENTIONS.md` — read before adding a page
- `docs/REBUILD-SPEC.md` — design system spec + per-page section/copy inventory
- `docs/specs/*.json` — DOM specs scraped from the original site, one per page; the source of
  truth for fidelity work
- `docs/integration/00-MASTER-PLAN.md` — backend integration entry point: guardrails and the
  Phase 0–10 order. Phases must be executed in order; each ends with typecheck + build + its
  checklist in `08-CHECKLIST.md`.
- `docs/integration/10-TOUR-DOMAIN.md` — canonical tour-domain spec, including departure guide assignments and scheduling
- `docs/integration/10-TOUR-DOMAIN-CHECKLIST.md` — Phase 8c.5 guide-assignment acceptance checklist
- `docs/integration/13-BUSINESS-MODES.md` — the business-modes design, already implemented in the
  mock frontend

## Git and documentation governance

- **Canonical product, architecture, API and acceptance documentation lives on `main`.** Issue text should reference stable repo paths on main, not a temporary branch URL.
- Owner-approved docs-only changes may go directly to `main`, but the commit must contain only allowed documentation paths. See `docs/DOCUMENTATION-GOVERNANCE.md`.
- Runtime code, migrations, dependencies, workflows and deployment configuration use a feature branch → PR → CI → review flow.
- `main` auto-deploys on Vercel. A docs-only main push is not permission for Production DDL/DML or runtime deployment; changes that alter production behavior require explicit Owner authorization.
- **Before applying any schema change to TEST or Production, prove the change already exists in the canonical migration on current `origin/main`** (`git show origin/main:supabase/migrations/<file>`). If you cannot, do not apply it. A feature branch, an open PR, a `supabase/local-migrations/**` overlay, the current TEST state and the current Production state are **none of them** an authorization source — the overlays self-declare `CANDIDATE_SOURCE_NOT_CANONICAL`, and "the environment already has it" is evidence of drift, not of correctness. Compare content, not just filenames (PB-017, PB-037). Merge the migration into `main` with its final content first, then apply. Owner decision 2026-09-14; full rationale in `AGENTS.md`.
- Do not hardcode one long-lived development branch in project policy. The Issue or lead agent may designate an integration branch. It must contain the required canonical decisions when designated, and agents must continue re-reading current `main` decisions; unrelated later main commits do **not** by themselves require rebasing that branch.
- Commit messages are mostly Traditional Chinese and should describe the user-visible or governance change.
