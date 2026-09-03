<!-- pr-lifecycle
issue:
state: ACTIVE
supersedes:
-->

## Summary

<!-- Explain the smallest Product or governance outcome. -->

## Delivery Unit boundary

<!-- Product PRs point lifecycle issue: at one closable SLICE／STANDALONE Issue, not a multi-outcome Epic. Governance PRs use GOVERNANCE and do not claim shipped Product output. -->

- DELIVERY_UNIT_TYPE: SLICE | STANDALONE | EPIC | GOVERNANCE
- PARENT_EPIC: none | #number
- COUNT_IN_DELIVERY_OUTCOME: true | false
- RETROACTIVE_TRACKING_MIGRATION: true | false
- USER_VISIBLE_OUTCOME: none | <!-- one concise, independently usable result -->

`EPIC`、`GOVERNANCE` and `RETROACTIVE_TRACKING_MIGRATION=true` must use
`COUNT_IN_DELIVERY_OUTCOME=false`. A parent Epic may remain open after one child Slice closes, but the
parent and already-counted child Slices must never be counted as duplicate Product output.

## B+ Agent lane metadata

<!-- Keep exact FIELD: value lines. The WIP Guard parses them. -->

- WORK_ORIGIN: OWNER | AGENT | UNKNOWN
- BPLUS_MODE: true | false
- RUN_ID: <!-- YYYY-MM-DD-name -->
- SCORECARD_PATH: none | <!-- docs/metrics/agent-runs/<RUN_ID>.json -->
- AGENT_LANE: TERRA_BUILD | TERRA_RESERVE | LUNA_CLOSURE | TEST_VALIDATION | GOVERNANCE | OWNER
- LANE_STATE: ACTIVE | READY_FOR_PROMOTION | PARKED | COMPLETE | OWNER_BLOCKED | HISTORICAL
- ACTIVE_CANDIDATE: true | false
- CLOSEABILITY_SCORE: 0 | 1 | 2 | 3 | 4 | 5
- SELECTION_REASON: CLOSE_READY | DEPENDENCY_UNLOCKER | P0_RUNTIME | P1_SOURCE_HARDENING | OWNER_DIRECTED | GOVERNANCE
- REMAINING_AUTONOMOUS_STEPS: <!-- concise list -->
- OWNER_OR_EXTERNAL_BLOCKER: none | <!-- exact blocker -->
- CLOSURE_SWEEP_TARGET: <!-- #Issue / PR #number / EMPTY_WITH_SCAN / REPORT:<path> -->
- TEST_LANE_REQUIRED: true | false
- RESERVE_BOUNDARY: none | <!-- mandatory for TERRA_RESERVE -->
- WHY_NOT_CLOSER_CANDIDATE: none | <!-- mandatory for non-CLOSE_READY Terra -->
- GOVERNANCE_SCOPE_EXCEPTION: none | OWNER:docs/decisions/<file>.md
- REQUESTED_MODEL / ACTUAL_MODEL: <!-- requested=Terra; actual=unknown -->

## Free dual-Terra metadata

<!-- Required on both active TERRA_BUILD PRs when two full Terra lanes are used. -->

- DUAL_TERRA_PILOT: true | false
- TERRA_SLOT: none | 1 | 2
- PRIMARY_ISSUE: none | #number
- FILE_OWNERSHIP: none | <!-- comma-separated repository-relative roots; no wildcards / .. / overlap -->

## TEST topology metadata

<!-- Local evidence never replaces the final remote canonical TEST. -->

- TEST_PROFILE: SOURCE_ONLY | LOCAL_ISOLATED | LOCAL_ISOLATED_CANARY | SHARED_CANONICAL
- TEST_ENV_ID: none | AUTO_PR_<PR> | <!-- exact local environment id -->
- LOCAL_SLOT_HEALTH: NOT_APPLICABLE | PENDING | HEALTHY | FAILED
- FINAL_CANONICAL_REQUIRED: true | false
- PAID_PREVIEW_BRANCH_STATUS: DEFERRED_NOT_IN_CONSIDERATION
- MIGRATION_TOUCH: true | false
- AUTH_TOUCH: true | false
- STORAGE_TOUCH: true | false
- MIGRATION_LEDGER_STATUS: NOT_CHECKED | INCOMPLETE | REBUILDABLE
- ISOLATION_CANARY_STATUS: NOT_RUN | PENDING | FAILED | ISOLATION_CANARY_GREEN
- ISOLATED_TEST_STATUS: NOT_RUN | PENDING | FAILED | ISOLATED_GREEN
- CANONICAL_TEST_STATUS: NOT_RUN | PENDING | FAILED | VERIFIED_GREEN
- TEST_CLEANUP_STATUS: NOT_RUN | PENDING | FAILED | LOCAL_CLEANUP_VERIFIED

