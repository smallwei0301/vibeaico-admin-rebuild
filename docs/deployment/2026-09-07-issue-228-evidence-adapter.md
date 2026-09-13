# Issue #228 — Production evidence adapter, source-only slice

Date: 2026-09-07

## Purpose

This slice prepares trustworthy inputs for the already-merged Production deploy decision policy. It still performs **no Vercel network request and no deployment**.

The future workflow will fetch one Vercel response itself, pass it into this adapter, and let local Git prove the release range.

## Production baseline: resolve the live hostname

Do not choose the baseline by sorting deployment history for the newest `READY` record. Rollback can repoint the Production alias to an older deployment while newer READY builds remain in history.

The authoritative read is:

```text
GET /v13/deployments/{production-hostname}
```

Vercel documents `idOrUrl` as accepting a deployment ID or hostname. Before trusting the returned Git SHA, the adapter requires:

- deployment target is `production`;
- deployment is `READY`;
- deployment `source` is `git` during this pre-cutover phase;
- expected Production hostname is in the deployment aliases;
- expected Vercel project ID matches;
- Git owner, repository and ref match this repo and `main`;
- Git commit SHA is a valid full SHA.

If any of those checks fail, the result is:

```text
BLOCK / PRODUCTION_BASELINE_UNTRUSTED
```

It is not treated as a brand-new project with no baseline.

### Why `source=git` is required for now

Before the replacement deployment path exists, the only baseline source this adapter can independently identify is Vercel Git Integration. Accepting a manually-created/CLI deployment merely because it carries Git-looking metadata would weaken the baseline identity check.

When Issue #228 later introduces the controlled deployment adapter, that path must create a durable repository-verifiable attestation tying:

```text
deployment id <-> exact main SHA <-> successful Production result
```

Only then may the baseline resolver accept that new source. The correct transition is to add stronger attestation, not to silently remove the `source=git` check.

## Complete changed-path evidence: use local Git

GitHub's Compare REST API cannot prove changed-file completeness for large ranges: its changed-file list is capped at 300 files and is shown only on the first page when commit pagination is used.

The future runner therefore fetches both commits and executes locally:

```text
git cat-file -e <production>^{commit}
git cat-file -e <main>^{commit}
git merge-base --is-ancestor <production> <main>
git diff --name-status -z --find-renames <production>..<main>
```

`production-deploy-evidence.mjs` parses the NUL-delimited `--name-status` output. Rename and copy records preserve both paths. Therefore:

```text
src/foo.ts -> docs/foo.ts
```

still contains `src/foo.ts` and remains a runtime delta.

Missing shallow-history commits or non-ancestor baselines block the comparison. A diff/parse failure after ancestry is proven sets `changedPathsComplete=false`; the existing decision layer then fails safe toward `WOULD_DEPLOY` instead of a silent skip.

## Evidence flow

```text
resolved Production hostname response
        |
        v
validate source/alias/project/Git owner/repo/ref/SHA
        |
        v
required GitHub check state + newest main SHA
        |
        v
local Git ancestry + complete name-status range
        |
        v
production-deploy-decision.mjs
        |
        +-- WAIT
        +-- BLOCK
        +-- SKIP
        +-- WOULD_DEPLOY
```

There is intentionally no `DEPLOY` action in either module.

## Additional classifier hardening

The decision layer now rejects malformed/partial path evidence instead of filtering it away. Non-string paths, control characters, absolute paths and `..` traversal are not eligible to prove `NON_RUNTIME_DELTA`; they become classifier failure and fail safe toward `WOULD_DEPLOY`.

## What remains after this slice

A later, separately reviewed workflow adapter still needs to:

1. wait for trusted required checks on the newest `main` SHA;
2. fetch the Production hostname from Vercel using an authorized GitHub secret or equivalent trusted credential;
3. ensure the runner has both Git commits available;
4. call this evidence adapter;
5. publish a durable decision status/artifact;
6. only for `WOULD_DEPLOY`, call the real deployment adapter;
7. make that deployment adapter emit a durable deployment-id-to-main-SHA attestation;
8. prove a canary before disabling existing Vercel Git Integration.

Workflow changes and real Vercel calls are outside this source-only slice and may require stronger Astra review.

## Safety

- no Vercel API request from repository code;
- no deployment, promote, rollback, alias mutation, retention change or delete;
- no GitHub secret write;
- no TEST/Production database operation;
- no Product runtime change;
- no payment/refund/LINE/email/customer notification.
