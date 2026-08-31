## Summary

<!-- Explain the smallest product or governance outcome of this PR. -->

## Agent lane metadata

<!-- Keep the exact FIELD: value shape. The WIP guard parses these lines. -->

- WORK_ORIGIN: OWNER | AGENT | UNKNOWN
- AGENT_LANE: TERRA_BUILD | LUNA_CLOSURE | TEST_VALIDATION | GOVERNANCE | OWNER
- LANE_STATE: ACTIVE | PARKED | COMPLETE | OWNER_BLOCKED | HISTORICAL
- ACTIVE_CANDIDATE: true | false
- CLOSEABILITY_SCORE: 0 | 1 | 2 | 3 | 4 | 5
- SELECTION_REASON: CLOSE_READY | DEPENDENCY_UNLOCKER | P0_RUNTIME | OWNER_DIRECTED | GOVERNANCE
- REMAINING_AUTONOMOUS_STEPS: <!-- integer or concise list -->
- OWNER_OR_EXTERNAL_BLOCKER: none | <!-- exact blocker -->
- CLOSURE_SWEEP_TARGET: <!-- #Issue / PR #number / EMPTY_WITH_SCAN -->
- TEST_LANE_REQUIRED: true | false
- WHY_NOT_CLOSER_CANDIDATE: none | <!-- required when an active Terra selection is not CLOSE_READY -->
- REQUESTED_MODEL / ACTUAL_MODEL: <!-- requested=Terra; actual=unknown -->

## Scope

- [ ] This PR has one clear Issue or tightly coupled scope.
- [ ] It does not duplicate another active PR.
- [ ] If `LANE_STATE=PARKED`, no agent, push, rerun or CI polling will continue until Sol reactivates it.

## Evidence

- Base / exact head:
- Changed files:
- Targeted tests:
- Full CI:
- Preview / external evidence:
- Unproven acceptance:

## Safety boundaries

- [ ] No secret is included.
- [ ] Production DDL／DML, Production deployment, real payment and real customer notification remain unchanged unless the Owner explicitly authorized them.