`REMOTE_BRANCH_REQUIRED` is retired. Migration／Auth／Storage work uses `LOCAL_ISOLATED` and then the
single `SHARED_CANONICAL` gate. A paid branch requires a future explicit Owner Decision.

## Scope

- Primary Issue: #
- Changed files / boundaries:
- Intentionally out of scope:
- [ ] One clear Delivery Slice／standalone Issue or tightly coupled governance scope.
- [ ] A Product PR lifecycle `issue:` points to its closable Slice／standalone Issue; a parent Epic is recorded separately.
- [ ] EPIC／GOVERNANCE／retroactive tracking work does not claim a shipped unit.
- [ ] Active Agent governance PR stays at or below 8 files and 800 changed lines, unless a trusted Owner Decision for this exact branch is recorded.
- [ ] Does not duplicate another active implementation PR.
- [ ] If dual Terra, both PRs use the same Run ID but different slot、Issue、TEST_ENV_ID and FILE_OWNERSHIP.
- [ ] Declared FILE_OWNERSHIP is repository-relative and does not overlap the other Terra lane.
- [ ] If dual Terra, no active Reserve Terra exists.
- [ ] If Reserve, work stops after one source-only atomic commit and no shared TEST／Audit.
- [ ] If PARKED／HISTORICAL／OWNER_BLOCKED, no Agent／push／rerun／polling continues.
- [ ] If LOCAL_ISOLATED_CANARY, the claim is only runner／database／cleanup isolation.
- [ ] If LOCAL_ISOLATED, `FINAL_CANONICAL_REQUIRED=true` and local evidence is not reported as final.
- [ ] No paid Supabase Preview Branch is planned, required or created.

## Evidence

- [ ] `npm run guard:repo-integrity` passes.
- [ ] Dependency changes pass clean `npm ci`; `package.json` and lockfile move together.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass before Preview use.

- Base / exact head:
- Targeted tests:
- Typecheck / build:
- Isolation canary:
- Local isolated integration / E2E:
- Local cleanup:
- Remote canonical integration / E2E, or POLICY_SKIP reason:
- Preview / external evidence:
- Unproven acceptance:

## Completion Truth Gate

<!-- A requested action is not a completed result. Fill these from live state only. -->

- COMPLETION_CLAIM: IN_PROGRESS | AUDIT_READY | OWNER_BLOCKED | MERGE_REQUESTED_UNVERIFIED | VERIFIED_MERGED | VERIFIED_CLOSED
- EXACT_HEAD_CI_STATUS: NOT_RUN | PENDING | FAILED | VERIFIED_GREEN
- EXACT_HEAD_CI_RUN: none | <!-- workflow run URL / ID -->
- LOCAL_JOB_RESULT: NOT_RUN | SKIPPED | FAILED | VERIFIED_GREEN
- REMOTE_JOB_RESULT: NOT_RUN | SKIPPED | FAILED | VERIFIED_GREEN
- MERGE_STATUS: NOT_REQUESTED | REQUESTED_UNVERIFIED | VERIFIED_NOT_MERGED | VERIFIED_MERGED
- MERGE_COMMIT_SHA: none | <!-- live PR merge_commit_sha -->
- MAIN_HEAD_VERIFIED: false | true
- MAIN_HEAD_SHA: none | <!-- live default-branch head -->
- MAIN_FILE_RE_READ: none | <!-- key path fetched with ref=main -->
- VERIFIED_AT: none | <!-- ISO timestamp -->

A workflow conclusion of success does not prove a skipped local／integration／E2E job ran. Do not mark
`VERIFIED_MERGED` until the PR is re-fetched, the merge commit is reachable from main, and a key file is
re-read with `ref=main`.

For a Product delivery claim, re-read the live Issue body and require
`DELIVERY_UNIT_TYPE=SLICE|STANDALONE`、`COUNT_IN_DELIVERY_OUTCOME=true` and
`RETROACTIVE_TRACKING_MIGRATION=false`. Epic closeout uses a non-delivery claim and adds no shipped unit.

## Delivery Outcome v2

- Shipped units: <!-- live-verified closed, eligible Delivery Slice／standalone Issues only -->
- Autonomous outcome units: <!-- eligible closed + verified complete Owner-blocked -->
- WIP inventory: <!-- Audit Ready + CI-only + commit-only + carryover -->
- Weighted usage / shipped unit: null | <!-- only when shipped_units >= 1 -->
- Weighted usage / autonomous outcome: null | <!-- only when denominator >= 1 -->
- Actual token / weekly usage data: null | <!-- never guess -->

## Safety

- [ ] No secret is included.
- Production DDL / DML / deploy: NOT_RUN unless explicitly authorized
- Paid Supabase Preview Branch: NOT_CREATED
- Real payment / refund / customer notification: NOT_RUN unless explicitly authorized
- Sol verdict:
