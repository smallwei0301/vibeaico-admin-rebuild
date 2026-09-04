# Run ledger deterministic reconciliation

This document defines the bounded closeout path for copying verified Product Delivery Truth into
`docs/metrics/agent-runs/<RUN_ID>.json` without turning provider status events into automatic commits.

## Safety boundary

`agent-run-ledger-reconcile` is manual-only (`workflow_dispatch`) and has `contents: read` permission.
It cannot commit, push, force-push, edit an Issue, or merge a pull request. Its only durable output is a
14-day candidate artifact containing the rebuilt JSON, Markdown report, result metadata, and patch.
A normal reviewed governance PR is still required to place the candidate on `main`.

A Vercel status, GitHub status, push, pull-request event, or scheduled event never dispatches this
workflow. This prevents the loop:

```text
provider status → ledger commit → main deployment → provider status → ledger commit
```

## Deterministic identity

Every evidence artifact has this identity:

```text
sha256(RUN_ID + observed main SHA + canonical evidence digest)
```

Object key order and operation order do not change the digest. Applying the same identity twice to the
same ledger returns `NO_CHANGES`; it does not manufacture another commit candidate.

## Required live-state locks

The dispatch supplies all three locks:

1. `run_id`
2. `observed_main_sha`
3. `expected_ledger_sha` (the Git blob SHA, not a filename checksum)

The workflow reads live `main` and the live ledger SHA before checkout, then reads them again before
uploading the artifact. Any mismatch fails closed. The script also computes the Git blob SHA from the
exact ledger bytes. It never rebases, overwrites a competing update, or uses force push.

## Evidence format

The base64-decoded JSON uses schema version 1:

```json
{
  "schemaVersion": 1,
  "runId": "2026-09-04-product-delivery-r01",
  "observedMainSha": "40-character-sha",
  "completionTruth": {
    "status": "VERIFIED",
    "checkedAt": "2026-09-04T06:00:00Z"
  },
  "operations": [
    {
      "action": "ADD",
      "claim": {
        "type": "AUTO_VERCEL_DEPLOYED",
        "subject": "issue#42",
        "claimedState": "ready",
        "observedState": "ready",
        "verification": "VERIFIED",
        "evidenceRef": "vercel:deployment:dpl_example"
      }
    }
  ]
}
```

`REPLACE` requires the complete exact old claim in `expectedClaim`. If it is missing, duplicated, or was
changed by another session, reconciliation stops. New Product-stage subjects must be exactly
`issue#<number>`; legacy `CI_GREEN`, `PR_MERGED`, and `LOCAL_TEST_GREEN` claims cannot be added through
this path. A misleading legacy claim may be replaced by a truthful `OTHER` correction record.

## History firewall and output chain

Ledgers with `deliveryTruthVersion < 3` are read-only here. The tool does not silently upgrade historical
v2.2 Runs or recalculate their shipped units.

For a Delivery Truth v3 Run, the workflow performs:

```text
apply exact evidence
→ validate JSON
→ regenerate Markdown from score-run-v2
→ regenerate again and diff
→ enforce JSON/Markdown-only output
→ re-read live main and ledger SHA
→ upload candidate artifact
```

`SKIPPED_BY_SOURCE_POLICY` remains a skip. This workflow never uses local or remote Supabase TEST and
must not be described as integration green.
