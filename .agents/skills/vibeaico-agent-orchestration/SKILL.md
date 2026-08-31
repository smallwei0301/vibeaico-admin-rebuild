---
name: vibeaico-agent-orchestration
description: "Use for any long-running /goal, model switch, open-Issue reduction, multi-agent delegation, PR lifecycle cleanup, WIP control, CI failure classification, high-risk review, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Enforces one active Terra build, one Luna closure sweep, one shared TEST lane, close-first TRIAGE, Sol gates, and fail-closed PR Janitor rules."
metadata:
  author: smallwei0301
  version: "0.3.0"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. Canonical policy is:

1. `origin/main:docs/decisions/2026-08-31-owner-global-wip-cap.md`
2. `origin/main:docs/AGENT-EXECUTION.md`
3. `origin/main:docs/PR-LIFECYCLE.md`

If this skill conflicts with those files, the newer higher-priority canonical policy wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, the three canonical files above,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only relevant `docs/AGENT-PLAYBOOK.md` entries.
3. Read live open Issues, PRs, exact heads, CI and current shared TEST lane. Old chat is only a clue.
4. Run a PR lifecycle inventory and classify current lanes before assigning BUILD work.
5. Continue from the current stage. Do not reset a usable branch, PR, migration or test checkpoint.

## Owner control signals

Classify control before judging the previous agent:

```text
OWNER_MODEL_SWITCH    Owner re-sent /goal to change model speed, depth or role
OWNER_STEER           Owner changed constraints, authorization or direction
OWNER_CONTINUE        Owner manually continued the same work
AGENT_PREMATURE_STOP  Assistant terminated while safe autonomous work still existed
UNKNOWN_CONTROL_EVENT Evidence is insufficient
```

Owner `/goal`, `/steer` or `continue` alone is not proof of a Stop Guard failure. After a model
switch, preserve branch, PR, exact head, TEST lane and stage. Reconstruct missing context from live
GitHub and a compact checkpoint, not the full old conversation.

## Router

```text
SCOUT      Luna   facts, inventory, dependencies, CI snippets
TRIAGE     Sol    close-first selection, order, risk, acceptance gates
BUILD      Terra  the single active medium/large Issue end to end
DIAGNOSE   Terra  deterministic code failure
DIAGNOSE   Sol    ambiguous CI, TEST environment, Auth/DB/security
AUDIT      Sol    high-risk review and CLOSE verdict
CLOSEOUT   Luna   evidence, docs, PR/Issue updates, close action
JANITOR    Luna   PR inventory, ancestry checks and stale closeout
```

`JANITOR` is cross-cutting and belongs to the fixed Luna Closure lane. It is not a second product
BUILD stage.

## Global WIP gates

A long-running goal may have only:

```text
TERRA_BUILD      max 1 active medium/large implementation across the repo
LUNA_CLOSURE     exactly 1 closure sweep, or explicit EMPTY_WITH_SCAN
TEST_VALIDATION  max 1 shared TEST mutation/integration lane
ACTIVE_CANDIDATE max 2 PRs total
```

Rules:

- If an active Terra build exists, do not start a second medium/large implementation for another
  Issue. New work is parked or replaces the current lane after Sol TRIAGE.
- Keep one Closure Sweep. If no closeable target exists, report `EMPTY_WITH_SCAN` and checked
  candidates.
- Other open PRs are `PARKED`, `HISTORICAL`, `REBUILD_REQUIRED` or `OWNER_GATED`; do not push,
  rerun, dispatch TEST or poll them.
- TEST work uses the single serialized lane. While occupied, continue Closure Sweep, docs, review or
  targeted checks that do not touch TEST.
- A newer lane that violates a cap is parked before more work, not justified afterward.

## Close-first TRIAGE

Score candidates before opening a Terra lane:

```text
5  final branch already contains the work; only evidence/checkbox/close remains
4  one small autonomous step remains
3  existing PR and most tests; at most two autonomous steps remain before AUDIT
2  substantial implementation or multi-round lifecycle verification remains
1  primarily Owner/external/Production blocked or depends on multiple large Issues
0  stale, duplicate, superseded or not an active candidate
```

Priority:

1. scores 5, 4, 3 with no Owner/external blocker;
2. a necessary dependency unlocker;
3. P0 runtime, security or data-loss work;
4. other work.

If Sol chooses a score below 3 while a score 3+ candidate exists, it must provide
`WHY_NOT_CLOSER_CANDIDATE` or choose the closer candidate.

TRIAGE returns:

```text
NEXT:
SELECTION_REASON: CLOSE_READY | DEPENDENCY_UNLOCKER | P0_RUNTIME | OWNER_DIRECTED
CLOSEABILITY_SCORE:
REMAINING_AUTONOMOUS_STEPS:
DEPENDENCIES:
OWNER_OR_EXTERNAL_BLOCKER:
TEST_LANE_REQUIRED:
ACTIVE_CANDIDATE:
CLOSURE_SWEEP_TARGET:
WHY_NOT_CLOSER_CANDIDATE:
RISK:
GATES:
```

## Fixed Luna Closure Sweep

Scan open PR-linked Issues, recent commit/CI Issues and prior score 3+ candidates. Check at most five
candidates before expanding. Luna may collect evidence, update checkboxes/docs, verify Preview, run
non-TEST targeted checks, perform Janitor inventory and close after `CLOSE_APPROVED`.

If medium/large code is missing, return it to Sol TRIAGE. Never turn Closure Sweep into a second
Terra build.

Return:

