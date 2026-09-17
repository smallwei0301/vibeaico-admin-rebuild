# Governance Scoreboard Current Observation

- Repo: `smallwei0301/vibeaico-admin-rebuild`
- Window: `2026-09-16T20:11:11Z` → `2026-09-17T08:11:11Z`
- Current main at capture: `d3b6dcfcaf4434e3119f84c4608fe1a38df002d2`
- Collector source: `scripts/metrics/governance-observation.mjs` at `d3b6dcfcaf4434e3119f84c4608fe1a38df002d2`
- Collection method: exact GitHub PR-detail, Actions `head_sha`, and commit-status replay using the current collector contract.
- Comparison eligible (current-observation data completeness): **YES**
- Governance PRs: 43 total / 42 merged / 0 open
- Open inventory: active 0, parked 0, owner-blocked 0, unknown 0
- Merged PR cycle-time median: 7 min (n=42)
- Workstream body/label mismatch: 0
- Governance scope-budget violations: 1
- Stale terminal lifecycle metadata: 20 (unknown 8)

## CI observation

- final-head CI attempts: 43
- redundant same-head reruns: 0
- first-pass CI: 43/43 (100%)
- metadata gate failure→success recovery: 10

## Unavailable metrics

- none

## Included PR subjects

#435, #436, #437, #441, #444, #445, #451, #452, #453, #457, #458, #459, #461, #463, #465, #480, #481, #483, #484, #486, #504, #516, #523, #527, #529, #537, #541, #542, #543, #544, #546, #548, #553, #554, #557, #559, #560, #564, #566, #570, #576, #577, #578

## Interpretation and boundaries

- This is the existing Governance Scoreboard current-observation layer, not a third 0–100 score.
- Formal historical Governance trend remains **NOT_GRADED**: this snapshot does not create a terminal v2 Governance Run or change the read-only 2026-09-09 history.
- The `HISTORICAL` lifecycle state is recognized as terminal after #578; the remaining stale/unknown values are observation signals in this window, not permission to rewrite historical PR evidence.
- Product delivery outcome, TEST/Production database state, deployment, payment, notification, provider model identity, and model-utilization metrics are outside this scoreboard.
- Unknown provider evidence would remain `null` and appear in `unavailable metrics`; none was unavailable in this capture.
- The window uses the collector's repository PR search plus exact timestamp filtering. It is not a permanent all-history no-error guarantee.

> Current-observation layer of the existing Governance Scoreboard. It does not replace historical v1/v2 replay or blocking-finding reconciliation.
