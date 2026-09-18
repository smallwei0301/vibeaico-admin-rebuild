# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 5
production_mutation_authorized: false
reason: Retrigger after pinning identity, SET ROLE and migration-ledger read to one reserved PostgreSQL connection.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
