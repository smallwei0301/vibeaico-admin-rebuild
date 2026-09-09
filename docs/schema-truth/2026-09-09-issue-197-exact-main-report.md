# Schema Truth Report

- observed main: `49f328216b4c19ad6cc599c4d428d95ff7fa11eb`
- report digest: `2bbacb084cd146a2c9a56fbe82552bcb157a8c811c328d8c66df892421ff61df`
- overall: **DRIFT_OBSERVED**
- repo migrations: 40 files / `1061a4fd00eac45542626ed1ff1408c720d9aafa3eea05dea311f8dca5cf2e10`

## Migration ledger

| Environment | State | Count | Latest version | Latest name |
|---|---:|---:|---|---|
| TEST | PRESENT | 64 | 20260909005558 | 0094_tenant_payment_methods |
| PRODUCTION | PRESENT | 15 | 20260909022752 | 0094_tenant_payment_methods |

Comparison: **ENVIRONMENT_DIFF**

## Public schema fingerprints

| Kind | TEST count | Production count | Status |
|---|---:|---:|---|
| columns | 681 | 499 | ENVIRONMENT_DIFF |
| constraints | 286 | 187 | ENVIRONMENT_DIFF |
| views | 2 | 2 | MATCH |
| indexes | 136 | 91 | ENVIRONMENT_DIFF |
| policies | 77 | 73 | ENVIRONMENT_DIFF |
| routines | 262 | 207 | ENVIRONMENT_DIFF |
| triggers | 26 | 6 | ENVIRONMENT_DIFF |

## Explicit out-of-ledger evidence

- PRODUCTION: provider migration ledger contains identities not represented by current main migration files — `supabase:production/schema_migrations/2026-09-09T04:21:30Z`
- TEST: provider migration ledger contains identities not represented by current main migration files — `supabase:test/schema_migrations/2026-09-09T04:21:30Z`

## Safety

This report is read-only evidence. It is **not** authorization to apply a Production migration, DDL, DML, promote, rollback, or force-push. Fingerprint differences identify a truth gap; they do not prove which environment is correct.
