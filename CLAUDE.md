# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Mandatory start — read main before touching code

Before working on any Issue:

1. `git fetch origin`.
2. Read `origin/main:AGENTS.md`, `origin/main:docs/AGENT-EXECUTION.md`,
   `origin/main:docs/DOCUMENTATION-GOVERNANCE.md`, and
   `origin/main:docs/OWNER-DECISIONS.md`.
3. Search `origin/main:docs/AGENT-PLAYBOOK.md` by Issue, error code, test, or domain and read
   the relevant lessons only.
4. Read the Issue's canonical `docs/integration/**` files and
   `docs/integration/12-TESTING-TDD.md` from `main`.
5. Re-read the live Issue, PR, branch and CI state; old conversations are not current evidence.
6. Base implementation work on latest `main`, or on a designated integration branch that already contains the latest main documentation commit.

Final product, architecture, API and acceptance documentation lives on `main`. A branch-only document is a draft unless `main` explicitly says otherwise. If a working branch conflicts with a newer Owner Decision or canonical spec on `main`, **main wins**.

## Default execution mode

Follow `docs/AGENT-EXECUTION.md`. The default is continuous autonomous progress: a status update
is not a stopping point, blocked work is parked while unrelated work continues, and already
recorded Owner decisions are not asked again. The same document defines model delegation,
standing TEST authorization, credentials, CI/DB serialization, evidence, and stop conditions.

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

## Key docs

- `AGENTS.md` — mandatory agent entry point
- `docs/AGENT-EXECUTION.md` — canonical autonomous execution, delegation, permissions, safety and stop rules
- `docs/AGENT-PLAYBOOK.md` — required failure/lesson log; search only entries relevant to the task
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
- Do not hardcode one long-lived development branch in project policy. The Issue or lead agent may designate an integration branch, but it must already contain the latest canonical main documentation commit.
- Commit messages are mostly Traditional Chinese and should describe the user-visible or governance change.
