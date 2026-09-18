# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 4
production_mutation_authorized: false
reason: Retrigger after keeping the login writer least-privilege and reading the migration ledger only after SET ROLE production_migration_owner.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
