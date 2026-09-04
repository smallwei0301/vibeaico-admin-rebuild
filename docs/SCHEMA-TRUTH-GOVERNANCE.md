# Schema truth governance

A migration file in Git, a column visible in a live database, and a provider migration-ledger row are
three different facts. Agents must not use one as proof of the other.

The source-only reporter `scripts/agents/schema-truth-report.mjs` compares strict, manually collected
read-only snapshots from TEST and Production with the exact bytes under `supabase/migrations/`. It does
not connect to Supabase, execute SQL, create a branch, or modify either database.

## Snapshot contract

Each snapshot is JSON schema version 1 and contains only:

- environment (`TEST` or `PRODUCTION`), observation time, project ref, and observed main SHA;
- migration ledger state and a digest of its ordered version list;
- count plus digest for public columns, constraints, views, indexes, policies, routines, and triggers;
- optional explicit `OUT_OF_LEDGER` observations with compact evidence references.

Unknown fields are rejected. This intentionally blocks raw table rows, customer information, connection
strings, keys, and ad-hoc notes from entering the report. Evidence references are identifiers such as
`supabase:test/schema-fingerprint`, not URLs or credentials.

Migration ledger states have different meanings:

- `PRESENT`: the relation was read and count/latest/digest are available.
- `ABSENT`: the relation was proved not to exist; count/latest/digest must be null.
- `UNAVAILABLE`: the query could not be completed; this must not be rewritten as “no incident” or
  “ledger absent.”

## Deterministic comparison

The reporter verifies that both snapshots use the exact requested main SHA and that the checked-out Git
HEAD has the same SHA. It inventories every regular `.sql` file below `supabase/migrations/`, rejects
symlinks, normalizes path separators, sorts paths, and hashes exact file bytes.

The same snapshots and migration bytes produce byte-identical JSON and Markdown. A filename or byte
change alters the repo manifest digest.

Comparison labels are deliberately narrow:

- `MATCH`: TEST and Production count plus digest are equal for that truth surface.
- `ENVIRONMENT_DIFF`: the observed values differ; it does not say which environment is correct.
- `LEDGER_ABSENT`: at least one environment proved the ledger relation is absent.
- `LEDGER_UNAVAILABLE`: at least one environment could not provide ledger evidence.
- `OUT_OF_LEDGER`: emitted only from an explicit snapshot observation. Fingerprint differences alone
  never create this claim.

## Command

```bash
npm run agent:schema-truth:report -- report \
  --test-snapshot /safe/path/test.json \
  --production-snapshot /safe/path/production.json \
  --repo-root . \
  --current-main-sha "$(git rev-parse HEAD)" \
  --json-out /safe/path/schema-truth.json \
  --markdown-out /safe/path/schema-truth.md
```

Outputs are local artifacts. A reviewed governance PR is required before any selected evidence is stored
in the repository.

## Safety boundary

A schema truth report is not authorization to apply a Production migration, DDL, DML, seed, promote,
rollback, payment, notification, or force-push. It must not generate migration SQL. A difference means
“more evidence or an explicit decision is required,” not “make Production look like TEST.”

Governance work uses `TEST_PROFILE=SOURCE_ONLY`. It must not take the shared canonical TEST lane from a
Product session merely to regenerate this report.
