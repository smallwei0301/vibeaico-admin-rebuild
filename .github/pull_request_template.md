<!-- pr-lifecycle
issue:
state: ACTIVE
supersedes:
-->

## Summary

<!-- Explain the smallest Product or governance outcome. -->

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

## TEST topology metadata

<!-- Local evidence never replaces the final remote canonical TEST. -->

- TEST_PROFILE: SOURCE_ONLY | LOCAL_ISOLATED | LOCAL_ISOLATED_CANARY | REMOTE_BRANCH_REQUIRED | SHARED_CANONICAL
- TEST_ENV_ID: AUTO | <!-- exact local/branch environment id -->
- FINAL_CANONICAL_REQUIRED: true | false
- MIGRATION_TOUCH: true | false
- AUTH_TOUCH: true | false
- STORAGE_TOUCH: true | false
- REMOTE_BRANCH_SLOT: none | 1 | 2
- MIGRATION_LEDGER_STATUS: NOT_CHECKED | INCOMPLETE | REBUILDABLE
- ISOLATION_CANARY_STATUS: NOT_RUN | PENDING | FAILED | ISOLATION_CANARY_GREEN
- ISOLATED_TEST_STATUS: NOT_RUN | PENDING | FAILED | ISOLATED_GREEN
- CANONICAL_TEST_STATUS: NOT_RUN | PENDING | FAILED | VERIFIED_GREEN
- TEST_CLEANUP_STATUS: NOT_RUN | PENDING | FAILED | LOCAL_CLEANUP_VERIFIED | VERIFIED_DESTROYED

## Scope

- Primary Issue: #
- Changed files / boundaries:
- Intentionally out of scope:
- [ ] One clear Issue or tightly coupled governance scope.
- [ ] Does not duplicate another active implementation PR.
- [ ] MAIN and RESERVE hot files do not overlap.
- [ ] If RESERVE, work stops after one source-only atomic commit and no shared TEST/Audit.
- [ ] If PARKED/HISTORICAL/OWNER_BLOCKED, no Agent/push/rerun/polling continues.
- [ ] If LOCAL_ISOLATED_CANARY, the claim is only runner/database/cleanup isolation.
- [ ] If LOCAL_ISOLATED, `FINAL_CANONICAL_REQUIRED=true` and local evidence is not reported as final.
- [ ] If REMOTE_BRANCH_REQUIRED, cost/lease/delete evidence exists before branch creation.

## Evidence

- [ ] `npm run guard:repo-integrity` passes (core tree, deletion count, and source SHA scan).
- [ ] Dependency changes pass a clean `npm ci`; `package.json` and `package-lock.json` are committed together.
- [ ] `npm run typecheck`, `npm test`, and `npm run build` pass before any `preview/**` branch is created or moved.

- Base / exact head:
- Targeted tests:
- Typecheck / build:
- Isolation canary:
- Local isolated integration / E2E:
- Remote canonical integration / E2E, or POLICY_SKIP reason:
- Preview / external evidence:
- Unproven acceptance:

## Completion Truth Gate

<!-- A requested action is not a completed result. Fill these from live state only. -->

- COMPLETION_CLAIM: IN_PROGRESS | AUDIT_READY | OWNER_BLOCKED | MERGE_REQUESTED_UNVERIFIED | VERIFIED_MERGED | VERIFIED_CLOSED
- EXACT_HEAD_CI_STATUS: NOT_RUN | PENDING | FAILED | VERIFIED_GREEN
- EXACT_HEAD_CI_RUN: none | <!-- workflow run URL / ID -->
- MERGE_STATUS: NOT_REQUESTED | REQUESTED_UNVERIFIED | VERIFIED_NOT_MERGED | VERIFIED_MERGED
- MERGE_COMMIT_SHA: none | <!-- live PR merge_commit_sha -->
- MAIN_HEAD_VERIFIED: false | true
- MAIN_HEAD_SHA: none | <!-- live default-branch head -->
- MAIN_FILE_RE_READ: none | <!-- key path fetched with ref=main -->
- VERIFIED_AT: none | <!-- ISO timestamp -->

Do not change `MERGE_STATUS` to `VERIFIED_MERGED` until the PR is re-fetched after merge, the merge
commit is reachable from main, and a key file has been re-read with `ref=main`.

## Run metrics

- Requested / actual model tasks:
- Full CI count:
- Invalid reruns:
- Luna tasks / accepted:
- Local canary / isolated jobs / cleanup:
- Migration rebuild gaps:
- Remote branch hours / estimated cost / destroyed:
- Delivery exit:

## Safety

- [ ] No secret is included.
- Production DDL / DML / deploy: NOT_RUN unless explicitly authorized
- Real payment / refund / customer notification: NOT_RUN unless explicitly authorized
- Sol verdict:
