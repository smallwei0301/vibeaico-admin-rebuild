---
name: vibeaico-agent-orchestration
description: "Use for /goal, 開始 Loop, 繼續 Loop, continued autonomous delivery, model switches, open-Issue reduction, multi-Agent delegation, B+ WIP control, shared TEST scheduling, CI classification, PR cleanup, scorecard generation, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Enforces one MAIN Terra, one source-only RESERVE Terra, one Luna Closure lane, 3-6 narrow Luna tasks, one shared TEST holder, at most two active candidates, and verified completion claims."
metadata:
  author: smallwei0301
  version: "0.6.0"
---

# VibeAI.co B+ Agent Orchestration

Canonical policy order:

1. `origin/main:docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
2. `origin/main:docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
3. `origin/main:docs/AGENT-EXECUTION.md`
4. `origin/main:docs/AGENT-BPLUS-DELIVERY-LOOP.md`
5. `origin/main:docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
6. `origin/main:docs/PR-LIFECYCLE.md`

Older Mode C decisions are historical wherever they allow multiple complete Terra BUILD lanes.

## Natural-language triggers

```text
開始 Loop      start or safely resume B+
繼續 Loop      resume the latest IN_PROGRESS Run from live state
/goal          resume when a Run exists; otherwise start
復盤 / 複盤    route to vibeaico-agent-retrospective, read-only by default
```

`開始 Loop` must not create a duplicate Run when an `IN_PROGRESS` ledger already exists.

## Start or resume

1. Fetch latest `origin/main`.
2. Read the canonical files above, `AGENTS.md`, `CLAUDE.md`, `docs/OWNER-DECISIONS.md`, the Issue's
   canonical docs, and only directly relevant Playbook entries.
3. Read live open Issues／PRs, exact heads, CI, TEST holder and the latest 1–3 run reports.
4. Resume the newest valid `IN_PROGRESS` Run; create a `RUN_ID` only when none exists.
5. Preserve usable branches, PRs, migrations and test checkpoints. Never reset completed work.
6. Do not report a write action as completed until the Completion Truth Gate is satisfied.

## B+ topology

```text
MAIN_TERRA       max 1 complete medium/large delivery lane
RESERVE_TERRA    max 1 source-only preparation lane
LUNA_CLOSURE     max 1 closeout / Janitor lane
LUNA_TASKS       default 4, max 6, plus one Aggregator
TEST_VALIDATION  max 1 shared TEST holder
ACTIVE_CANDIDATE max 2
```

RESERVE is not a second delivery line. It may produce at most one atomic source-only commit, then
stops at `READY_FOR_PROMOTION`.

## Router

```text
LUNA_TRUTH       live facts, open work, exact heads, TEST holder
LUNA_CLOSURE     close-ready candidates and mechanical closeout
LUNA_CI          status-change-only CI monitoring and error compression
LUNA_JANITOR     stale/superseded PR inventory and safe retirement evidence
LUNA_DOCS        PR body, checkboxes, metadata and handoff synchronization
LUNA_QA          acceptance gaps, maximum three blockers
LUNA_METRICS     run ledger and scorecard inputs
LUNA_AGGREGATOR  deduplicate Luna results into <=30 lines
SOL_TRIAGE       choose MAIN, optional RESERVE and Closure target
MAIN_TERRA       build the sole complete delivery candidate
RESERVE_TERRA    prepare one bounded source-only slice
SOL_DIAGNOSE     only ambiguous/high-risk CI, DB/Auth/payment/security/collision
SOL_AUDIT        final CLOSE verdict
LUNA_CLOSEOUT    evidence, status, Issue close, lane release, report
```

## Luna fan-out

Each Luna receives only:

```text
TASK_ID
ISSUE / PR
EXACT_HEAD
ONE QUESTION
READ_ONLY_PATHS
DO_NOT_READ
OUTPUT_MAX_LINES: 15
ALLOWED_RESULT: PASS | GAP | ESCALATE_TERRA | ESCALATE_SOL | OWNER_BLOCKED
```

Do not copy full chat history or make multiple Luna agents scan the same inventory. One Aggregator
removes duplicates before Sol reads the result.

## TRIAGE output

```text
RUN_ID:
MAIN_TERRA:
RESERVE_TERRA:
CLOSURE_TARGET:
CLOSEABILITY_SCORE:
SELECTION_REASON:
DEPENDENCIES:
OWNER_OR_EXTERNAL_BLOCKER:
TEST_REQUIRED:
RESERVE_BOUNDARY:
RISK:
ACCEPTANCE_GATES:
WHY_NOT_CLOSER_CANDIDATE:
```

Prefer score 5→3 candidates. A lower-score dependency unlocker needs a concrete explanation.

## MAIN and RESERVE

MAIN may use TEST and Sol Audit. It stays active until:

```text
CLOSED | AUDIT_READY | OWNER_BLOCKED
```

RESERVE starts only while MAIN is genuinely waiting and has no safe source work. It must set:

```text
AGENT_LANE: TERRA_RESERVE
ACTIVE_CANDIDATE: false
TEST_LANE_REQUIRED: false
RESERVE_BOUNDARY: concrete file/scope/stop boundary
```

If RESERVE needs TEST, Audit, a second commit or broader scope, stop and return to TRIAGE.

## Shared TEST

Only one active `TEST_VALIDATION` PR may use TEST secrets, migration/reset/seed/schema-cache mutation,
integration or E2E. Non-holder runtime PRs run source checks and record a successful `POLICY_SKIP`.
A lane transition must match exact PR, branch and SHA. No no-op commits and no unchanged reruns.

## Sol budget

Normal Issue:

```text
TRIAGE 1
AUDIT  1
```

One additional Sol DIAGNOSE is allowed only for DB/Auth/payment/security, shared TEST ambiguity,
cross-suite inconsistency or core ownership collision. Sol does not poll CI or move documents.

## Completion Truth Gate

A successful tool invocation means only `REQUESTED`, not `COMPLETED`.

Before saying a PR was merged:

1. fetch the PR after the merge action;
2. verify `merged=true` or `merged_at` and record `merge_commit_sha`;
3. fetch current default-branch head;
4. compare the merge commit to default branch and require `ahead` or `identical`;
5. re-read at least one changed file with `ref=main`;
6. record exact-head CI and verification time.

Until then use `MERGE_REQUESTED_UNVERIFIED`. Apply the same pattern to Issue close, CI green,
migration applied, deployment, and files claimed to be on main.

A completion claim that conflicts with live state is `AUDIT_DATA_INVALID`, increments
`quality.safetyViolations`, adds a `hardFailReasons` entry, and makes the run `F-HARD`.

## Closeout and report

Every loop updates:

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

Run:

```text
node scripts/agents/run-ledger.mjs validate <json>
node scripts/agents/score-run.mjs <json> --output <md>
node scripts/agents/score-run.mjs <json> --check <md>
```

Record actual token data when available. Otherwise keep it `null` and use internal weights Luna=1,
Terra=3, Sol=6 with compact=1, medium=1.5, full=3. The weights are not OpenAI's official usage
conversion, and `actualModel=unknown` must remain visible.

## Automatic adjustment

- Luna adoption >=85%, duplicate rate <=10%, quality >=25/30: next run may add one Luna, max 6.
- Luna adoption <70% or duplicate rate >15%: remove one Luna and narrow tasks.
- Usage rises >20% without more Delivery Units: disable RESERVE and limit review to one Agent.
- Quality <24/30: stop RESERVE code work and strengthen MAIN targeted tests.
- Two runs without CLOSED or complete OWNER_BLOCKED: enter `CLOSURE_RECOVERY`.

## Verdicts

Sol returns exactly one:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna or the main Agent performs mechanical close only after `CLOSE_APPROVED`, then re-fetches the
Issue to verify `state=closed` before reporting it closed.

## Continue rule

A progress update, CI wait, TEST wait, model switch, commit, PR, one completed Issue or one blocked
Issue is not a global stop. Continue the B+ loop until canonical stop conditions are met, while
keeping only one complete MAIN Terra line.
