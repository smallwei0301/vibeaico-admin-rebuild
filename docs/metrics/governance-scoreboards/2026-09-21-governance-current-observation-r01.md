# Governance Scoreboard Current Observation

- Repo: `smallwei0301/vibeaico-admin-rebuild`
- Window: `2026-09-20T22:53:19Z` → `2026-09-21T10:53:19Z`
- Current main at capture: `2faed45a5269fe808eaefe66deef9e51e9536172`
- Collector source: `scripts/metrics/governance-observation.mjs` at `2faed45a5269fe808eaefe66deef9e51e9536172`
- Collection method: exact GitHub PR-detail, Actions `head_sha`, and commit-status replay using the current collector contract.
- Comparison eligible (current-observation data completeness): **YES**
- Governance PRs: 6 total / 5 merged / 0 open
- Open inventory: active 0, parked 0, owner-blocked 0, unknown 0
- Merged PR cycle-time median: 6.2 min (n=5)
- Workstream body/label mismatch: 0
- Governance scope-budget violations: 0
- Stale terminal lifecycle metadata: 4 (unknown 2)

## CI observation

- final-head CI attempts: 5
- redundant same-head reruns: 0
- first-pass CI: 5/5 (100%)
- metadata gate failure→success recovery: 2

## Unavailable metrics

- none

## Included PR subjects

#624, #626, #629, #632, #633, #636

## Interpretation and boundaries

- This is the current-observation layer of the existing Governance Scoreboard, not a new 0–100 score.
- Formal historical Governance trend remains **NOT_GRADED**: this snapshot does not create a terminal Governance Run or rewrite the 2026-09-09 historical scoreboard.
- Stale and unknown lifecycle values are observation signals. They are not permission to rewrite historical PR evidence or infer missing lifecycle events.
- PR #636 is included as the latest governance reconciliation for the live Product Run evidence. Its merge and the resulting main SHA do not close #528, prove Product completion truth, or prove TEST/Production acceptance.
- Product delivery outcome, TEST/Production database state, deployment, payment, notification, provider model identity, and model-utilization metrics are outside this scoreboard.
- #104 remains parked until three terminal, truth-verified, rebuildable and comparable Product Runs exist; #359 remains optional and nonblocking.
- The window uses the collector's repository PR search plus exact timestamp filtering. It is not a permanent all-history no-error guarantee.

> Current-observation layer of the existing Governance Scoreboard. It does not replace historical v1/v2 replay or blocking-finding reconciliation.
