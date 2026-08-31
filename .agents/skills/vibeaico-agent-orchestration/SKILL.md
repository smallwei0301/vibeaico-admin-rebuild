---
name: vibeaico-agent-orchestration
description: "Use for long-running /goal, model switch, open-Issue reduction, multi-agent delegation, PR lifecycle cleanup, WIP control, CI failure classification, high-risk review, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Enforces Mode C: one Terra owner per Issue with cross-Issue parallel builds, one repo-wide Luna closure sweep, one serialized shared TEST lane, close-first TRIAGE, Sol gates, and fail-closed PR Janitor rules."
metadata:
  author: smallwei0301
  version: "0.4.0"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. Canonical policy is:

1. `origin/main:docs/decisions/2026-08-31-owner-multi-terra-test-serial.md`
2. `origin/main:docs/AGENT-EXECUTION.md`
3. `origin/main:docs/PR-LIFECYCLE.md`

`docs/decisions/2026-08-31-owner-global-wip-cap.md` is historical. Its repo-wide one-Terra and
repo-wide two-candidate limits are superseded by Mode C.

If this skill conflicts with the newer canonical policy, the newer higher-priority file wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, the three canonical files above,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only relevant `docs/AGENT-PLAYBOOK.md` entries.
3. Read live open Issues, PRs, exact heads, CI and current shared TEST holder/queue. Old chat is only a clue.
4. Run PR lifecycle inventory, group candidates by Issue, and classify file/scope collision before BUILD.
5. Continue from current stage. Do not reset a usable branch, PR, migration or test checkpoint.

## Owner control signals

```text
OWNER_MODEL_SWITCH    Owner re-sent /goal to change model speed, depth or role
OWNER_STEER           Owner changed constraints, authorization or direction
OWNER_CONTINUE        Owner manually continued the same work
AGENT_PREMATURE_STOP  Assistant terminated while safe autonomous work still existed
UNKNOWN_CONTROL_EVENT Evidence is insufficient
```

Owner `/goal`, `/steer` or `continue` alone is not proof of a Stop Guard failure. Preserve branch,
PR, exact head, TEST lane and stage across model switches. Reconstruct missing context from live GitHub
and a compact checkpoint, not the full old conversation.

## Router

```text
SCOUT      Luna   facts, inventory, dependencies, CI snippets
TRIAGE     Sol    choose a safe parallel Issue set, order, risk, file/scope collisions, gates
BUILD      Terra  one owner per active medium/large Issue; different Issues may build in parallel
DIAGNOSE   Terra  deterministic code failure for that Issue
DIAGNOSE   Sol    ambiguous CI, shared TEST environment, Auth/DB/security, cross-Issue collision
AUDIT      Sol    high-risk review and CLOSE verdict per Issue
CLOSEOUT   Luna   evidence, docs, PR/Issue updates, close action
JANITOR    Luna   repo-wide PR inventory, ancestry checks and stale closeout
```

`JANITOR` is cross-cutting and belongs to the single repo-wide Luna Closure lane. It is not a product
BUILD stage.

## Mode C WIP gates

```text
TERRA_BUILD      max 1 active implementation owner PER ISSUE; different Issues may run in parallel
LUNA_CLOSURE     max 1 repo-wide closure sweep, or explicit EMPTY_WITH_SCAN
TEST_VALIDATION  max 1 repo-wide shared TEST mutation/integration lane
ACTIVE_CANDIDATE max 2 PER ISSUE: 1 ACTIVE implementation + optional short VALIDATION/canary
```

Rules:

- Do not block a second Terra merely because another Issue already has an active Terra.
- Never assign two active Terra owners to the same Issue.
- If multiple Issues heavily overlap the same core files or Auth/payment callback/migration baseline/
  shared RPC ownership, Sol splits scope or sets integration order. This is collision management, not
  a return to repo-wide one-Terra.
- Keep at most one repo-wide Closure Sweep. If no closeable target exists, report `EMPTY_WITH_SCAN`.
- Shared TEST is always single-lane. While it is occupied, other Terra agents continue source, unit,
  typecheck, build and non-shared-TEST checks, then queue their exact head.
- Park only stale, historical, owner-gated, superseded, same-Issue duplicate or otherwise explicitly
  non-active work. Do not park an unrelated Issue solely because another Terra exists.

## Close-first TRIAGE

