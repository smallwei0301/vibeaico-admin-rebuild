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
- RESERVE_BOUNDARY: none | <!-- only for single-Terra fallback -->
- WHY_NOT_CLOSER_CANDIDATE: none | <!-- mandatory for non-CLOSE_READY Terra -->
- REQUESTED_MODEL / ACTUAL_MODEL: <!-- requested=Terra; actual=unknown -->

## Free dual-Terra pilot metadata

<!-- Required on both active TERRA_BUILD PRs when two full Terra lanes are used. -->

- DUAL_TERRA_PILOT: true | false
- TERRA_SLOT: none | 1 | 2
- FILE_OWNERSHIP: none | <!-- comma-separated path roots; no overlap with the other Terra -->

## TEST topology metadata

<!-- Local evidence never replaces the final remote canonical TEST. -->

- TEST_PROFILE: SOURCE_ONLY | LOCAL_ISOLATED | LOCAL_ISOLATED_CANARY | SHARED_CANONICAL
- TEST_ENV_ID: none | AUTO_PR_<PR_NUMBER> | <!-- exact environment id -->
- FINAL_CANONICAL_REQUIRED: true | false
- MIGRATION_TOUCH: true | false
- AUTH_TOUCH: true | false
- STORAGE_TOUCH: true | false
- MIGRATION_LEDGER_STATUS: NOT_CHECKED | INCOMPLETE | REBUILDABLE
- ISOLATION_CANARY_STATUS: NOT_RUN | PENDING | FAILED | ISOLATION_CANARY_GREEN
- ISOLATED_TEST_STATUS: NOT_RUN | PENDING | FAILED | ISOLATED_GREEN
- CANONICAL_TEST_STATUS: NOT_RUN | PENDING | FAILED | VERIFIED_GREEN
- TEST_CLEANUP_STATUS: NOT_RUN | PENDING | FAILED | LOCAL_CLEANUP_VERIFIED

## Scope

- Primary Issue: #
- Changed files / boundaries:
- Intentionally out of scope:
- [ ] One clear Issue or tightly coupled governance scope.
- [ ] Does not duplicate another active implementation PR.
- [ ] If dual Terra, Issue／TERRA_SLOT／TEST_ENV_ID／FILE_OWNERSHIP differ from the other PR.
- [ ] If dual Terra, no active Reserve Terra exists.
- [ ] If PARKED/HISTORICAL/OWNER_BLOCKED, no Agent/push/rerun/polling continues.
- [ ] If LOCAL_ISOLATED_CANARY, the claim is only runner/database/cleanup isolation.
- [ ] If LOCAL_ISOLATED, `FINAL_CANONICAL_REQUIRED=true` and local evidence is not reported as final.
- [ ] Paid Supabase Preview Branch is not planned, required or created.

## Evidence

- Base / exact head:
- Targeted tests:
- Typecheck / build:
- Isolation canary:
- Local isolated integration / E2E:
- Local cleanup:
- Remote canonical integration / E2E, or POLICY_SKIP reason:
- Remote queue position:
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
- Full remote CI count:
- Invalid reruns:
- Luna tasks / accepted:
- Terra slot active minutes:
- Local isolated jobs / cleanup:
- Remote canonical wait minutes:
- File ownership collisions:
- Delivery exit:

## Safety

- [ ] No secret is included.
- Production DDL / DML / deploy: NOT_RUN unless explicitly authorized
- Paid Supabase branch: NOT_CREATED
- Real payment / refund / customer notification: NOT_RUN unless explicitly authorized
- Sol verdict:
