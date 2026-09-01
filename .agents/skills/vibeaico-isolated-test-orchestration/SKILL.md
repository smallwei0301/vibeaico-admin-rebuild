---
name: vibeaico-isolated-test-orchestration
description: "Use for Issue #104, local Supabase per-PR tests, TEST_PROFILE routing, Supabase Preview Branches, isolated TEST slots, canonical TEST handoff, or raising B+ full Terra capacity in smallwei0301/vibeaico-admin-rebuild. Enforces staged rollout, exact-head isolation, cleanup, cost confirmation, and serial final TEST/Audit/merge."
metadata:
  author: smallwei0301
  version: "0.1.0"
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
Phase 1 local isolation verified
→ Phase 2 remote branch lifecycle verified
→ Phase 3 FULL_TERRA_MAX may become 2
```

Never change Terra capacity first.

## Phase 1

- Choose `LOCAL_ISOLATED` for one per-PR local stack.
- Use `LOCAL_ISOLATED_CANARY` only for infrastructure proof with two runners.
- Require `FINAL_CANONICAL_REQUIRED=true`.
- Local URL must be `localhost` or `127.0.0.1`.
- Do not read remote TEST secrets.
- Always stop with `supabase stop --no-backup`.
- Report `ISOLATED_GREEN`, never `CANONICAL_GREEN`.

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

Allow two complete Terra lanes only when two isolated slots are healthy and use different Issue,
file ownership and TEST_ENV_ID. Any unhealthy slot immediately returns the limit to one.

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
ISOLATED_RESULT
CANONICAL_RESULT
CLEANUP_STATUS
COST
NEXT_GATE
```

Do not claim a later phase is enabled from documents or a tool request alone. Re-read live workflow,
branch and main state through the Completion Truth Gate.
