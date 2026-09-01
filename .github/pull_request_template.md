<!-- pr-lifecycle
issue:
state: ACTIVE
supersedes:
-->

## Summary

<!-- Explain the smallest product or governance outcome. -->

## B+ Agent lane metadata

<!-- Keep exact FIELD: value lines. The WIP Guard parses them. -->

- WORK_ORIGIN: OWNER | AGENT | UNKNOWN
- BPLUS_MODE: true | false
- RUN_ID: <!-- YYYY-MM-DD-name -->
- SCORECARD_PATH: <!-- docs/metrics/agent-runs/<RUN_ID>.json -->
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
- WHY_NOT_CLOSER_CANDIDATE: none | <!-- mandatory for non-CLOSE_READY MAIN -->
- REQUESTED_MODEL / ACTUAL_MODEL: <!-- requested=Terra; actual=unknown -->

## Scope

- Primary Issue: #
- Changed files / boundaries:
- Intentionally out of scope:
- [ ] One clear Issue or tightly coupled governance scope.
- [ ] Does not duplicate another active implementation PR.
- [ ] MAIN and RESERVE hot files do not overlap.
- [ ] If RESERVE, work stops after one source-only atomic commit and no shared TEST/Audit.
- [ ] If PARKED/HISTORICAL/OWNER_BLOCKED, no Agent/push/rerun/polling continues.

## Evidence

- Base / exact head:
- Targeted tests:
- Typecheck / build:
- Integration / E2E, or POLICY_SKIP reason:
- Preview / external evidence:
- Unproven acceptance:

## Run metrics

- Requested / actual model tasks:
- Full CI count:
- Invalid reruns:
- Luna tasks / accepted:
- Delivery exit:

## Safety

- [ ] No secret is included.
- Production DDL / DML / deploy: NOT_RUN unless explicitly authorized
- Real payment / refund / customer notification: NOT_RUN unless explicitly authorized
- Sol verdict:
