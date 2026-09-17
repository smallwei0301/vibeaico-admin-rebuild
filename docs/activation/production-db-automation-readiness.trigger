# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 2
production_mutation_authorized: false
reason: Retrigger after fixing the unrelated promotion-stats test clock that kept main required check red.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
