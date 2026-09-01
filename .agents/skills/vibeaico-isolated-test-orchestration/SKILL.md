---
name: vibeaico-isolated-test-orchestration
description: "Use for Issue #104, local Supabase per-PR tests, TEST_PROFILE routing, Supabase Preview Branches, isolated TEST slots, canonical TEST handoff, migration rebuild drift, or raising B+ full Terra capacity in smallwei0301/vibeaico-admin-rebuild. Enforces Phase 1A canary, Phase 1B full local tests, cost-confirmed Preview Branches, exact-head cleanup, and serial final TEST/Audit/merge."
metadata:
  author: smallwei0301
  version: "0.2.0"
---

# Isolated TEST orchestration

Read from `origin/main`:

1. `docs/decisions/2026-09-01-owner-isolated-test-lanes.md`
2. `docs/AGENT-ISOLATED-TEST-LANES.md`
3. `docs/AGENT-EXECUTION.md`
4. `docs/integration/12-TESTING-TDD.md`
5. Issue #104 and the current candidate PR

## Stage gate

```text
Phase 1A two-slot isolation canary
→ Phase 1B canonical migration rebuild + full local integration/E2E
→ Phase 2 cost-confirmed remote branch lifecycle
→ Phase 3 FULL_TERRA_MAX may become 2
```

Never change Terra capacity first.

## Phase 1A

- Use `LOCAL_ISOLATED_CANARY` only for infrastructure proof with two runners.
- Both runners intentionally insert the same fixed tenant ID and hold it concurrently.
- Shared database, cross-slot mutation, non-local URL, or cleanup failure makes canary fail.
- Require `FINAL_CANONICAL_REQUIRED=true`.
- Do not read remote TEST secrets.
- Always stop with `supabase stop --no-backup`.
- Report `ISOLATION_CANARY_GREEN`, never `ISOLATED_GREEN` or `CANONICAL_GREEN`.

## Phase 1B

Use `LOCAL_ISOLATED` only after current main can rebuild a fresh database from canonical migrations.
It runs standard reset/seed, integration, E2E and cleanup.

If seed fails because a required table is absent:

```text
MIGRATION_LEDGER_INCOMPLETE
```

Do not weaken seed, import every open-PR migration, copy an unaudited remote schema dump, or connect
local jobs to remote secrets. Trace each missing schema object to merged/canonical source, reconcile it
through a separate reviewed PR, and keep `MAIN_TERRA max 1` until the full local suite is reproducible.

## Phase 2

Paths touching migrations, Auth or Storage are `REMOTE_BRANCH_REQUIRED` candidates.

Before creating a Supabase branch:

1. list current branches;
2. fetch current cost;
3. require explicit Owner cost confirmation;
4. prove TEST parent project ref `nmwhwngojosmagjuvxol`;
5. ensure fewer than two live branches;
6. set a lease and cleanup owner.

Never call `merge_branch`. Delete and re-fetch the branch after use. A delete request alone is not
`VERIFIED_DESTROYED`.

## Phase 3

Allow two complete Terra lanes only when Phase 1A and 1B are green and the required remote branch
slots are healthy. Both Terra lanes require different Issue, file ownership and TEST_ENV_ID. Any
unhealthy slot immediately returns the limit to one.

Always keep these serial:

```text
REMOTE_CANONICAL_TEST max 1
SOL_AUDIT             max 1
MERGE                 max 1
```

## Evidence

Return:

```text
PHASE
PR / ISSUE
EXACT_HEAD
TEST_PROFILE
TEST_ENV_ID
MIGRATION_BASELINE
CANARY_RESULT
ISOLATED_RESULT
CANONICAL_RESULT
CLEANUP_STATUS
COST
NEXT_GATE
```

Do not claim a later phase is enabled from documents or a tool request alone. Re-read live workflow,
branch and main state through the Completion Truth Gate.
