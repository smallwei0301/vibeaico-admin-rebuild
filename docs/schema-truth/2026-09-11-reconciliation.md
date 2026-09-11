# Schema truth reconciliation: executable bootstrap evidence

Scope: #298, related Product #362 and the closed authority decision #197.
Owner request: resolve the database truth fragmentation found in the retrospective.
Source inspected: `ca3821bfd615cb3695473839e4dafa556cf65767`.
This document records evidence and a bounded experiment, not a new canonical schema decision.

## Canonical authority is already decided

Use `docs/SCHEMA-TRUTH-GOVERNANCE.md` and
`docs/decisions/2026-09-10-schema-canonical-source.md`.
Direction remains Product intent -> reviewed/rebuildable main -> TEST -> Production.
Never copy a whole live database, silently repair a provider ledger, rewrite an existing migration,
or weaken TEST constraints simply to make comparisons green.

## Why ordinary local TEST is insufficient

The existing `stage-local-migration-ledger.mjs` selects BOTH the historical integration manifest and
`issue-41-candidate-baseline/manifest.json`. Therefore a green ordinary local TEST does not establish
that the current Product schema can be bootstrapped without the future #41 implementation.
The bare canonical migration chain has the separately reproduced #298 missing-table failure at 0082.

The new `agent-schema-bootstrap` workflow isolates the missing middle proof:

1. Check out the exact tested head and reject dirty/symlinked schema input.
2. Copy only canonical SQL and the hash-verified historical manifest into a new disposable directory.
3. Preserve explicit retirement and transaction wrappers; reject prefix collisions and unknown selectors.
4. NEVER load the #41 candidate manifest, `.env`, a Supabase link, or remote credentials.
5. Start a fresh Supabase 17 stack using the existing pinned CLI version.
6. Assert current table/RPC dependencies exist and the eight future #41 order columns do not.
7. Capture the existing seven-surface and ACL contracts, then destroy the local stack.

A passing result is **HISTORICAL_COMPATIBILITY_CANDIDATE**, not CANONICAL_ONLY, schema parity,
Product integration acceptance, or permission to apply anything to a remote database. No existing
local-isolated/shared TEST pipeline changes. This is a Product schema reproducibility experiment under #298;
canonical adoption and remote reconciliation remain separately reviewed Product acceptance gates.
The workflow publishes metadata and content digests, never application rows or credentials.

## Fresh live observations, not inherited issue text

Read-only catalog queries against pinned TEST `nmwhwngojosmagjuvxol` at
2026-09-11T08:49:56Z and Production `egehnijjpgijmccagxac` at 2026-09-11T08:50:15Z:

| Surface | TEST | Production | Disposition |
|---|---|---|---|
| Six catalog dual-sort unique indexes | Present | Present, identical definitions | Do not repeat #238 rollout |
| `tour_orders.paid_amount` | Present | Present | Earlier #362 absence is historical, not current truth |
| `create_tour_order` named arguments | Canonical signature | Same canonical signature | Do not repeat 0087 based on stale body |
| `expire_tour_order(uuid,uuid,text)` | Present | Absent at observation | ACTIVE_RUNTIME; verify exact main caller and prepare a separately authorized Product apply |
| Eight #41 order columns | Present | Absent | FUTURE_PRODUCT; isolate candidate lineage, not automatic Production adoption |
| Order triggers | Six enabled | None | Classify individually; do not DROP CASCADE or copy them wholesale |
| Assignment parent FKs | `(tenant_id, departure_id)` and `(tenant_id, staff_id)` | Single-id FKs | Product defense decision; never weaken TEST to match Production |
| Create/cancel function body hashes | Different | Different | Definition difference, not sufficient evidence of a behavioral bug |

The eight candidate columns are `deposit_mode_snapshot`, `upfront_required_amount`, `balance_due`,
`balance_due_at`, `balance_due_hours_snapshot`, `balance_collection_mode_snapshot`,
`cancellation_policy_snapshot`, and `refunded_amount`.

Production migration ledger subsequently lists `0101_catalog_rpc_close_public_and_anon_execute`
at `20260911084750`. This is only provider-ledger evidence; effective privileges must be read back.
Keep intentional `authenticated` and `service_role` access to the catalog RPCs. PUBLIC and direct anon
ACL entries are distinct; do not infer effective access solely from migration text.

## Exit criteria and remaining operations

- Bootstrap candidate replay + artifact is the first missing executable proof, not all of #298 done.
- Review each historical dependency as ACTIVE_RUNTIME or COMPATIBILITY_ONLY before canonical adoption.
- Compare the resulting schema/ACL evidence with fresh TEST and Production captures at the chosen source SHA.
- For #362, inventory callers and candidate ownership before removing any TEST-only object. Preserve #41
  in isolated candidate TEST; do not treat its parked PR as permission to destroy its schema.
- Reconciliation must use bounded forward-only Product changes. Record source SHA, exact project,
  preflight, rollback, actual apply, and read-back as separate completion events.
- Production migration/DDL/DML remains gated by named scope authorization. This work performs none.
- #298 and #362 stay open until their remaining acceptance is actually met.
