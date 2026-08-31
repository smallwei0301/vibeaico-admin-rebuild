---
name: vibeaico-agent-orchestration
description: "Use for any long-running /goal, continue-from-current-state request, open-Issue reduction, multi-agent delegation, PR lifecycle cleanup, CI failure classification, high-risk design review, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Routes SCOUT/TRIAGE/BUILD/DIAGNOSE/AUDIT/CLOSEOUT to Luna/Sol/Terra and runs the fail-closed PR Janitor contract."
metadata:
  author: smallwei0301
  version: "0.2.0"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. The canonical policy is
`origin/main:docs/AGENT-EXECUTION.md`. PR lifecycle mechanics are defined by
`origin/main:docs/PR-LIFECYCLE.md`. If this skill conflicts with the canonical execution policy,
the canonical policy wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-EXECUTION.md`, `docs/PR-LIFECYCLE.md`,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only the relevant `docs/AGENT-PLAYBOOK.md` entries.
3. Read live open Issues, PRs, branches, exact heads and CI. Old chat state is only a clue.
4. Run a PR lifecycle inventory before assigning BUILD work. Group open PRs by primary Issue and
   identify `ACTIVE`, `VALIDATION`, `REBUILD_REQUIRED`, `OWNER_GATED`, and possible stale PRs.
5. Identify the current stage and continue from it. Do not reset an existing usable branch or PR.

## Router

```text
SCOUT      Luna   facts, inventory, dependencies, CI snippets
TRIAGE     Sol    next Issue, order, risk, acceptance gates
BUILD      Terra  one medium/large Issue end to end
DIAGNOSE   Terra  deterministic code failure
DIAGNOSE   Sol    ambiguous CI, TEST environment, Auth/DB/security
AUDIT      Sol    high-risk review and CLOSE verdict
CLOSEOUT   Luna   evidence, docs, PR/Issue updates, close action
JANITOR    Luna   cross-cutting PR inventory, ancestry checks, stale closeout
```

`JANITOR` is cross-cutting, not a seventh product stage. It runs alongside BUILD and whenever the
PR lifecycle triggers in `docs/PR-LIFECYCLE.md` fire.

Hard gates:

- Terra cannot change acceptance criteria or decide to close an Issue.
- Luna cannot make product, payment, permission, security or close decisions.
- An Issue closes only after Sol returns `CLOSE_APPROVED`.
- Sol is normally called twice per Issue: TRIAGE and AUDIT. Add DIAGNOSE only for ambiguous or
  high-risk evidence.
- Use one Terra per medium/large Issue. Never ask multiple Terra agents to reread and compete on
  the same scope.
- Different Issues may have different Terra agents in parallel.
- Shared TEST migration/reset/seed/integration/E2E stays serialized even while source work runs in
  parallel.

## PR lifecycle / Janitor

When creating or rebuilding a candidate PR, preserve the machine-readable block:

```text
<!-- pr-lifecycle
issue: 40
state: ACTIVE
supersedes: 59,72
-->
```

Rules:

1. One Issue gets at most one `ACTIVE` implementation candidate plus one short-lived `VALIDATION`
   PR.
2. Creating a new candidate, synchronizing/rebuilding one, advancing `main`, entering AUDIT, or
   reaching a `/goal` checkpoint triggers a Janitor sweep.
3. Luna performs mechanical inventory, issue grouping, ancestry/changed-file checks and stale
   closeout. Sol is used only when unique code, migration, security or canonical-candidate ambiguity
   remains.
4. A PR explicitly listed in `supersedes` may be auto-closed only when the repository Janitor can
   prove same-Issue commit ancestry. Diverged/cherry-picked/squashed histories fail closed to
   `JANITOR_REVIEW`.
5. Superseded PR history remains in the closed PR, comments and commits. Do not keep it open merely
   to preserve evidence, and do not rerun CI for a retired candidate.
6. Use `npm run agent:pr-janitor -- --dry-run` for an inventory when shell access is available. The
   GitHub workflow runs the same script with `--apply` from trusted default-branch code.

## Compact handoff

Send only:

```text
ISSUE:
STAGE:
BASE / HEAD:
GOAL:
REQUIRED_DOCS:
SCOPE:
CHANGED:
ACCEPTANCE_EVIDENCE:
LATEST_ERROR:
TEST_RESULT:
RISK:
UNPROVEN:
REQUESTED_DECISION:
REQUESTED_MODEL / ACTUAL_MODEL:
PR_LIFECYCLE:
```

Do not send full conversation history, full repository scans, or complete CI logs. Include the
failed step, suite, case, error code and only enough surrounding lines to classify the failure.

`PR_LIFECYCLE` should contain the primary Issue, current candidate PR, lifecycle state and any
superseded candidates that still require mechanical closeout.

## CI routing

- Clear type, compile, single-test or reproducible runtime bug: Terra fixes it.
- Inconsistent results, broad unrelated failures, many 401/403 responses, schema cache,
  shared TEST collisions, concurrency, Auth/DB/permission uncertainty, assertion changes or
  timeout changes: Sol classifies first.
- Allowed classifications: `CODE`, `TEST`, `ENVIRONMENT`, `UNKNOWN`.
- Never rewrite `UNKNOWN` as `ENVIRONMENT`.
- Never rerun the same exact head, environment and command without a verified changed condition.
- CI from a `SUPERSEDED` candidate is historical evidence only and must not be rerun to unblock the
  current candidate.

## Scope firewall

A new blocking Issue is allowed only for:

1. a claimed feature with no real side effect or persistence;
2. security, cross-tenant, data-loss, payment, refund, permission or real-notification risk;
3. an acceptance item already required by the current Issue or canonical spec.

Cosmetic work, future ideas, optional refactors and non-blocking performance improvements go to
backlog and cannot block the current goal.

## Verdicts

Sol must return exactly one primary verdict:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

The verdict includes missing evidence or the smallest next action. Luna or the main agent performs
the mechanical GitHub closeout after `CLOSE_APPROVED`.

## Continue rule

A progress update, agent wait, CI wait, commit, PR creation, PR cleanup, or one completed Issue is
not a stop. Continue unrelated safe work until `docs/AGENT-EXECUTION.md` §10 is satisfied.
