# Schema truth guardrails — #427

Date: 2026-09-14
Workstream: `MODEL_GOVERNANCE`
Status: active guardrail implementation

This decision extends the canonical-source rule already merged by PR #423. It does not change Product schema and does not authorize TEST or Production mutation.

## 1. Canonical migration source admission

Before any migration may be treated as an executable TEST or Production candidate, its exact bytes must already exist under current `origin/main:supabase/migrations/**`.

The source guard must reject:

- a migration that exists only on a feature branch or open PR;
- the same filename when local bytes differ from current `origin/main`;
- a caller-supplied SHA256 that differs from the current-main bytes;
- paths outside `supabase/migrations/NNNN_name.sql`;
- an unavailable or unverifiable current-main ref.

A passing source check means only `SOURCE_ADMITTED`. It explicitly sets `databaseMutationAuthorized=false`. Production still requires a separate named Owner authorization.

Example:

```bash
git fetch origin main
node scripts/agents/schema-truth-guardrails.mjs admit-migration \
  --repo-root . \
  --migration supabase/migrations/0107_example.sql \
  --target PRODUCTION \
  --main-ref origin/main
```

## 2. Three-way drift states

The guard consumes the existing repo-built / TEST / Production three-way truth surfaces. It classifies differences instead of flattening every non-match into one bucket.

- `MATCH`: checked repo, TEST and Production surfaces match and evidence is fresh.
- `EXPECTED_PENDING_TEST`: current main contains a new object not yet present in TEST or Production.
- `EXPECTED_PENDING_PRODUCTION`: current main and TEST match, while Production is still awaiting the same rollout.
- `INTENTIONAL_DIFFERENCE`: a difference is covered by an exact-object, exact-entry-digest, current-main-bound and unexpired exception.
- `EVIDENCE_STALE`: at least one environment snapshot is older than the configured evidence age. This is blocking.
- `EVIDENCE_INCOMPLETE`: repository-built truth was not actually established for a compared object. This is blocking.
- `DRIFT_BLOCKED`: an unexplained TEST/Production/main difference remains. This is blocking.

`TEST_ONLY`, `PRODUCTION_ONLY`, `TEST_PRODUCTION`, `REPO_PRODUCTION`, or a same-key definition mismatch are not normal rollout states. Without an exact active exception they become `DRIFT_BLOCKED`.

## 3. Intentional difference contract

An exception is not a folder, prefix, environment-wide waiver, or free-text note. It must name one exact schema-truth entry and contain:

```json
{
  "surface": "indexes",
  "key": "bookings.temporary_idx",
  "entryDigest": "<sha256 of the exact normalized comparison entry>",
  "issue": "#427",
  "owner": "smallwei0301",
  "reason": "bounded reconciliation reason",
  "expiresAt": "2026-09-15T04:00:00Z",
  "currentMainSha": "<40-char current main sha>"
}
```

If the schema entry changes, main changes, or the expiry time passes, the exception no longer hides the drift.

## 4. Evidence freshness

A schema comparison may not report `MATCH` from an old snapshot. The default guard window is 60 minutes; callers may choose a stricter or looser window up to 24 hours for read-only observation workflows.

Missing/unreadable input is a command failure, not a green result. Evidence tied to another main SHA is rejected.

Example:

```bash
node scripts/agents/schema-truth-guardrails.mjs drift-policy \
  --repo-fixture /safe/repo-built.json \
  --test-snapshot /safe/test.json \
  --production-snapshot /safe/production.json \
  --current-main-sha "$(git rev-parse origin/main)" \
  --max-age-minutes 60
```

An optional exceptions file uses `{ "entries": [...] }` and must contain only bounded entries matching the contract above.

## 5. Blocking rule

When the result is `EVIDENCE_STALE`, `EVIDENCE_INCOMPLETE`, or `DRIFT_BLOCKED`, no new schema change should advance to the next shared environment until the evidence or drift is resolved.

This rule prevents small unexplained differences from being buried under newer migrations. It does not instruct an Agent to make Production look like TEST and does not generate reconciliation SQL.

## 6. Scope boundary

This governance slice is source-only:

- no TEST or Production SQL is executed;
- no migration file is created or modified;
- no live tenant/customer data is read;
- no deployment is triggered intentionally;
- no Production authorization is implied.

Wiring this guard into a Product/database execution path that mutates a shared environment is a separate bounded change and must use the workstream/risk classification required by that execution path.
