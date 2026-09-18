# Production DB automation readiness activation

issue: 447
mode: protected-main-merge-trigger
activation_sequence: 3
production_mutation_authorized: false
reason: Retrigger after adding the pinned Supabase Root 2021 CA trust for verify-full and making credential-proof failure fail the job while preserving sanitized evidence.
purpose: Trigger the merged-main production-db-automation-readiness workflow on this protected main merge.
