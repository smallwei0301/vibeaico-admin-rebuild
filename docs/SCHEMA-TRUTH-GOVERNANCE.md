# Schema truth governance

A migration file in Git, a column visible in a live database, and a provider migration-ledger row are
three different facts. Agents must not use one as proof of the other.

The source-only reporter `scripts/agents/schema-truth-report.mjs` compares strict, manually collected
read-only snapshots from TEST and Production with the exact bytes under `supabase/migrations/`. It does
not connect to Supabase, execute SQL, create a branch, or modify either database.

## Canonical schema authority (Owner decision 2026-09-10, #197)

For future schema direction, the authoritative target is **reviewed, rebuildable source on current `main`**:
canonical files under `supabase/migrations/` plus an explicit current Product contract. TEST and
Production are live evidence and reconciliation surfaces; neither environment is a whole-schema authority
that may be copied back into `main` merely because an object exists there.

The delivery direction is fixed as:

```text
Product intent -> reviewed main migration source -> TEST validation -> Production reconciliation
```

When TEST, Production, provider ledger, and `main` disagree, classify the difference by current Product
semantics before writing reconciliation SQL:

- `ACTIVE_RUNTIME`: current source/API/runtime proves the object is an active Product dependency. It must
  be reproducible from canonical `main` source.
- `FUTURE_PRODUCT`: a deliberate future contract not required by the current runtime/bootstrap. Preserve
  its design separately; live presence alone does not make it current canonical schema.
- `LEGACY_RETIRED`: historical schema with no current Product ownership. Do not copy it into the new-install
  canonical baseline merely because TEST or Production still carries it.
- `COMPATIBILITY_ONLY`: required only to replay immutable historical migrations or bridge a baseline
  cutover. Preserve only the compatibility contract and do not describe it as an active feature.

`TEST_ONLY`, `PRODUCTION_ONLY`, `OUT_OF_LEDGER`, `REPO_MISSING`, or same-key definition mismatch are
**observations, not migration directions**. A reconciliation migration is allowed only after the affected
object has a Product-semantic classification. Any such migration must be bounded and idempotent. Source
merge, TEST apply, and Production apply are separate Completion Truth events.

This decision does not assert that every object currently on `main` is automatically correct. It makes
`main` the single durable place where an approved schema decision must ultimately be represented. It also
does not authorize any Production DDL/DML/migration; those remain separately named Owner gates.

## Snapshot contract

Each snapshot is JSON schema version 1 and contains only:

- environment (`TEST` or `PRODUCTION`), observation time, project ref, and observed main SHA;
- migration ledger state and a digest of its ordered version list;
- count plus digest for public columns, constraints, views, indexes, policies, routines, and triggers;
- optional explicit `OUT_OF_LEDGER` observations with compact evidence references.

The reporter pins the two project references used by this repository:

```text
TEST        nmwhwngojosmagjuvxol
PRODUCTION  egehnijjpgijmccagxac
```

A correctly shaped snapshot from the wrong project fails closed. When either project changes, update the
pinned reference through a reviewed governance PR before collecting new evidence.

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
HEAD has the same SHA. It inventories every regular `.sql` file below `supabase/migrations/`, rejects the
`supabase` or migration root when either is a symbolic link, rejects nested symbolic links, verifies the
resolved migration directory remains inside the repository, normalizes path separators, sorts paths,
and hashes exact file bytes.

The same snapshots and migration bytes produce byte-identical JSON and Markdown. A filename or byte
change alters the repo manifest digest.

Comparison labels are deliberately narrow:

- `MATCH`: TEST and Production count plus digest are equal for that truth surface.
- `ENVIRONMENT_DIFF`: the observed values differ; it does not say which environment is correct.
- `LEDGER_ABSENT`: at least one environment proved the ledger relation is absent.
- `LEDGER_UNAVAILABLE`: at least one environment could not provide ledger evidence.
- `OUT_OF_LEDGER`: emitted only from an explicit snapshot observation. Fingerprint differences alone
  never create this claim.

## Migration identity admission

Issue #197 exposed a separate failure mode: a migration can exist only on a feature branch, be applied to
a live environment, and later never reach `main`. The provider ledger then contains an identity that the
repository cannot reproduce. Reusing an old four-digit prefix makes the ambiguity worse.

The existing required `repo-integrity-guard` therefore owns the source-side admission rules. It compares
the candidate head with its CI base revision and fails closed when:

- a file below `supabase/migrations/` does not use `NNNN_name.sql`;
- two files on the candidate head use the same four-digit prefix;
- a migration already present on the base revision is modified, deleted, or renamed;
- a newly added migration prefix is not greater than the largest migration prefix on the base revision.

These rules do **not** prove that TEST or Production already matches the repository. They only prevent new
source identities from making the historical drift harder to reconcile. Applying a migration to TEST or
Production remains a separate external action with its own authorization, exact project reference, live
ledger verification, and Completion Truth evidence.

A branch-only migration must never be described as durable schema truth merely because it exists in a PR
or because a provider ledger contains a similarly numbered row. `main` source truth, live schema truth,
and provider-ledger truth remain three separate surfaces until explicitly reconciled.

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
