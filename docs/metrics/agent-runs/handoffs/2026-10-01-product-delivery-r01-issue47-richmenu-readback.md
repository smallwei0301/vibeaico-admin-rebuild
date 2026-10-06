# RUN_CAPTURE_HANDOFF — Issue #47 Rich Menu readback

- `RUN_ID`: `2026-10-01-product-delivery-r01`
- `EVENT`: Current continuation verified the #47 Rich Menu saved-ID readback slice, found its new build/review events are not yet present in `modelUsage.tasks`, and recorded the exact source/review evidence below.
- `EVIDENCE_REF`: builder source commit `bf831814ba61d5106729e33f662de85232b5a07b`; source follow-up commit `0c6e829e1c25ca3062a7f5e17cd1976e12af7c00`; local Node 22 focused suite 8/8 and typecheck exit 0; Standards and Spec rereviews on head `0c6e829e1c25ca3062a7f5e17cd1976e12af7c00` both completed, requested `gpt-6.1-sol`, actual model `unknown`.
- `RUN_READINESS`: `NEEDS_CAPTURE` until the owning Run writer adds the missing task events to the canonical Run and re-runs readiness.
- `OBSERVED_AT`: `2026-10-01T20:32:25Z`
- `WRITER_BLOCKER`: Open PR #714 is PARKED and its changed-file inventory owns both `docs/metrics/agent-runs/2026-10-01-product-delivery-r01.json` and `.md`. This continuation leaves those owned files untouched and does not wake, push, or rerun #714.
- `NEXT_SAFE_WRITE_PATH`: After a fresh live triage resolves #714's Run-file integration ownership, the PRODUCT_MAIN_SESSION Run owner adds the omitted raw task rows to the current canonical Run and refreshes its scorecard readiness. Keep this handoff linked until that write is reconciled; this file is not a substitute for the canonical Run ledger.

## Product scope and limits

The source exposes the tenant's saved `richMenuId` after reload while describing it only as a saved setting value. It does not claim that the value proves VibeAI publication or current LINE state. Secret masking, tenant-scoped settings reads, application-level forged-input stripping, and settings-save preservation are covered by the slice. The slice does not complete #47's provider smoke, quota/test-message/#40 ledger, wizard completion truth, in-app browser, or authenticated Preview/Production acceptance.

This handoff is a governance/telemetry recovery item, not a Product Outcome and not a claim that the feature shipped.
