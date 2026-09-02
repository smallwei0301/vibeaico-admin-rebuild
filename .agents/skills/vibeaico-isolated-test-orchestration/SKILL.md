---
name: vibeaico-isolated-test-orchestration
description: "Use for Issue #104, local Supabase per-PR tests, TEST_PROFILE routing, two free isolated TEST slots, canonical TEST handoff, migration rebuild drift, or the B+ dual-Terra pilot in smallwei0301/vibeaico-admin-rebuild. Paid Supabase Preview Branches are deferred and must not be created."
metadata:
  author: smallwei0301
  version: "0.3.0"
---

# Free isolated TEST orchestration

Read from `origin/main`:

1. `docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
2. `docs/AGENT-ISOLATED-TEST-LANES.md`
3. `docs/AGENT-EXECUTION.md`
4. `docs/DELIVERY-OUTCOME-V2.md`
5. `docs/integration/12-TESTING-TDD.md`
6. Issue #104 and current candidate PRs

## Current route

```text
Terra slot 1 → its own free LOCAL_ISOLATED Supabase ┐
                                                     ├→ one SHARED_CANONICAL TEST
Terra slot 2 → its own free LOCAL_ISOLATED Supabase ┘
                                                              ↓
                                                         one Sol Audit
                                                              ↓
                                                           one merge
```

Paid Supabase Preview Branches are:

```text
DEFERRED_NOT_IN_CONSIDERATION
```

Do not create a branch, request cost confirmation, run a paid-branch planning workflow, or use
`REMOTE_BRANCH_REQUIRED`. A future exception requires a new explicit Owner Decision.

## Local isolation

Each Terra PR must:

- use `TEST_PROFILE=LOCAL_ISOLATED`;
- set `FINAL_CANONICAL_REQUIRED=true`;
- declare a unique `TEST_ENV_ID`;
- use a localhost／127.0.0.1 Supabase URL;
- avoid remote TEST and Production secrets;
- always run `supabase stop --no-backup`;
- report `ISOLATED_GREEN`, never `CANONICAL_GREEN`.

A newer SHA cancels the superseded local run for the same PR. Different PRs may run together.
`LOCAL_ISOLATED_CANARY` uses two disposable runners only to prove runner/database/cleanup isolation.

## DB／Auth／Storage

Migration, Auth and Storage work uses the free route:

```text
LOCAL_ISOLATED
→ SHARED_CANONICAL
```

A local-vs-remote difference is preserved as evidence. Luna compresses it; Sol diagnoses only when the
cause is ambiguous or high-risk. Do not switch to a paid branch as a shortcut.

## Dual Terra contract

Allow two complete Terra lanes only when both declare:

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 or 2
same RUN_ID
different primary Issue
different TEST_ENV_ID
non-overlapping FILE_OWNERSHIP
TEST_LANE_REQUIRED: false while building
```

The guard revalidates both peers. Empty, absolute, traversing, wildcard or parent/child ownership
boundaries fail closed. Reserve Terra is disabled while the dual pilot is active.

## Serial final gates

Always keep:

```text
REMOTE_CANONICAL_TEST max 1
SOL_AUDIT             max 1
MERGE                 max 1
```

The remote holder must match exact PR, branch and SHA. Local green cannot bypass the queue.

## Automatic fallback

Return the next Run to one full Terra when:

- local startup or cleanup fails;
- lanes collide in files, migrations, fixtures or schema ownership;
- cross-lane contamination appears;
- active Product candidates exceed two;
- quality drops or post-merge regression rises;
- weighted usage per shipped／autonomous outcome worsens by more than 20% without more output.

## Evidence

Return:

```text
RUN_ID
TERRA_SLOT
PR / ISSUE
EXACT_HEAD
TEST_PROFILE
TEST_ENV_ID
FILE_OWNERSHIP
ISOLATED_RESULT
LOCAL_CLEANUP_STATUS
REMOTE_QUEUE_POSITION
CANONICAL_RESULT
SOL_VERDICT
MERGE_RESULT
```

Do not claim a slot, local green, cleanup, remote green, Audit or merge from an intended action. Re-read
live workflow, PR, main and environment evidence through the Completion Truth Gate.
