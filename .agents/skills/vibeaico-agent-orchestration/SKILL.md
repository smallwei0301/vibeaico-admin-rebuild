---
name: vibeaico-agent-orchestration
description: "Use for any long-running /goal, continue-from-current-state request, open-Issue reduction, multi-agent delegation, CI failure classification, high-risk review, model switch, WIP control, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Enforces one active Terra build, one Luna closure sweep, one shared TEST lane, close-first TRIAGE, and Sol gates according to docs/AGENT-EXECUTION.md."
metadata:
  author: smallwei0301
  version: "0.3.0"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. The canonical policy is
`origin/main:docs/AGENT-EXECUTION.md`. If this skill conflicts with that file, the latest canonical
policy wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-EXECUTION.md`,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only relevant `docs/AGENT-PLAYBOOK.md` entries.
3. For `/goal`, model switches, WIP review, Issue origin or efficiency analysis, also read
   `docs/decisions/2026-08-31-agent-control-wip-and-close-first.md`.
4. Read live open Issues, PRs, exact heads, CI and current TEST lane. Old chat is only a clue.
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

- Owner `/goal`, `/steer` or `continue` alone is not proof of a Stop Guard failure.
- Record `AGENT_PREMATURE_STOP` only with the prior assistant's terminating behavior and evidence
  that executable work still existed at that moment.
- After a model switch, preserve branch, PR, exact head, TEST lane and stage. Reconstruct missing
  context from live GitHub and a compact checkpoint, not the full old conversation.

## Router

```text
SCOUT      Luna   facts, inventory, dependencies, CI snippets
TRIAGE     Sol    close-first selection, order, risk, acceptance gates
BUILD      Terra  the single active medium/large Issue end to end
DIAGNOSE   Terra  deterministic code failure
DIAGNOSE   Sol    ambiguous CI, TEST environment, Auth/DB/security
AUDIT      Sol    high-risk review and CLOSE verdict
CLOSEOUT   Luna   evidence, docs, PR/Issue updates, close action
```

## Global WIP gates

A long-running goal may have only:

```text
TERRA_BUILD      max 1 active medium/large implementation
LUNA_CLOSURE     exactly 1 closure sweep
TEST_VALIDATION  max 1 shared TEST mutation/integration lane
ACTIVE_CANDIDATE max 2 PRs total
```

Rules:

- If an active Terra build exists, do not start a second medium/large implementation branch or PR.
- Keep exactly one closure sweep. If no closeable target exists, report `EMPTY_WITH_SCAN` and the
  checked candidates.
- Other open PRs are `PARKED`, `HISTORICAL` or `OWNER_BLOCKED`. Do not push, rerun or poll them.
- TEST work uses the shared serialized lane. While it is occupied, continue Closure Sweep, docs,
  review or targeted checks that do not touch TEST.
- A newer lane that violates the cap must be parked before more work, not justified afterward.

## Close-first TRIAGE

Score candidates before opening a new Terra lane:

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
3. a P0 runtime, security or data-loss issue;
4. other work.

If Sol chooses a score below 3 while a score 3+ candidate exists, it must provide
`WHY_NOT_CLOSER_CANDIDATE` or choose the closer candidate instead.

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

Scan only open PR-linked Issues, recent commit/CI Issues, prior score 3+ candidates, and at most five
candidates before expanding. Luna may collect evidence, update checkboxes/docs, verify Preview, run
non-TEST targeted checks, and close after `CLOSE_APPROVED`.

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

## PR lane metadata

Agent-origin PRs must preserve the fields in `.github/pull_request_template.md`:

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
```

The WIP hook is an observable guard, not proof of actual model use. A metadata or WIP violation means
park the newer lane and return to the existing active candidate.

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

Only marked Issues count as agent-created. Missing-marker or historical Issues are
`owner-or-unknown`.

## Verdicts

Sol returns exactly one primary verdict:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna or the main agent performs the mechanical GitHub closeout after `CLOSE_APPROVED`.

## Continue and efficiency audit

A progress update, CI wait, agent wait, commit, PR creation, Owner model switch or one completed Issue
is not a stop. Continue safe work until `docs/AGENT-EXECUTION.md` §10 is satisfied.

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
