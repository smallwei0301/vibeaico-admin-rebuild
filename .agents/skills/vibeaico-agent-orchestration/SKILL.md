---
name: vibeaico-agent-orchestration
description: "Use for any long-running /goal, continue-from-current-state request, open-Issue reduction, multi-agent delegation, CI failure classification, high-risk design review, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. Routes SCOUT/TRIAGE/BUILD/DIAGNOSE/AUDIT/CLOSEOUT to Luna/Sol/Terra according to docs/AGENT-EXECUTION.md."
metadata:
  author: smallwei0301
  version: "0.1.0"
---

# VibeAI.co Agent Orchestration

This skill is a thin execution adapter. The canonical policy is
`origin/main:docs/AGENT-EXECUTION.md`. If this skill conflicts with that file, the canonical
policy wins.

## Start

1. Fetch latest `origin/main`.
2. Read `AGENTS.md`, `CLAUDE.md`, `docs/AGENT-EXECUTION.md`,
   `docs/DOCUMENTATION-GOVERNANCE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs,
   and only the relevant `docs/AGENT-PLAYBOOK.md` entries.
3. Read live open Issues, PRs, branches, exact heads and CI. Old chat state is only a clue.
4. Identify the current stage and continue from it. Do not reset an existing usable branch or PR.

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

A progress update, agent wait, CI wait, commit, PR creation or one completed Issue is not a stop.
Continue unrelated safe work until `docs/AGENT-EXECUTION.md` §10 is satisfied.