Score each candidate before assigning its Issue Terra:

```text
5  final branch already contains the work; only evidence/checkbox/close remains
4  one small autonomous step remains
3  existing PR and most tests; at most two autonomous steps remain before AUDIT
2  substantial implementation or multi-round lifecycle verification remains
1  primarily Owner/external/Production blocked or depends on multiple large Issues
0  stale, duplicate, superseded or not an active candidate
```

Priority per Issue:

1. scores 5, 4, 3 with no Owner/external blocker;
2. a necessary dependency unlocker;
3. P0 runtime, security or data-loss work;
4. other work.

Sol may select multiple Issues in one TRIAGE cycle when their scopes are sufficiently independent.
For each selected Issue return its own block:

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

## Repo-wide Luna Closure Sweep

Scan open PR-linked Issues, recent commit/CI Issues and prior score 3+ candidates. Check at most five
before expanding. Luna may collect evidence, update checkboxes/docs, verify Preview, run non-TEST
targeted checks, perform Janitor inventory and close after `CLOSE_APPROVED`.

If medium/large code is missing, return that Issue to Sol TRIAGE for its own Terra lane. This does not
cancel unrelated Terra lanes.

```text
CLOSURE_SWEEP_TARGET:
CLOSEABILITY_SCORE:
MISSING_GATES:
COMPLETED_THIS_SWEEP:
AUDIT_READY:
RESULT: ADVANCED | CLOSED | PARKED | EMPTY_WITH_SCAN
NEXT_SAFE_ACTION:
```

## Shared TEST queue

All TEST mutations and stateful integration/E2E share one holder:

1. Record holder Issue, PR, exact head and migration baseline.
2. Only holder may run migration/reset/seed/schema-cache mutation/integration/E2E against shared TEST.
3. GitHub Actions must use `shared-test-supabase-integration` with `cancel-in-progress: false`.
4. Other Terra lanes keep building source and stop only at the TEST gate.
5. When holder releases, TRIAGE selects the next queued exact head after rechecking migration history.
6. Never manufacture a no-op commit or duplicate workflow run to jump the queue.

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

1. Each Issue gets at most one lifecycle `ACTIVE` implementation candidate and one short-lived
   `VALIDATION` PR. There is no repo-wide active-candidate count cap.
2. Creating, synchronizing or rebuilding a candidate, advancing `main`, entering AUDIT or reaching a
   `/goal` checkpoint triggers a Janitor sweep.
3. Luna performs mechanical inventory, Issue grouping, ancestry/changed-file checks and stale closeout.
   Sol is used only for unique code, migration, security or canonical-candidate ambiguity.
4. Auto-close requires explicit `supersedes`, same Issue, same repo and proven ancestry, plus source
   and target state/head revalidation immediately before mutation.
5. Diverged, cherry-picked or squashed histories fail closed to `JANITOR_REVIEW` unless patch coverage
   is manually proven.
6. Superseded history remains in closed PRs, comments and commits. Do not rerun retired CI.
7. Janitor must never close a valid Terra PR because a DIFFERENT Issue also has an active Terra.

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

- Clear type, compile, single-test or reproducible runtime bug: that Issue's Terra fixes it.
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

An active `TERRA_BUILD` must also declare a numeric primary Issue in the lifecycle block. A WIP
violation means resolve the same-Issue/shared-TEST/Closure/per-Issue candidate conflict. It does NOT
mean park a valid unrelated Terra lane.

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

Only marked Issues count as Agent-created. Missing-marker or historical Issues are `owner-or-unknown`.

## Verdicts

Sol returns exactly one primary verdict per Issue:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna or the main agent performs mechanical GitHub closeout after `CLOSE_APPROVED`.

## Continue and efficiency audit

A progress update, CI wait, TEST wait, agent wait, commit, PR creation, PR cleanup, Owner model switch
or one completed Issue is not a stop. Continue safe work across other Issue lanes until
`docs/AGENT-EXECUTION.md` §10 is satisfied.

When platform token data is unavailable, do not invent percentages. Report:

```text
owner_control_events
agent_premature_stops
active_terra_peak
active_terra_issue_count
same_issue_multi_terra_violations
shared_test_peak
shared_test_collisions
closure_sweeps
sol_contacts
full_ci_runs
invalid_reruns
agent_created_blocking_issues
owner_or_unknown_issues_created
closed_issues
```
