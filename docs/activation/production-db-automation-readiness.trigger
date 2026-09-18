# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 3
production_mutation_authorized: false
reason: Retrigger after installing the Supabase Production server root CA for verify-full writer credential proof and making NOT_EVIDENCED fail closed.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
