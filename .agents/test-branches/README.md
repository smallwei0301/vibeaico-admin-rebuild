# Supabase Preview Branch lease evidence

This directory stores metadata only. Never commit URLs with credentials, access tokens, API keys,
anon keys, service-role keys, passwords, database connection strings, or cost-confirmation IDs.

Maximum active leases: 2. Maximum lease duration: 120 minutes. A delete request is
`REQUESTED_UNVERIFIED`; only a live branch list that no longer contains the branch may be recorded as
`VERIFIED_DESTROYED`.

Validate with `node scripts/ci/supabase-branch-lease-policy.mjs --check-dir .agents/test-branches`.
