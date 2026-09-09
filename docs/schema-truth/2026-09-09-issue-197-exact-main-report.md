# Schema Truth Report

- observed main: `6d2678e1262c8cd507ea621632acefd8915059df`
- report digest: `ac672aaecaaf60e1e9e3e6e2c4f5aab7e04b68852908ec5cc9a2673b77cb258d`
- overall: **DRIFT_OBSERVED**
- repo migrations: 41 files / `d0ccca4f260260c2557bfc3dd6bb0795508ddd64beeefccf3a63ffb8800b0c47`

## Migration ledger

| Environment | State | Count | Latest version | Latest name |
|---|---:|---:|---|---|
| TEST | PRESENT | 64 | 20260909005558 | 0094_tenant_payment_methods |
| PRODUCTION | PRESENT | 15 | 20260909022752 | 0094_tenant_payment_methods |

Comparison: **ENVIRONMENT_DIFF**

## Public schema fingerprints

| Kind | TEST count | Production count | Status |
|---|---:|---:|---|
| columns | 731 | 549 | ENVIRONMENT_DIFF |
| constraints | 286 | 187 | ENVIRONMENT_DIFF |
| views | 2 | 2 | MATCH |
| indexes | 136 | 91 | ENVIRONMENT_DIFF |
| policies | 77 | 73 | ENVIRONMENT_DIFF |
| routines | 262 | 207 | ENVIRONMENT_DIFF |
| triggers | 26 | 6 | ENVIRONMENT_DIFF |

## Explicit out-of-ledger evidence

- PRODUCTION: provider migration ledger contains identities not represented by current main migration files — `supabase:production/schema_migrations/2026-09-09T05:37:41Z`
- TEST: provider migration ledger contains identities not represented by current main migration files — `supabase:test/schema_migrations/2026-09-09T05:37:41Z`

## Safety

This report is read-only evidence. It is **not** authorization to apply a Production migration, DDL, DML, promote, rollback, or force-push. Fingerprint differences identify a truth gap; they do not prove which environment is correct.
