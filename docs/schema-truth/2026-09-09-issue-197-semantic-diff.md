# Issue #197 — exact-main live semantic diff

Date: 2026-09-09

## Durable checkpoint

- GOVERNANCE_LOOP_ID: `2026-09-09-governance-loop-r01`
- STAGE: `G5_VERIFY / G8_OBSERVE`
- CURRENT_MAIN: `44321f3eb1513d9e915c35c0fc00db5d28d18854`
- OBSERVED_AT: `2026-09-09T06:03:57Z`
- PROJECT_REFS: TEST=`nmwhwngojosmagjuvxol`, PRODUCTION=`egehnijjpgijmccagxac`
- QUERY_VERSION: `public-schema-metadata-v1`
- QUERY_DIGEST: `00008ea241a42440995d639a619c11d18d4a5e01c92d9b5fb07cd9d83151234d`
- CAPTURE_DIGEST_RULE: per-surface MD5 of ordered `item_key|item_value` lines; ledger MD5 of ordered `version|name` lines
- REQUESTED_MODEL: none (read-only provider evidence)
- ACTUAL_MODEL: none (no model execution required)

This is a read-only comparison of the seven public catalog surfaces. It does not choose a canonical
environment, generate reconciliation SQL, or authorize any database operation.

## Repo fixture boundary

`repoBuiltProfile=NOT_RUN`. The repository was not presented as a freshly built database, because the
current environment has no local PostgreSQL/Supabase runtime and the source migrations require the
documented local-only historical overlay. Therefore every repo presence result remains
`REPO_UNVERIFIED`; no source-to-live conclusion is invented.

## TEST versus Production semantic result

| Surface | TEST | Production | TEST-only keys | Production-only keys | Same-key definition mismatch | Same-key match |
|---|---:|---:|---:|---:|---:|---:|
| columns | 731 | 549 | 182 | 0 | 1 | 548 |
| constraints | 286 | 187 | 105 | 6 | 1 | 180 |
| indexes | 136 | 91 | 46 | 1 | 0 | 90 |
| views | 2 | 2 | 0 | 0 | 0 | 2 |
| policies | 77 | 73 | 8 | 4 | 1 | 68 |
| routines | 262 | 207 | 55 | 0 | 0 | 207 |
| triggers | 26 | 6 | 20 | 0 | 0 | 6 |

The result is `DRIFT_OBSERVED`. It establishes that TEST and Production are not interchangeable schema
truths; it does not establish which side is correct.

## Selected keys requiring review

These are semantic-diff keys, not migration instructions:

- Column definition mismatch: `public.tour_orders.payment_status`.
- Constraint definition mismatch: `public.booking_addons.booking_addons_notified_check`.
- Policy definition mismatch: `public.booking_addons.p_booking_addons_s`.
- TEST-only surface examples include `public.booking_addon_idempotency_receipts_17.*`,
  `public.email_recipient_health.*`, `public.notification_deliveries.*`, and
  `public.tour_order_payment_receipts_41.*`.
- Production-only constraint examples include the `public.tour_orders.*_fkey` identities and
  `public.trip_departure_staff.*_fkey` identities; the Production-only index sample is
  `public.trip_departure_staff.ix_trip_departure_staff_staff`.

The committed artifact intentionally stores keys and classifications, not raw catalog payloads,
application rows, credentials, or function bodies. The exact query contract and timestamp are the
reproduction boundary for a future capture.

## Disposition

- STATUS: `SEMANTIC_DIFF_COMPLETE / NEED_OWNER_CANONICAL_DECISION`
- ROOT_CAUSE: TEST and Production have materially different live object sets and definitions, while
  the repository fixture cannot yet be proven canonical-only or overlay-augmented in this environment.
- UNKNOWN: repo presence, canonical source selection, and whether any individual difference is intended.
- NEXT_BOUNDED_ACTION: Owner selects the canonical source; only then may a separate source reconciliation
  slice be designed. Production DDL/DML, shared TEST mutation, and Product runtime changes remain out of scope.

## Safety

Both queries were catalog-only reads. No application rows, secrets, DDL, DML, reset, seed, migration
apply, deployment, payment, notification, or shared TEST mutation was performed.
