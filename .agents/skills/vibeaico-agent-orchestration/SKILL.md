---
name: vibeaico-agent-orchestration
description: "Use for /goal, 開始 Loop, 繼續 Loop, continued autonomous delivery, model switches, open-Issue reduction, multi-Agent delegation, B+ WIP control, local/remote TEST scheduling, CI classification, PR cleanup, scorecard generation, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Enforces up to two qualified full Terra lanes on free per-PR local Supabase, no Reserve during the pilot, one Luna Closure lane, 3-6 narrow Luna tasks, one remote canonical TEST holder, one Sol Audit, one merge, at most two active candidates, and verified completion claims."
metadata:
  author: smallwei0301
  version: "0.7.0"
---

# VibeAI.co B+ Free Dual-Terra Orchestration

Canonical policy order:

1. `origin/main:docs/decisions/2026-09-02-owner-free-local-dual-terra-pilot.md`
2. `origin/main:docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
3. `origin/main:docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
4. `origin/main:docs/AGENT-EXECUTION.md`
5. `origin/main:docs/AGENT-BPLUS-DELIVERY-LOOP.md`
6. `origin/main:docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
7. `origin/main:docs/PR-LIFECYCLE.md`

Mode C is historical. Paid Supabase Preview Branch planning is also historical until a future explicit
Owner decision restores it.

## Natural-language triggers

```text
開始 Loop      start or safely resume B+
繼續 Loop      resume the latest IN_PROGRESS Run from live state
/goal          resume when a Run exists; otherwise start
復盤 / 複盤    route to vibeaico-agent-retrospective, read-only by default
```

## Start or resume

1. Fetch latest `origin/main` and read the canonical files above.
2. Read live open Issues／PRs, exact heads, local runs, remote TEST holder and the latest 1–3 reports.
3. Resume the newest valid `IN_PROGRESS` Run; create a new `RUN_ID` only when none exists.
4. Preserve usable branches, PRs, migrations and test checkpoints. Never reset completed work.
5. Do not report a write action as completed until the Completion Truth Gate is satisfied.

## Current topology

```text
TERRA_BUILD      max 2 only under the qualified free dual-pilot contract
TERRA_RESERVE    max 0 while any dual-pilot Terra is active
LUNA_CLOSURE     max 1 closeout / Janitor lane
LUNA_TASKS       default 4, max 6, plus one Aggregator
LOCAL_ISOLATED   one disposable local Supabase per Terra PR
TEST_VALIDATION  max 1 remote canonical holder
SOL_AUDIT        max 1
MERGE            max 1
ACTIVE_CANDIDATE max 2
```

Without the complete pilot contract, TERRA_BUILD automatically remains max 1.

## Dual Terra contract

Both active Terra PRs must declare:

```text
DUAL_TERRA_PILOT: true
TERRA_SLOT: 1 or 2
same RUN_ID
different primary Issue
TEST_PROFILE: LOCAL_ISOLATED
different TEST_ENV_ID
FINAL_CANONICAL_REQUIRED: true
FILE_OWNERSHIP: comma-separated non-overlapping roots
TEST_LANE_REQUIRED: false
```

Do not start slot 2 when file ownership, migration number, AppShell, shared fixture or schema ownership
cannot be separated. Do not activate Reserve during the pilot.

## Router

```text
LUNA_TRUTH       live facts, open work, exact heads, local/remote TEST state
LUNA_CLOSURE     close-ready candidates and mechanical closeout
LUNA_CI          status-change-only monitoring and error compression
LUNA_JANITOR     stale/superseded PR inventory and safe retirement evidence
LUNA_DOCS        PR body, checkboxes, metadata and handoff synchronization
LUNA_QA          acceptance gaps, maximum three blockers
LUNA_METRICS     run ledger and scorecard inputs
LUNA_AGGREGATOR  deduplicate Luna results into <=30 lines
SOL_TRIAGE       select slot 1, optional slot 2, ownership and remote queue order
TERRA_SLOT_1/2   build two independent complete candidates
SOL_DIAGNOSE     only ambiguous/high-risk CI, DB/Auth/payment/security/collision
SOL_AUDIT        one final verdict at a time
LUNA_CLOSEOUT    evidence, status, Issue close, lane release, report
```

## Luna fan-out

Each Luna receives one question, one Issue/PR, exact head, restricted paths and at most 15 output lines.
Do not copy full chat history or make multiple Luna agents scan the same inventory.

## TRIAGE output

```text
RUN_ID:
TERRA_SLOT_1:
TERRA_SLOT_2:
CLOSURE_TARGET:
CLOSEABILITY_SCORE_1/2:
SELECTION_REASON_1/2:
DEPENDENCIES:
OWNER_OR_EXTERNAL_BLOCKER:
TEST_PROFILE_1/2:
TEST_ENV_ID_1/2:
FILE_OWNERSHIP_1/2:
REMOTE_TEST_ORDER:
RISK:
ACCEPTANCE_GATES:
```

Slot 2 is optional, not a quota to fill.

## Local isolated TEST

Each Terra PR runs its own exact-head local Supabase workflow. Different PR numbers have different
concurrency groups and can run together. A newer SHA cancels the older local run for the same PR.

Local success is only:

```text
ISOLATED_GREEN
LOCAL_CLEANUP_VERIFIED
```

It never means canonical green.

DB migration、Auth and Storage changes use local isolation plus the final remote canonical gate. Do not
create or request a paid Supabase Preview Branch.

## Remote TEST, Audit and merge

Only one active `TEST_VALIDATION` PR may use remote TEST secrets, migration/reset/seed/schema-cache,
integration or E2E. Promote the higher-closeability local-green candidate first.

Always keep:

```text
REMOTE_CANONICAL_TEST max 1
SOL_AUDIT             max 1
MERGE                 max 1
```

No no-op commits, unchanged reruns or old-SHA evidence.

## Automatic fallback

Return to one full Terra in the next run when local startup/cleanup fails, ownership collides, slots
contaminate each other, active candidates exceed two, quality falls below 24/30, carryover/regression
rises, or weighted usage per Delivery Unit worsens by more than 20% without more output.

After fallback, one source-only Reserve may be restored under the older B+ boundary.

## Sol budget

Normal Issue: TRIAGE 1, AUDIT 1. One additional DIAGNOSE is allowed only for DB/Auth/payment/security,
local-versus-remote inconsistency, shared TEST ambiguity or ownership collision. Sol does not poll CI.

## Completion Truth Gate

A successful tool invocation means only `REQUESTED`, not `COMPLETED`. Re-fetch PR/Issue/CI/main or the
external environment before saying merged, closed, green, migrated or deployed. Until then use
`*_REQUESTED_UNVERIFIED`.

## Closeout and report

Every loop updates:

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

Record slot usage, local run IDs, cleanup, remote wait, ownership collisions, Delivery Units, actual
model/token data when available, and internal weights only when actual data is unavailable.

## Verdicts

Sol returns exactly one:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna closes only after `CLOSE_APPROVED`, then re-fetches the Issue to verify `state=closed`.

## Continue rule

A progress update, local/remote CI wait, model switch, commit, PR or one blocked Issue is not a global
stop. Continue until canonical stop conditions are met, while never exceeding two qualified Terra,
one remote TEST, one Audit and one merge.
