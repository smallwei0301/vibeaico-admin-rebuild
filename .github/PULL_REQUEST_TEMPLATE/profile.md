<!--
PROFILE-FIRST AUTHORING

1. Fill only the variable fields below.
2. Save this body locally, for example /tmp/pr-body.compact.md.
3. Run:

   node scripts/agents/pr-metadata-profile.mjs \
     --body /tmp/pr-body.compact.md \
     --changed-files /tmp/changed-files.txt \
     --number <PR_NUMBER_OR_PLACEHOLDER> \
     --output /tmp/pr-body.md

4. Create/update the PR with /tmp/pr-body.md, not this compact source.

Canonical guide: docs/PR-METADATA-PROFILES.md
-->

<!-- pr-lifecycle
issue: <number>
state: ACTIVE
supersedes:
-->

PR_PROFILE: GOVERNANCE_SOURCE_ONLY | PRODUCT_TERRA_BUILD

## Summary

<smallest bounded outcome>

## Variable metadata

WORK_ORIGIN: OWNER | AGENT
LANE_STATE: ACTIVE
CLOSEABILITY_SCORE: 0 | 1 | 2 | 3 | 4 | 5
SELECTION_REASON: CLOSE_READY | DEPENDENCY_UNLOCKER | P0_RUNTIME | P1_SOURCE_HARDENING | OWNER_DIRECTED | GOVERNANCE
REMAINING_AUTONOMOUS_STEPS: <concise exact steps>
OWNER_OR_EXTERNAL_BLOCKER: none | <exact blocker>
CLOSURE_SWEEP_TARGET: #<issue> | PR #<number> | EMPTY_WITH_SCAN | REPORT:<path>
GOVERNANCE_SCOPE_EXCEPTION: none | OWNER:docs/decisions/<file>.md

<!-- PRODUCT_TERRA_BUILD only: these remain explicit because they depend on the real Product slice. -->
RUN_ID: <YYYY-MM-DD-name>
DELIVERY_UNIT_TYPE: SLICE | STANDALONE
PARENT_EPIC: none | #<number>
USER_VISIBLE_OUTCOME: <one independently usable result>
WHY_NOT_CLOSER_CANDIDATE: none | <reason>
REQUESTED_MODEL / ACTUAL_MODEL: <truthful source>
TEST_LANE_REQUIRED: false | true
TEST_PROFILE: SOURCE_ONLY | LOCAL_ISOLATED | LOCAL_ISOLATED_CANARY | SHARED_CANONICAL
FINAL_CANONICAL_REQUIRED: false | true
MIGRATION_TOUCH: false | true
AUTH_TOUCH: false | true
STORAGE_TOUCH: false | true
ASTRA_RISK: NONE | PAYMENT_CONSISTENCY | TENANT_AUTH_BOUNDARY | IRREVERSIBLE_DATA | CROSS_REPO_CONTRACT | GOVERNANCE_GATE | UNRESOLVED_HIGH_RISK
ASTRA_RATIONALE: <concrete risk classification>
FINAL_RISK_POLICY: BY_PRODUCT_RISK_CLASSIFICATION
ASTRA_TEST_BASELINE: none | <required when risk is not NONE>
ASTRA_SCHEMA_BASELINE: none | <required when risk is not NONE>

## Scope / evidence

<normal PR scope and exact-head evidence>
