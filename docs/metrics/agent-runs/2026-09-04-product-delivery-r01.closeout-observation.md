# Legacy Run 3 closeout observation — immutable sidecar

> Run: `2026-09-04-product-delivery-r01`
>
> Evidence assembled for PR #224 at: `2026-09-07T02:38:45Z`
>
> Disposition: `FROZEN_LEGACY_V3 / HISTORICAL_NON_COMPARABLE / NOT_GRADED`

## Why this is a sidecar instead of a ledger rewrite

`docs/decisions/2026-09-07-owner-governance-alignment.md` requires historical Delivery Truth v2/v3 ledgers to remain read-only. Therefore the legacy JSON and generated Markdown are intentionally **not** rewritten into a fake terminal score.

The preserved ledger is:

```text
path: docs/metrics/agent-runs/2026-09-04-product-delivery-r01.json
blob: a0fbe424b589201c4cec6db902fbb4d20924f02a
schemaVersion: 2
deliveryTruthVersion: 3
status: IN_PROGRESS
endedAt: null
main.endSha: null
```

Those old fields describe the historical record as it was written. They are not proof that the Run is still allowed to accept new Product work.

## Reproducible closeout-window evidence

The freeze candidate was built from this verified `main` base:

```text
6f9318d46d863934ecd8874b3be21b6c9feaf0c0
```

A live GitHub PR search immediately before the freeze work found **zero open PRs** referencing:

```text
RUN_ID: 2026-09-04-product-delivery-r01
```

Transient repository-wide open-Issue/open-PR totals are intentionally not frozen into this artifact because parallel sessions continue to create and close work while the evidence is assembled. The zero-member check is the admission fact that matters.

The executable freeze becomes effective only when the policy reaches `main`; until then this file is candidate evidence, not a claim that GitHub is already enforcing it.

## Truth that remains intentionally unresolved

This sidecar does not invent or backfill:

- actual token or weekly-usage values;
- first-pass percentage metrics that were not captured durably;
- authenticated Production acceptance for Product slices;
- shipped-unit counts that were never proven by the five-stage Production truth ladder;
- canonical Issue identity for legacy free-form claim subjects.

The historical v3 report remains `NOT_GRADED`. Retrospectives may re-score/review it with the existing tools, but must not rewrite its original bytes to manufacture comparability.

## Admission freeze

`scripts/agents/run-admission-policy.mjs` marks this Run frozen for new counted `SLICE` or `STANDALONE` membership. Local PR preflight consumes the shared lane validator, and the trusted-main GitHub WIP Guard consumes that same validator before writing `Agent WIP Policy`.

Historical, governance, or explicitly non-counted retrospective references remain allowed. The freeze is forward-looking and does not retroactively fail merged PRs.

## Safety

This observation and admission freeze perform no Product runtime change, TEST/Production database mutation, Vercel manual deploy/promote/rollback, payment, refund, LINE send, email send, or customer notification.
