# Owner decision: canonical schema source for Issue #197

Date: 2026-09-10
Issue: #197
Status: DECIDED

## Decision

The future canonical schema authority is the reviewed, rebuildable schema represented on current `main`:

1. canonical migrations under `supabase/migrations/`; and
2. an explicit current Product contract proving the object is intended for the current product.

TEST and Production are live evidence/reconciliation environments. Neither environment is a whole-schema authority and neither may be copied wholesale back into `main`.

The required direction is:

```text
Product intent -> reviewed main migration source -> TEST validation -> Production reconciliation
```

## Difference classification

Before generating reconciliation SQL, every supported difference must be classified by current Product semantics:

- `ACTIVE_RUNTIME`: current source/API/runtime proves an active Product dependency. Canonical `main` must be able to rebuild it.
- `FUTURE_PRODUCT`: deliberate future contract, not a current bootstrap/runtime requirement.
- `LEGACY_RETIRED`: historical schema with no current Product ownership; do not add it to a fresh-install baseline merely because it remains live.
- `COMPATIBILITY_ONLY`: retained only for immutable migration replay or baseline cutover; do not represent it as an active feature.

Observed states such as `TEST_ONLY`, `PRODUCTION_ONLY`, `REPO_MISSING`, `OUT_OF_LEDGER`, or same-key definition mismatch are evidence labels, not decisions about which side is correct.

## Explicit non-decisions

This decision does **not** mean every current `main` object is automatically correct. It means an approved schema decision must ultimately be represented in reviewed, rebuildable `main` source.

This decision does **not** authorize any unnamed Production DDL, DML, migration, reset, seed, deployment, payment, refund, or notification action. Production schema changes remain separately named Owner gates.

## #197 closure contract

Issue #197 may close when all of the following are true:

- the original source-side drift prevention is durable on `main`;
- the original known drift fields are represented by canonical forward migrations or explicitly classified as non-current Product schema;
- semantic TEST/Production differences have durable read-only evidence and a classification rule;
- the canonical authority decision in this file and `docs/SCHEMA-TRUTH-GOVERNANCE.md` is merged to `main`;
- no unresolved difference requires an immediate Product/runtime migration to make current `main` truthful;
- any future TEST/Production reconciliation that still needs execution is tracked as a separate bounded work item with its own authorization rather than keeping this umbrella governance issue open forever.

The Owner explicitly authorized continuing #197 source/governance work to truthful closure under this contract on 2026-09-10.
