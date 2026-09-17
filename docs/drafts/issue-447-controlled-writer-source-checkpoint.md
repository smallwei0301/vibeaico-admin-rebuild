# Issue #447 controlled writer source checkpoint

Status: SOURCE_ONLY / NOT_AUTOMATION_READY

This checkpoint exists so the Product writer slice has a durable scope boundary while source CI runs.
It does not authorize or perform a Production database mutation.

## 2026-09-15 current-main re-alignment

- Material freshness trigger detected: current main added `0110_issue_42_plan_duration_pricetype_yearround` and marked it `PENDING_APPLY` in `supabase/ledger-alias-map.json`.
- #450 was re-aligned by a normal two-parent merge commit `7b06a8bb5070c5663f5c893633e60caa8b0422cf`; no reset, rebase, force-push, or main mutation was used.
- Re-aligned main parent: `76bb5cfe78777b89378346b568e5df0cb9197934`.
- Actual diff against that main parent remains the bounded writer-core source slice.
- Current canonical pending set now includes 0105 / 0109 / 0110. The release plan must derive this set from current main at runtime; it must never hard-code the older 0105 / 0109 pair.
- `0110` is risk-classified from its current-main SQL. Because it contains a `SECURITY DEFINER` routine and execute-privilege changes, downstream G3 must provide explicit AUTHZ coverage; source-only #450 does not claim that remote TEST acceptance.
- Local isolated routing for this PR is `TEST_PROFILE: SOURCE_ONLY`; final canonical TEST remains required at the complete #447 release-workflow layer.

## Current source slice

- trusted-main `PENDING_APPLY` release-plan builder;
- canonical migration-byte digests and plan-bound provider ledger versions;
- live provider ledger ↔ alias-map exact comparison;
- DB advisory transaction lock + post-lock ledger recheck;
- one atomic Management API mutable request;
- `APPLY_UNKNOWN` on mutable-call uncertainty, with no blind retry;
- post-apply provider-ledger readback before schema/ACL/RLS postcheck;
- legacy `run-migrations.mjs` Production path blocked while TEST behavior remains available.

## Still required before `AUTOMATION_READY=true`

1. exact-head source CI on the re-aligned current-main pending set;
2. stacked #454 / #455 re-alignment and exact-head source validation;
3. fresh canonical G3 TEST evidence for the locked current-main release plan, including risk-adaptive AUTHZ coverage;
4. trusted G4 backup / restore evidence bound to the eventual exact main;
5. independent Product Final Risk on the exact release evidence bundle;
6. independently evidenced project-bound Production PostgreSQL writer credential and no broad-PAT fallback;
7. correct Product build-tier / Terra merge-readiness verification; this source was authored by `gpt-5.6-sol` and must not be relabeled as Terra evidence.

## Completion truth

- Production DB write: NOT_RUN.
- Production DDL / DML / migration: NOT_RUN.
- `AUTOMATION_READY`: false.
- `POLICY_GATED_ACTIVE`: false.
- Per-run Owner approval removal is not active until trusted-main machine evidence proves readiness.
