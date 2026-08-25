# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev         # http://localhost:3000/tenant/dashboard
npm run build       # production build (also runs full type check)
npm run start       # serve production build
npm run typecheck   # tsc --noEmit — the primary gate; must be zero errors
```

`npm run lint` is `next lint`, which is deprecated in Next 15 and **hangs on an interactive
ESLint-setup prompt** — no ESLint config exists yet. Use `npm run typecheck` + `npm run build`
as the verification gate instead.

No test runner is installed yet. `docs/integration/12-TESTING-TDD.md` specifies the intended
setup (Vitest for unit/integration, Playwright for E2E, a separate TEST Supabase project);
it gets built in Phase 0 of the backend integration plan.

Chromium for ad-hoc browser verification lives at `/opt/pw-browsers/chromium`; Playwright is
installed globally at `/opt/node22/lib/node_modules/playwright` (not in this project's
`node_modules`), so scripts must `require()` that absolute path.

## What this repo is

A rebuild of the `vibeaico.com/tenant/*` multi-tenant shop-admin panel as a clean Next.js 15
App Router skeleton (React 19, TypeScript strict, Tailwind 3, lucide-react, zod). ~40 pages,
routes identical to the original site.

**It is currently mock-only.** `NEXT_PUBLIC_USE_MOCK=true` (the default) means no database or
backend is needed — everything reads from `src/mock/`. There is no `src/app/api/**` and no
`src/server/**` yet. Wiring up the real backend (Supabase + Resend + LINE) is planned in detail
across `docs/integration/00-13`, tracked by GitHub issue #1, and has not started.

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

## Never fabricate a "known" — the false-error lesson

**A status the code did not actually determine must never be displayed as if it had been.**
This was learned the expensive way: the LINE setup report's "自動回應訊息" row was hardcoded
`pass: false` with a "no public API to check this" comment. It never checked anything. The user
turned the setting off in LINE, re-ran the check, still saw a red failure, and reasonably asked
whether the error was real. It wasn't — and every earlier run of that report had been lying too.

Two compounding defects, both worth recognising on sight:

1. **A reminder rendered as a measurement.** "Please go check X yourself" is useful; painting it
   red next to items that *were* measured makes it indistinguishable from a real failure.
2. **A check that can never pass.** Because the page counted every non-pass as a failure, the
   report could not print "全部通過" under any configuration. A warning that is always on is
   not a warning — users learn to ignore the whole panel, including the rows that are real.

It also turned out "no public API" was only half true: `GET /v2/bot/info` returns `chatMode`,
which covers the most common cause of the same symptom. **Before encoding "we can't know this",
check the provider's current API reference** — LINE publishes an OpenAPI spec
(`github.com/line/line-openapi`) that settles such questions in one grep. A spec doc claiming a
limitation (06 分冊 §7 specified this very behaviour) is not evidence the limitation still holds.

Rules that follow:

- Distinguish **FAIL** (we checked, it's broken) from **WARN/INFO** (we could not check, or it
  isn't built yet). Never collapse the second into the first.
- If a value is unknown, render the unknown state (`--`, "未設定", "未知") — **never a plausible
  placeholder**. Fabricated numbers are worst next to real ones: the points page showed a real
  point balance beside a hardcoded `MOCK_MONTHLY_COST = 196` and `MOCK_PENDING_TOPUP = 1000`,
  with nothing on screen to tell them apart. The dashboard likewise labelled every configured
  account "輕量版" from a `MOCK_LINE_PLAN` constant, though LINE exposes no plan lookup at all.
- State only what was verified. `linePlatformStatus` returns `CONNECTED` whenever a token
  *string exists*, without ever calling LINE — so a revoked token still reads as connected.
  Either verify, or name the state after what you actually know ("已設定", not "已連接").
- Returning **empty** for a feature that isn't built yet is honest and fine (`/api/calendar`'s
  DEPARTURE/EXTERNAL sources, `upcomingDepartureCount` before Phase 8b). Returning a **made-up
  value** is not. The line is: absence of data ≠ invented data.
- When a placeholder is genuinely unavoidable, say so *in the UI where the user reads it*, not
  only in a code comment. The comment protects the next developer; the user is the one being
  misled.

The same principle applies to **interactions and checklists**, learned via the same expensive
route (2026-08-24 full audit, `docs/integration/14-GAP-AUDIT.md` — 25 pages found faking it):

- **A success toast is a claim of fact.** A button that shows "已發布/已儲存" after only
  mutating local React state (often behind a `setTimeout` fake delay) is fabricating a known.
  The rich-menu 發布 button did exactly this — the API existed, was integration-tested green,
  and the page had never called it. If the backend isn't wired yet, say "尚未生效" honestly.
- **A checked checkbox is also a claim of fact.** No acceptance-checklist item
  (`docs/integration/08-CHECKLIST.md`) may be checked without written evidence — test
  file:case name, or a manual-test record (date + steps + result). "The API's integration
  tests pass" is NOT evidence for a page-level feature: the handler → `src/services/*` →
  endpoint chain must be shown intact (12 分冊 §6 items 9–11; 鐵則 12 in 00 分冊).
- Watch for the structural blind spot that let this happen: unit tests don't cover pages,
  integration tests deliberately don't test UI, and e2e only runs where the test matrix
  names it — so page wiring belonged to no layer, and "all green" coexisted with a fake
  button for weeks.

## Issue-authoring convention (owner's standing preference)

All work is dispatched as GitHub issues written for a **weak executor model**. Every issue must
have: (1) 前置 issue link — strictly sequential, the previous issue's checklist must be fully
checked *with evidence* first; (2) 背景與根因 linking the plan docs; (3) 對應文件 section
naming exact 分冊/章節; (4) 驗收標準 as a checklist where **every item names its evidence**
(test file:case name, or automated-run output) — no evidence, no checkmark, no next step;
(5) verification is **automated by default** — unit/integration tests plus Playwright against
the Preview site, with credentials the agent fetches itself from the owner's Google Drive
credentials doc ("#Supabase#midao"); (6) a 人工介入點 section that lists ONLY decisions and
missing-token env updates — never manual testing steps. Executor discipline lives in
`docs/integration/15-AGENT-PLAYBOOK.md`; every issue links it instead of repeating it.

## Database changes: always apply to BOTH Supabase projects

There are two Supabase projects and **every migration must be applied to both, in the same
session you write it** — never to just one:

| Project | ref | Used by |
|---|---|---|
| Vibeaico-admin-rebuild 正式 | `egehnijjpgijmccagxac` | Vercel **production** and **preview** (the branch preview URL is the manual-testing site) |
| Vibeaico-admin-rebuild test | `nmwhwngojosmagjuvxol` | `npm run test:integration`, CI's `integration` job, Playwright E2E |

Applying to only one is the single most common way to break things later: the app deploys fine
but the *other* environment 500s on a missing column, and the failure surfaces hours later in a
context where the cause is not obvious. Integration tests run against TEST; the preview site the
user tests by hand runs against 正式 — a column added to one but not the other means one of those
two will fail.

Apply via the Management API (the only channel reachable from this sandbox — the sandbox proxy
only passes HTTPS, so `psql` / `supabase db push` cannot connect):

```js
// SUPABASE_ACCESS_TOKEN (sbp_…) is in .env.local; project API keys do NOT work here.
for (const ref of ['nmwhwngojosmagjuvxol', 'egehnijjpgijmccagxac']) {
  await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: sql }),
  });
}
```

Run it with `NODE_USE_ENV_PROXY=1`, then **verify** (query `information_schema.columns` or
`pg_class` on both) rather than trusting the 201. Migrations are one-shot `create` statements
against a clean project, so re-running one errors — that is expected, not a failure to fix.

⚠️ `scripts/test/reset-db.mjs` wipes every business table before each integration run. It has a
hard safety lock refusing to touch 正式, so the preview site's data is safe — but anything created
by hand in the **TEST** project will be destroyed by the next `npm run test:integration`.

## Key docs

- `docs/CONVENTIONS.md` — read before adding a page
- `docs/REBUILD-SPEC.md` — design system spec + per-page section/copy inventory
- `docs/specs/*.json` — DOM specs scraped from the original site, one per page; the source of
  truth for fidelity work
- `docs/integration/00-MASTER-PLAN.md` — backend integration entry point: 11 guardrails and the
  Phase 0–10 order. Phases must be executed in order; each ends with typecheck + build + its
  checklist in `08-CHECKLIST.md`.
- `docs/integration/13-BUSINESS-MODES.md` — the business-modes design, already implemented in the
  mock frontend

## Git

Work happens on `claude/deploy-vercel-project-nnno59`; **Vercel auto-deploys from `main`**, so
changes meant to be visible on the deployment must reach `main` too. Commit messages in this repo
are mostly Traditional Chinese, describing the user-visible change.
