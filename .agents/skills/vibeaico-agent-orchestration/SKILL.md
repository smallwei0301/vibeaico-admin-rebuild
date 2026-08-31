---
name: vibeaico-agent-orchestration
description: "Use for any long-running /goal, continue-from-current-state request, open-Issue reduction, multi-agent delegation, CI failure classification, high-risk design review, Issue closeout, or Agent WIP control in smallwei0301/vibeaico-admin-rebuild. Routes SCOUT/TRIAGE/BUILD/DIAGNOSE/AUDIT/CLOSEOUT to Luna/Sol/Terra and enforces close-first global lanes according to docs/AGENT-EXECUTION.md and the latest Owner Decisions."
metadata:
  author: smallwei0301
  version: "0.3.1"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. The canonical policy is
`origin/main:docs/AGENT-EXECUTION.md`, supplemented by newer Owner Decisions. If this skill
conflicts with either source, the newer higher-priority repository policy wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-EXECUTION.md`,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only the relevant `docs/AGENT-PLAYBOOK.md` entries.
3. For `/goal`, model switches, Stop Guard evaluation, efficiency analysis or Issue creation, also
   read `docs/decisions/2026-08-31-agent-control-signals-and-issue-provenance.md`.
4. For TRIAGE, multi-Agent work, new BUILD, TEST scheduling or closeout, also read
   `docs/decisions/2026-08-31-close-first-wip-lanes.md`.
5. Read live open Issues, PRs, branches, exact heads, labels and CI. Old chat state is only a clue.
6. Identify the current stage and continue from it. Do not reset an existing usable branch or PR.

## Owner control signals and continuity

Classify the incoming control before judging the previous agent:

```text
OWNER_MODEL_SWITCH   Owner re-sent /goal to change model speed, depth or role
OWNER_STEER          Owner changed constraints, authorization or direction
OWNER_CONTINUE       Owner manually asked to continue the same work
AGENT_PREMATURE_STOP Assistant ended while safe autonomous work still existed
UNKNOWN_CONTROL_EVENT Evidence is insufficient to decide
```

Rules:

- `/goal`, `/steer` or `continue` from the Owner is not, by itself, evidence that the previous agent
  stopped incorrectly.
- Record `AGENT_PREMATURE_STOP` only when the prior assistant emitted a terminating final, explicitly
  paused, or asked the Owner to restart while executable work still existed.
- If an exported chat contains only Owner messages, classify the stop evidence as unknown.
- After a model switch, preserve the live branch, PR, exact head, TEST lane and current stage. Do not
  checkout/reset or repeat completed inventory, commits, tests or migrations.
- Reconstruct missing context from live GitHub and the compact checkpoint, not by copying the full
  old conversation.

## Router

```text
SCOUT      Luna   facts, inventory, dependencies, CI snippets
TRIAGE     Sol    next Issue, order, risk, acceptance gates
BUILD      Terra  one medium/large Issue end to end
DIAGNOSE   Terra  deterministic code failure
DIAGNOSE   Sol    ambiguous CI, TEST environment, Auth/DB/security
AUDIT      Sol    high-risk review and CLOSE verdict
CLOSEOUT   Luna   evidence, docs, PR/Issue updates, close action
```

Hard gates:

- Terra cannot change acceptance criteria or decide to close an Issue.
- Luna cannot make product, payment, permission, security or close decisions.
- An Issue closes only after Sol returns `CLOSE_APPROVED`.
- Sol is normally called twice per Issue: TRIAGE and AUDIT. Add DIAGNOSE only for ambiguous or
  high-risk evidence.
- Use one Terra per medium/large Issue. Never ask multiple Terra agents to reread and compete on
  the same scope.

## Global WIP lanes

The whole repository has these limits, not one set per session:

```text
TERRA_BUILD          max 1
LUNA_CLOSURE_SWEEP   max 1
TEST_VALIDATION      max 1
ACTIVE_CANDIDATES    max 2
```

Before starting or delegating a medium/large BUILD:

1. Query open PR labels and verify `lane:terra-build` has no holder.
2. Verify there are fewer than two `candidate:active` PRs.
3. Record the current `lane:test-validation` holder.
4. Prefer an existing close-ready PR over opening a new branch.
5. Do not start an Issue that is already known to depend on Owner/external action or another
   unfinished medium/large Issue when READY or NEAR work exists.
6. Keep one Luna closure sweep running; it may inspect many items but may promote only one candidate
   at a time.

Legacy open PRs without lane metadata are parked by default. They do not become active merely because
someone reads or comments on them.

### Lane transitions

Use exactly one current lane and one candidate state in the PR body:

```text
AGENT_LANE: TERRA_BUILD | LUNA_CLOSURE_SWEEP | TEST_VALIDATION | PARKED
CANDIDATE_STATUS: ACTIVE | PARKED
CLOSEABILITY: READY | NEAR | UNBLOCKER | BUILDABLE | BLOCKED | N/A
```

The matching labels are:

```text
lane:terra-build
lane:luna-closeout
lane:test-validation
candidate:active
candidate:parked
```

Change the three PR body markers when a PR changes stage. The WIP hook synchronizes labels. When an
`edited` event moves a same-repository PR into active `TEST_VALIDATION`, the hook dispatches `ci.yml`
exactly once after confirming it is the sole TEST holder. Do not create a dummy commit or manually
dispatch CI just to enter the TEST lane. Ordinary evidence-only body edits do not trigger main CI.

A parked candidate gets no lane. `.github/workflows/agent-wip-lanes.yml` verifies these limits but
does not replace Sol TRIAGE.

## Close-first TRIAGE

Use the closeability order and required TRIAGE output defined in `docs/AGENT-EXECUTION.md`; this
adapter does not duplicate that policy. Read the current close-first Owner Decision for rationale and
examples.

## Compact handoff

Send only:

```text
RUN_CONTROL:
ISSUE:
ISSUE_ORIGIN:
STAGE:
LANE:
CLOSEABILITY:
ACTIVE_CANDIDATE_COUNT:
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
RISK:
UNPROVEN:
NEXT_SAFE_ACTION:
CREATED_ISSUES:
REQUESTED_DECISION:
REQUESTED_MODEL / ACTUAL_MODEL:
```

Do not send full conversation history, full repository scans, or complete CI logs. Include the
failed step, suite, case, error code and only enough surrounding lines to classify the failure.

## CI routing

- Clear type, compile, single-test or reproducible runtime bug: Terra fixes it.
- Inconsistent results, broad unrelated failures, many 401/403 responses, schema cache,
  shared TEST collisions, concurrency, Auth/DB/permission uncertainty, assertion changes or
  timeout changes: Sol classifies first.
- Allowed classifications: `CODE`, `TEST`, `ENVIRONMENT`, `UNKNOWN`.
- Never rewrite `UNKNOWN` as `ENVIRONMENT`.
- Never rerun the same exact head, environment and command without a verified changed condition.
- Only the sole active `TEST_VALIDATION` PR may run shared TEST migration/reset/seed/integration/E2E.
  Other runtime PRs receive source check plus an explicit successful integration policy-skip; they
  must not manually dispatch heavy TEST. Runtime `main` pushes and deliberate `workflow_dispatch`
  runs remain full validation and use the same serialized group.

## Scope firewall and Issue provenance

A new blocking Issue is allowed only for:

1. a claimed feature with no real side effect or persistence;
2. security, cross-tenant, data-loss, payment, refund, permission or real-notification risk;
3. an acceptance item already required by the current Issue or canonical spec.

Cosmetic work, future ideas, optional refactors and non-blocking performance improvements go to
backlog and cannot block the current goal.

When an agent opens a new Issue, it must use
`.github/ISSUE_TEMPLATE/agent-discovered.yml` or preserve the same fields in an API-created body:

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

Only Issues with this marker count as agent-created. Missing-marker or historical Issues are
`owner-or-unknown` and must not be charged to the agent in efficiency reports.

## Verdicts

Sol must return exactly one primary verdict:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

The verdict includes missing evidence or the smallest next action. Luna or the main agent performs
the mechanical GitHub closeout after `CLOSE_APPROVED`.

Every long-running cycle must produce at least one close verdict before starting another BUILD,
unless a documented P0/security exception requires the existing Terra lane to continue.

## Continue rule and Stop Guard

A progress update, agent wait, CI wait, commit, PR creation, Owner model switch, Owner `/goal`, Owner
`/steer`, or one completed Issue is not a stop. Continue unrelated safe work until
`docs/AGENT-EXECUTION.md` §10 is satisfied.

Before sending a terminating final, verify live:

```text
open Issues
open PRs
active or queued CI
current Terra BUILD lane
current Luna closure-sweep lane
current TEST lane
active candidate count
available non-conflicting work
Owner-only blockers
```

A repeated Owner `/goal` must never be used as proof that this check failed. The proof must come from
the prior assistant's terminating behavior and the executable work that existed at that moment.

## Efficiency audit

When real platform token data is unavailable, do not invent token percentages. Report separate
counts for:

```text
owner_control_events
agent_premature_stops
agent_created_blocking_issues
owner_or_unknown_issues_created
active_candidate_peak
terra_build_lane_violations
closure_sweep_candidates_reviewed
closure_sweep_candidates_promoted
full_ci_runs
invalid_reruns
sol_contacts
close_verdicts
closed_issues
```

Do not combine Owner control events with premature stops, or Owner-created/unknown Issues with
agent-created Issues. The target is `active_candidate_peak <= 2`, zero Terra-lane violations, zero
invalid reruns, and at least one close verdict per cycle.