```text
CLOSURE_SWEEP_TARGET:
CLOSEABILITY_SCORE:
MISSING_GATES:
COMPLETED_THIS_SWEEP:
AUDIT_READY:
RESULT: ADVANCED | CLOSED | PARKED | EMPTY_WITH_SCAN
NEXT_SAFE_ACTION:
```

## PR lifecycle / Janitor

Preserve both metadata blocks in Agent-origin PRs:

```text
<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 59,72
-->
```

and the lane fields from `.github/pull_request_template.md`.

Janitor rules:

1. Each Issue gets at most one lifecycle `ACTIVE` candidate and one short-lived `VALIDATION` PR,
   while the whole repo still obeys the global one-Terra and two-candidate caps.
2. Creating, synchronizing or rebuilding a candidate, advancing `main`, entering AUDIT or reaching a
   `/goal` checkpoint triggers a Janitor sweep.
3. Luna performs mechanical inventory, Issue grouping, ancestry/changed-file checks and stale
   closeout. Sol is used only for unique code, migration, security or canonical-candidate ambiguity.
4. Auto-close requires explicit `supersedes`, same Issue and proven commit ancestry. Diverged,
   cherry-picked or squashed histories fail closed to `JANITOR_REVIEW`.
5. Superseded history remains in closed PRs, comments and commits. Do not rerun retired CI.
6. `npm run agent:pr-janitor -- --dry-run` performs inventory when shell access exists; GitHub uses
   trusted default-branch code with `--apply`.
7. Janitor must not use the superseded multi-Terra proposal to close a PR that follows the latest
   global WIP Owner decision.

## Compact handoff

Send only:

```text
RUN_CONTROL:
ISSUE:
ISSUE_ORIGIN:
STAGE:
AGENT_LANE:
LANE_STATE:
BASE / HEAD:
ACTIVE_PR:
PR_LIFECYCLE:
GOAL:
REQUIRED_DOCS:
SCOPE:
CHANGED:
ACCEPTANCE_EVIDENCE:
LATEST_ERROR:
TEST_RESULT:
CURRENT_TEST_LANE:
CLOSEABILITY_SCORE:
CLOSURE_SWEEP_TARGET:
RISK:
UNPROVEN:
NEXT_SAFE_ACTION:
CREATED_ISSUES:
REQUESTED_DECISION:
REQUESTED_MODEL / ACTUAL_MODEL:
```

Do not send full conversation history, full repository scans or complete CI logs. Include only the
failed step, suite, case, error code and enough surrounding lines to classify the failure.

## CI routing

- Clear type, compile, single-test or reproducible runtime bug: Terra fixes it.
- Inconsistent results, broad unrelated failures, many 401/403 responses, schema cache, shared TEST
  collisions, concurrency, Auth/DB/permission uncertainty, assertion or timeout changes: Sol first.
- Allowed classifications: `CODE`, `TEST`, `ENVIRONMENT`, `UNKNOWN`.
- Never rewrite `UNKNOWN` as `ENVIRONMENT`.
- Never rerun the same exact head, environment and command without a verified changed condition.
- CI from a superseded or parked candidate is historical evidence only and must not be rerun.

## PR lane metadata

Agent-origin PRs must preserve:

```text
WORK_ORIGIN
AGENT_LANE
LANE_STATE
ACTIVE_CANDIDATE
CLOSEABILITY_SCORE
SELECTION_REASON
REMAINING_AUTONOMOUS_STEPS
OWNER_OR_EXTERNAL_BLOCKER
CLOSURE_SWEEP_TARGET
TEST_LANE_REQUIRED
WHY_NOT_CLOSER_CANDIDATE
REQUESTED_MODEL / ACTUAL_MODEL
```

A metadata or WIP violation means park the newer lane and return to the existing active candidate.
The Hook validates observable metadata only; it cannot prove actual delegated model use.

## Scope firewall and Issue provenance

A new blocking Issue is allowed only for:

1. a claimed feature with no real side effect or persistence;
2. security, cross-tenant, data-loss, payment, refund, permission or real-notification risk;
3. an acceptance item already required by the parent Issue or canonical spec.

Cosmetic work, future ideas, optional refactors and non-blocking performance improvements go to
backlog and cannot block the current goal.

When an agent opens an Issue, use `.github/ISSUE_TEMPLATE/agent-discovered.yml` or preserve:

```text
ISSUE_ORIGIN: AGENT_DISCOVERED
PARENT_ISSUE / PR:
DISCOVERED_STAGE:
SCOPE_FIREWALL_REASON:
WHY_SEPARATE_FROM_PARENT:
BLOCKS_CURRENT_GOAL:
EVIDENCE:
REQUESTED_MODEL / ACTUAL_MODEL:
```

Only marked Issues count as Agent-created. Missing-marker or historical Issues are
`owner-or-unknown`.

## Verdicts

Sol returns exactly one primary verdict:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna or the main agent performs mechanical GitHub closeout after `CLOSE_APPROVED`.

## Continue and efficiency audit

A progress update, CI wait, agent wait, commit, PR creation, PR cleanup, Owner model switch or one
completed Issue is not a stop. Continue safe work until `docs/AGENT-EXECUTION.md` §10 is satisfied.

When platform token data is unavailable, do not invent percentages. Report:

```text
owner_control_events
agent_premature_stops
active_terra_peak
active_candidate_peak
closure_sweeps
sol_contacts
full_ci_runs
invalid_reruns
agent_created_blocking_issues
owner_or_unknown_issues_created
closed_issues
```
