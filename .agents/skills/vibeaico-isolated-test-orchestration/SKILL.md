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
3. `docs/AGENT-BPLUS-DELIVERY-LOOP.md`
4. `docs/AGENT-EXECUTION.md`
5. `docs/integration/12-TESTING-TDD.md`
6. Issue #104 and both active Terra PRs

## Current route

```text
Terra 1 → LOCAL_ISOLATED ┐
                          ├→ one remote SHARED_CANONICAL TEST
Terra 2 → LOCAL_ISOLATED ┘
                                   ↓
                              one Sol Audit
                                   ↓
                                one merge
```

Paid Supabase Preview Branches are:

```text
DEFERRED_NOT_IN_CONSIDERATION
```

Do not create a branch, request cost confirmation, use the retired `REMOTE_BRANCH_REQUIRED` profile, or run historical paid-branch planning workflows.

## Local isolation rules

Each Terra PR must:

- use `TEST_PROFILE=LOCAL_ISOLATED`;
- set `FINAL_CANONICAL_REQUIRED=true`;
- use a unique `TEST_ENV_ID`;
- prove the TEST URL is localhost／127.0.0.1;
- avoid remote TEST and Production secrets;
- always run `supabase stop --no-backup`;
- report `ISOLATED_GREEN`, never `CANONICAL_GREEN`.

A newer SHA cancels the superseded local run for the same PR. Different PRs may run together.

## Dual Terra contract

Allow two complete Terra lanes only when both declare:

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 or 2
same RUN_ID
different primary Issue
different TEST_ENV_ID
non-overlapping FILE_OWNERSHIP
TEST_LANE_REQUIRED: false
```

Reserve Terra is disabled during the pilot. Slot 2 is optional and must not be filled merely to reach a quota.

Do not start slot 2 when ownership of AppShell, migration numbers, shared fixtures, common schema or hot files cannot be separated.

## DB／Auth／Storage

Migration, Auth and Storage work also uses:

```text
LOCAL_ISOLATED
→ SHARED_CANONICAL
```

A local-vs-remote difference is preserved as evidence. Luna compresses it; Sol diagnoses only when the cause is ambiguous or high-risk.

## Serial gates

Always keep:

```text
REMOTE_CANONICAL_TEST max 1
SOL_AUDIT             max 1
MERGE                 max 1
```

The remote holder must match exact PR, branch and SHA. Local green cannot bypass it.

## Automatic fallback

Return the next Run to one full Terra when:

- local startup or cleanup fails;
- two lanes collide in files, migrations, fixtures or schema ownership;
- cross-lane contamination appears;
- active candidates exceed two;
- quality falls below 24／30;
- carryover or post-merge regressions rise;
- weighted usage per Delivery Unit worsens by more than 20% without more output.

After fallback, a single source-only Reserve may be restored under the older B+ boundary.

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

Do not claim a slot, green result, cleanup, Audit or merge from an intended action. Re-read live workflow, PR, main and environment state through the Completion Truth Gate.
