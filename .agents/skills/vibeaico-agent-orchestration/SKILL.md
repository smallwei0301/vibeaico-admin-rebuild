---
name: vibeaico-agent-orchestration
description: "Use for /goal, 開始 Loop, 繼續 Loop, continued autonomous delivery, model governance, Product delivery, model switches, open-Issue reduction, multi-Agent delegation, B+ WIP control, shared TEST scheduling, CI classification, PR cleanup, scorecard generation, or Issue closeout in smallwei0301/vibeaico-admin-rebuild. First classifies every new Issue/PR into MODEL_GOVERNANCE or PRODUCT_MAINLINE. MODEL_GOVERNANCE is Sol-only with no Terra and no Astra/Fable Final Risk; PRODUCT_MAINLINE keeps the B+ delivery topology and risk routing."
metadata:
  author: smallwei0301
  version: "0.8.0"
---

# VibeAI.co Agent Orchestration

Canonical policy order:

1. `origin/main:docs/decisions/2026-09-07-owner-governance-alignment.md`
2. `origin/main:docs/decisions/2026-09-01-owner-bplus-delivery-loop.md`
3. `origin/main:docs/decisions/2026-09-01-owner-natural-loop-commands-and-completion-truth.md`
4. `origin/main:docs/AGENT-EXECUTION.md`
5. `origin/main:docs/AGENT-BPLUS-DELIVERY-LOOP.md`
6. `origin/main:docs/AGENT-PROJECT-COMMANDS-AND-TRUTH.md`
7. `origin/main:docs/PR-LIFECYCLE.md`
8. `origin/main:scripts/agents/model-routing.json`

The 2026-09-10 workstream decision wins on model-governance execution: MODEL_GOVERNANCE is Sol-only and does not use Terra or Astra/Fable Final Risk. Product B+ topology still applies to PRODUCT_MAINLINE.

## Two workstreams are mandatory

Every newly created Issue and PR must carry exactly one machine-readable line:

```text
WORKSTREAM: MODEL_GOVERNANCE
```

or

```text
WORKSTREAM: PRODUCT_MAINLINE
```

Classify before creating the Issue/PR, not after implementation starts.

### MODEL_GOVERNANCE

Use for model routing, Agent orchestration, WIP / Final Risk guard behavior, governance metrics/scoreboards, PR lifecycle, governance-only CI policy, governance templates and related durable policy docs.

Execution contract:

```text
WORKSTREAM: MODEL_GOVERNANCE
AGENT_LANE: GOVERNANCE
REQUESTED_MODEL / ACTUAL_MODEL: requested=gpt-5.6-sol; actual=gpt-5.6-sol
ASTRA_RISK: NONE
FINAL_RISK_POLICY: NOT_REQUIRED_BY_OWNER_POLICY
```

- GPT-5.6 Sol chat/session performs triage, implementation, review and closeout directly.
- Do not spawn Terra or Reserve Terra for MODEL_GOVERNANCE.
- Do not dispatch Astra/Fable Final Risk for MODEL_GOVERNANCE.
- Required source CI/tests still apply. Sol must read the final diff and verify exact-head evidence before merge.
- No Product delivery-unit credit, Product Run membership, Production authorization or user-visible shipped claim is created by this workstream.
- Keep the change inside `model-routing.json.workstreams.modelGovernance.scopePrefixes`.

If a proposed MODEL_GOVERNANCE change also modifies Product runtime, schema/migrations, payment/refund, LINE/product provider behavior, tenant data flow or Production deploy behavior, split the work. If it cannot be split safely, classify the whole work as `PRODUCT_MAINLINE`. A workstream label is never a bypass for Product risk.

### PRODUCT_MAINLINE

Use for user-visible backend/frontend features, APIs, schema/migrations, tenant data flow, payment/refund, LINE behavior, Product provider integration and Product deployment behavior.

- Keep the existing B+ Product topology below.
- Product risk classification and required Final Risk remain governed by `model-routing.json`.
- Provider-specific main sessions may choose their supported builder model, but the Product PR must record requested/actual model truthfully.

### Mixed or unclear scope

Default fail-safe rule:

```text
pure governance within configured governance scope -> MODEL_GOVERNANCE
anything with Product behavior or inseparable mixed scope -> PRODUCT_MAINLINE
```

