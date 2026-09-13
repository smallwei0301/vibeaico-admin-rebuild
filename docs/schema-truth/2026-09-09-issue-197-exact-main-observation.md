# Issue #197 — exact-main read-only schema truth observation

Date: 2026-09-09

## Durable checkpoint

- GOVERNANCE_LOOP_ID: `2026-09-09-governance-loop-r01`
- STAGE: `G5_VERIFY / G8_OBSERVE`
- CURRENT_MAIN: `744917c97a77a93214eae69047f7218e1edee0e1`
- OBSERVED_AT: `2026-09-09T04:11:54Z`
- PROJECT_REFS: TEST=`nmwhwngojosmagjuvxol`, PRODUCTION=`egehnijjpgijmccagxac`
- EVIDENCE_REFS: `supabase:test/migrations+public-tables/2026-09-09T04:11Z`, `supabase:production/migrations+public-tables/2026-09-09T04:11Z`
- REQUESTED_MODEL: none (read-only provider evidence)
- ACTUAL_MODEL: none (no model execution required)

This is a metadata-only observation for the exact current main. It does not select a canonical live environment, generate reconciliation SQL, or authorize any database operation.

## Method and boundary

The observation used the Supabase read-only migration-list and public-table metadata paths for both pinned project references. The returned metadata was reduced to migration identities, public table names, column names/types/default/check metadata, RLS state, and foreign-key identity. No application rows, customer data, credential values, DDL, DML, reset, seed, schema reload, migration apply, or shared TEST mutation was performed.

The current main migration directory contains **40** SQL files and ends at `0093_booking_points_status_guard.sql`. The report is intentionally a bounded evidence slice: it does not claim a complete seven-surface comparison of indexes, policies, views, routines, and triggers.

## Exact-main live evidence

### Migration ledger

| Surface | Count | Latest observed identity | Meaning |
|---|---:|---|---|
| `origin/main` migration files | 40 | `0093_booking_points_status_guard.sql` | Source admission truth only |
| TEST provider ledger | 64 | `20260909005558:0094_tenant_payment_methods` | Provider history; not proof of main source |
| Production provider ledger | 15 | `20260909022752:0094_tenant_payment_methods` | Provider history; not proof of main source |

Both live ledgers contain a `0094_tenant_payment_methods` entry, but the provider version identities differ and `0094` is not present on current main. The open Product PR #306 contains that migration on its own head; this governance slice does not modify, promote, or merge #306.

### Public table inventory

| Surface | TEST | Production | Interpretation |
|---|---:|---:|---|
| public tables | 62 | 47 | environment difference observed |
| TEST-only tables | 15 | 0 | live TEST residue or TEST-only adoption; not automatically a migration request |
| Production-only tables | 0 | 0 | none in this metadata snapshot |

TEST-only table names:

`booking_addon_idempotency_receipts_17`, `email_recipient_health`, `keyword_reply_image_cleanup`, `notification_deliveries`, `notification_health_reports`, `notification_outbox`, `notification_provider_webhook_events`, `push_quota_reservations`, `telegram_bind_codes`, `telegram_bindings`, `telegram_webhook_updates`, `tour_formation_decisions`, `tour_order_addons`, `tour_order_payment_receipts_41`, `welcome_card_image_retirements`.

### Selected semantic differences

These are concrete metadata differences, not a claim that one side is correct:

1. `public.tenant_payment_methods`: TEST has the 10 current columns plus `gateway_provider`, `gateway_merchant_id`, `gateway_hash_key_enc`, `gateway_hash_iv_enc`, and `gateway_verified_at`; Production has the 10-column shape without those gateway fields. Both report RLS enabled.
2. `public.trip_departure_staff`: both environments report the same six columns and RLS enabled, but TEST reports composite tenant-aware departure/staff foreign-key identities while Production reports the single-column departure/staff foreign-key identities. This is a real constraint-surface difference; no direction is selected here.
3. `public.customers`: the selected metadata is column-equivalent, but the tenant/customer foreign-key identity differs (`tour_orders_tenant_customer_fkey` on TEST versus `tour_orders_customer_id_fkey` on Production). Names alone do not prove the full constraint semantics, so this remains unresolved rather than being classified as a repair.

## Canonical-source rule for the next slice

1. Exact bytes reachable from `refs/heads/main` are the source truth for what the repository currently admits.
2. TEST and Production catalogs are independent live runtime truths at their observed timestamps.
3. Provider migration ledgers are historical application evidence, not a substitute for repository files or object definitions.
4. A difference is classified as `REPO_ONLY`, `LIVE_ONLY`, `LIVE_DEFINITION_MISMATCH`, or `LEDGER_IDENTITY_MISMATCH`; none of these labels authorizes a migration.
5. A canonical source decision requires a complete, exact-main, read-only semantic comparison across the required surfaces. Until then, the disposition remains `NEED_MORE_EVIDENCE`.

## Disposition

- STATUS: `OBSERVATION_COMPLETE / ISSUE_REMAINS_OPEN`
- ROOT_CAUSE: repository migration bytes, provider migration ledgers, and live object catalogs are materially different truth surfaces.
- NEXT_BOUNDED_ACTION: collect a reproducible exact-main snapshot pair covering the remaining schema surfaces, then review the semantic diff under #197. Keep missing or unavailable evidence as `unknown`.
- OWNER_DECISION_REQUIRED: any reconciliation migration, canonical TEST change, Production DDL/DML, or deployment action.
- PRODUCT_FOLLOWUP: none introduced by this governance slice. Product PR #306 remains with the Product Session.

## Safety

This document is read-only evidence. It is not authorization to apply a migration, change TEST or Production, promote/rollback/delete a deployment, send a notification, process payment, or modify Product runtime behavior.