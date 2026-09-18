# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 6
production_mutation_authorized: false
reason: Retrigger after proving owner ledger privileges by catalog OID so the login writer never resolves a restricted schema name.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
