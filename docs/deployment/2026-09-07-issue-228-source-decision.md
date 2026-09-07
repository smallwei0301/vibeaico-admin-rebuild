# Issue #228 — Production deploy decision layer, source-only slice

Date: 2026-09-07

## Goal of this slice

Prepare the decision logic needed to replace Vercel's current `main` Git Integration trigger without performing any deployment or changing the integration yet.

This slice answers only:

```text
Should the newest CI-verified main SHA be skipped, blocked, waited on, or become a WOULD_DEPLOY candidate?
```

It deliberately does **not** answer how to authenticate to Vercel or how to switch off Git Integration.

## Why the comparison range starts at last Production

A parent-only comparison is unsafe when several commits land quickly.

Example:

```text
Production = A
A -> B   runtime change
B -> C   docs-only change
```

If B's candidate is cancelled when C arrives and C checks only `B..C`, the system would incorrectly skip deployment and lose the runtime change from B.

The future adapter must therefore compare:

```text
last successfully deployed Production SHA .. newest verified main SHA
```

The pure policy requires `comparisonBaseSha === lastProductionSha` for exactly this reason.

## Decision order

`scripts/ci/production-deploy-decision.mjs` applies these gates:

1. reject malformed SHA/check evidence;
2. skip a candidate that is no longer current `main`;
3. wait for pending required CI and block failed/cancelled CI;
4. skip an exact SHA already in Production;
5. if there is no known Production baseline, fail safe toward `WOULD_DEPLOY`;
6. require the runtime comparison to begin at the last successful Production SHA;
7. unknown/empty diff fails safe toward `WOULD_DEPLOY`;
8. a verified non-runtime range becomes `POLICY_SKIP` (`SKIP / NON_RUNTIME_DELTA`);
9. a verified runtime range becomes `WOULD_DEPLOY / RUNTIME_DELTA`.

There is intentionally no `DEPLOY` action in this module.

## Runtime boundary

The policy imports `RUNTIME_PATHS` from the existing `scripts/ci/vercel-ignore-build.mjs` instead of creating a second path allowlist.

This remains conservative. Any change under `src/**` counts as runtime, including a comment-only source edit. That means this slice is safe but not maximally aggressive. A future artifact-level equivalence check may reduce those false positives, but it must not be invented without reproducible build evidence.

## Future adapter responsibilities

A later PR may connect this pure policy to a GitHub Actions workflow only after its input sources are specified and tested:

- authoritative newest `main` SHA;
- required CI/completion state;
- last successful Production deployment SHA;
- full changed-file range from that Production SHA to current main;
- concurrency keyed so stale candidates stop before contacting Vercel;
- durable result consumed by Completion Truth.

The real Vercel deploy step additionally requires an authorized repository secret or equivalent trusted authentication path. The project credential observed in the Owner-authorized Drive document must never be copied into repository source, PR text, logs, or workflow YAML.

## Cutover boundary

Existing Vercel Git Integration remains enabled. It must not be disabled until a real canary proves that the replacement path can deploy one exact verified main SHA and report its Production result durably.

Old deployment cleanup and retention changes are separate irreversible/provider actions and are not part of this slice.

## Safety

- no Vercel API call;
- no deploy/promote/rollback/delete;
- no GitHub repository secret write;
- no TEST/Production database action;
- no Product runtime change;
- no payment/refund/LINE/email/customer notification.
