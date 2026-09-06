# Run closeout contract

A Run must not become an ownerless notebook after a Session stops. Starting a new Run and accepting
responsibility for closing or formally handing it over are one operation.

This contract applies to **new** ledgers created through `agent:run:init`. Historical v2.2 and v3 ledgers
remain readable and are not rewritten.

## Start a new Run

```bash
npm run agent:run:init -- \
  --run-id <YYYY-MM-DD-name> \
  --closeout-owner PRODUCT_MAIN_SESSION
```

Allowed owner roles are intentionally narrow:

```text
PRODUCT_MAIN_SESSION
GOVERNANCE_MAIN_SESSION
OWNER
```

`unknown`, model names, personal names, and free-form prose are rejected. A model may perform work, but
one Session role owns the terminal envelope.

New operational ledgers use `deliveryTruthVersion: 4` and contain:

```json
{
  "closeout": {
    "contractVersion": 1,
    "ownerRole": "PRODUCT_MAIN_SESSION",
    "terminalPolicy": "CLOSE_OR_REASSIGN_BEFORE_SESSION_EXIT_OR_OWNER_STOP_OR_SCOPE_EXHAUSTED_OR_OWNER_BLOCKED",
    "state": "OPEN",
    "closedAt": null,
    "evidenceRef": null
  }
}
```

The policy means that before a Session exits, receives an Owner stop, exhausts its safe scope, or becomes
Owner-blocked, the current owner must either:

1. finish the Run closeout; or
2. update the live ledger/checkpoint so another explicit Session role owns it.

A chat message saying “someone else will close it” is not a durable handoff.

## Final Run requirements

For a v4 Run with `status` equal to `BASELINE`, `COMPLETE`, or `OWNER_BLOCKED`, validation requires all of
the following:

```text
closeout.state = CLOSED
closeout.closedAt = endedAt as an ISO UTC timestamp
main.endSha = one 40-character commit SHA
inventory.openIssuesEnd = non-negative integer
inventory.openPrsEnd = non-negative integer
closeout.evidenceRef = durable compact evidence
```

Evidence uses a compact `scheme:value` reference, not prose or a credential-bearing URL. Examples:

```text
github:issue#193
github:pull/194
github:actions/runs/33935386017
repo:docs/handoffs/2026-09-05-closeout.md
```

Values such as `I checked it`, `none`, `TBD`, a bare label, or `https://...` are rejected. The compact
reference keeps the ledger deterministic and points reviewers to a durable truth surface without copying
signed email links, tokens, or long URLs into the Run.

A non-final Run (`IN_PROGRESS` or `CLOSURE_RECOVERY`) must keep the closeout state OPEN and both closeout
fields null. This prevents a running ledger from wearing a cardboard “closed” badge.

The closeout contract does not replace Completion Truth or scoring. A terminal envelope can validate while
the score remains `NOT_GRADED` until the remaining metrics and verified claims are complete.

## Historical compatibility

- `deliveryTruthVersion: 2` and `3` continue to validate with their original shape.
- The three historical/current Runs created before this contract are not modified automatically.
- Historical v3 construction is available only through the explicitly named
  `createHistoricalRunLedgerV3()` helper for tests and byte-compatible reproduction.
- `createRunLedgerV2()` and the operational CLI require an explicit closeout owner and create v4.

## Safety

This contract changes only repository governance tooling. It does not run TEST, deploy Vercel, connect to
Supabase, modify Production, send LINE messages, charge payments, or close an existing Product Run by
inference.