Never create an unclassified new Issue/PR. A typo, blank value or invented third workstream is invalid metadata and must be corrected before work continues.

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
2. Read the canonical files above, `AGENTS.md`, `CLAUDE.md`, `docs/OWNER-DECISIONS.md`, the Issue's canonical docs, and only directly relevant Playbook entries.
3. Read live open Issues／PRs, exact heads, CI, TEST holder and the latest 1–3 run reports.
4. Classify the target workstream before any new Issue/PR is created. Existing work keeps its live workstream; do not infer it from a stale lane label when current files show otherwise.
5. For PRODUCT_MAINLINE, resume the newest valid `IN_PROGRESS` Product Run; create a `RUN_ID` only when none exists. MODEL_GOVERNANCE does not join a Product Run merely to satisfy metadata.
6. Preserve usable branches, PRs, migrations and test checkpoints. Never reset completed work.
7. Do not report a write action as completed until the Completion Truth Gate is satisfied.

## PRODUCT_MAINLINE B+ topology

```text
MAIN_TERRA       default max 1; max 2 only when the dual-Terra Guard qualifies both complete candidates
RESERVE_TERRA    max 1 source-only preparation lane
LUNA_CLOSURE     max 1 closeout / Janitor lane
LUNA_TASKS       default 4, max 6, plus one Aggregator
TEST_VALIDATION  max 1 shared TEST holder
ACTIVE_CANDIDATE max 3
```

RESERVE is not a second delivery line. It may produce at most one atomic source-only commit, then stops at `READY_FOR_PROMOTION`.

This topology is for `PRODUCT_MAINLINE`. Do not create Terra slots for `MODEL_GOVERNANCE`.

## Router

```text
MODEL_GOVERNANCE
  SOL_GOVERNANCE     current truth -> bounded implementation -> tests -> final diff review -> closeout

PRODUCT_MAINLINE
  LUNA_TRUTH         live facts, open work, exact heads, TEST holder
  LUNA_CLOSURE       close-ready candidates and mechanical closeout
  LUNA_CI            status-change-only CI monitoring and error compression
  LUNA_JANITOR       stale/superseded PR inventory and safe retirement evidence
  LUNA_DOCS          PR body, checkboxes, metadata and handoff synchronization
  LUNA_QA            acceptance gaps, maximum three blockers
  LUNA_METRICS       run ledger and scorecard inputs
  LUNA_AGGREGATOR    deduplicate Luna results into <=30 lines
  SOL_TRIAGE         choose MAIN, optional RESERVE and Closure target
  MAIN_TERRA         build the sole complete delivery candidate
  RESERVE_TERRA      prepare one bounded source-only slice
  SOL_DIAGNOSE       only ambiguous/high-risk CI, DB/Auth/payment/security/collision
  EARLY_SOL_DIFF_AUDIT  one non-final diff check per complete Terra
  FINAL_SOL_AUDIT       final CLOSE verdict after all required tests
  LUNA_CLOSEOUT      evidence, status, Issue close, lane release, report
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

Do not copy full chat history or make multiple Luna agents scan the same inventory. One Aggregator removes duplicates before Sol reads the result.

## Conditional model routing

For `PRODUCT_MAINLINE`, at `SOL_TRIAGE`, read `origin/main:docs/MODEL-ROUTING.md` and classify Product risk. When Product classification requires Final Risk, load `origin/main:.agents/skills/vibeaico-astra-review/SKILL.md` and use an allowed reviewer model.

For `MODEL_GOVERNANCE`, do not load or dispatch the Astra/Fable Final Risk path merely because governance files changed. The Owner has selected Sol-only governance. Source CI/tests and a final Sol diff read are still mandatory.

## TRIAGE output

For MODEL_GOVERNANCE:

```text
WORKSTREAM: MODEL_GOVERNANCE
SOL_GOVERNANCE: <Issue/PR>
SCOPE:
RISK_WITHIN_SOL_REVIEW:
TESTS:
OWNER_OR_EXTERNAL_BLOCKER:
```

For PRODUCT_MAINLINE:

```text
WORKSTREAM: PRODUCT_MAINLINE
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

Prefer score 5→3 Product candidates. A lower-score dependency unlocker needs a concrete explanation.

## MAIN and RESERVE

This section applies only to PRODUCT_MAINLINE.

MAIN may use TEST, one early Sol diff audit, and final Sol Audit. A second complete Terra requires Guard proof before start: same `RUN_ID`; distinct primary Issues, slots 1/2 and `TEST_ENV_ID`; zero-overlap `FILE_OWNERSHIP`; healthy local isolated evidence; and no shared-TEST-holder conflict. It stays active until:

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

## Sol audit order

For MODEL_GOVERNANCE, Sol is the execution mode and final reviewer. Use one bounded implementation, required tests, then re-read the final exact diff and current main before merge. Do not create a ceremonial second Sol/Astra pass that repeats the same work without new evidence.

For PRODUCT_MAINLINE, after Terra has a reviewable complete diff, Sol may perform one early diff audit to catch fake success before costly tests. It can return advice or `FIX_REQUIRED`, never `CLOSE_APPROVED`. Final order is `Terra → early audit → fixes → required local isolated → canonical TEST when required → final Sol audit on the final exact head → merge／Issue close → Completion Truth`. A changed head requires a new final diff read.

## Shared TEST

Only one active `TEST_VALIDATION` Product PR may use TEST secrets, migration/reset/seed/schema-cache mutation, integration or E2E. Non-holder runtime PRs run source checks and record a successful `POLICY_SKIP`.
A lane transition must match exact PR, branch and SHA. No no-op commits and no unchanged reruns.

MODEL_GOVERNANCE must remain source/governance-only and must not occupy the Product shared TEST lane unless the work has been reclassified to PRODUCT_MAINLINE.

## Sol budget

Normal PRODUCT_MAINLINE Issue:

```text
TRIAGE 1
AUDIT  1
```

One additional Sol DIAGNOSE is allowed only for DB/Auth/payment/security, shared TEST ambiguity, cross-suite inconsistency or core ownership collision. Sol does not poll CI or move documents.

MODEL_GOVERNANCE is intentionally a Sol conversation/session mode. Do not count its implementation as Terra usage and do not manufacture Astra/Fable usage.

## Completion Truth Gate

A successful tool invocation means only `REQUESTED`, not `COMPLETED`.

Before saying a PR was merged:

1. fetch the PR after the merge action;
2. verify `merged=true` or `merged_at` and record `merge_commit_sha`;
3. fetch current default-branch head;
4. compare the merge commit to default branch and require `ahead` or `identical`;
5. re-read at least one changed file with `ref=main`;
6. record exact-head CI and verification time.

Until then use `MERGE_REQUESTED_UNVERIFIED`. Apply the same pattern to Issue close, CI green, migration applied, deployment, and files claimed to be on main.

A completion claim that conflicts with live state is `AUDIT_DATA_INVALID`, increments `quality.safetyViolations`, adds a `hardFailReasons` entry, and makes the run `F-HARD`.

## Closeout and report

PRODUCT_MAINLINE loops update:

```text
docs/metrics/agent-runs/<RUN_ID>.json
docs/metrics/agent-runs/<RUN_ID>.md
```

Run:

```text
node scripts/agents/run-ledger-v2.mjs validate <json>
node scripts/agents/score-run-v2.mjs <json> --output <md>
node scripts/agents/review-runs-v2.mjs docs/metrics/agent-runs
```

New Product operational Runs must be schema v2 with `deliveryTruthVersion: 4`, created through `run-ledger-v2.mjs init --closeout-owner ...`. A final v4 Run is closed only when the script validates its closeout envelope; schema v1 and historical DeliveryTruth v2/v3 ledgers remain read-only and are never rewritten. `CLOSED` means Issue close only: count a shipped unit only after all five production stages, including authenticated production acceptance.

MODEL_GOVERNANCE may keep bounded governance evidence, but does not fabricate Product Run membership or shipped Product units.

Record actual token data when available. Otherwise keep it `null`; never infer model execution from lane names. `actualModel=unknown` must remain visible when the runtime cannot prove it.

## Automatic adjustment

These throughput rules apply to PRODUCT_MAINLINE only:

- Luna adoption >=85%, duplicate rate <=10%, quality >=25/30: next run may add one Luna, max 6.
- Luna adoption <70% or duplicate rate >15%: remove one Luna and narrow tasks.
- Usage rises >20% without more Delivery Units: disable RESERVE and limit review to one Agent.
- Quality <24/30: stop RESERVE code work and strengthen MAIN targeted tests.
- Two runs without CLOSED or complete OWNER_BLOCKED: enter `CLOSURE_RECOVERY`.

MODEL_GOVERNANCE does not spawn Terra merely to improve utilization metrics.

## Verdicts

For Product closeout, Sol returns exactly one:

```text
CLOSE_APPROVED
FIX_REQUIRED
OWNER_BLOCKED
```

Luna or the main Agent performs mechanical close only after `CLOSE_APPROVED`, then re-fetches the Issue to verify `state=closed` before reporting it closed.

For MODEL_GOVERNANCE, the Sol session may perform the mechanical close itself after exact-head tests and final diff verification because it is both the designated execution mode and governance owner for this workstream.

## Continue rule

A progress update, CI wait, TEST wait, model switch, commit, PR, one completed Issue or one blocked Issue is not a global stop. Continue the relevant workstream until its canonical stop conditions are met.

Never let MODEL_GOVERNANCE consume Product Terra slots, and never let PRODUCT_MAINLINE hide inside MODEL_GOVERNANCE to avoid Product risk controls.
