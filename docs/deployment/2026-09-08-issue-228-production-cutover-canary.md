# Issue #228 — Production cutover Preview canary

Date: 2026-09-08

## Owner authorization

Owner authorized the Vercel Production cutover **canary stage** with these boundaries:

- Vercel credentials may be used only through a trusted GitHub Actions Secret or equivalent secret store.
- Build and verify the replacement path before disabling the old `main` Git Integration deployment trigger.
- Only after a successful canary may governance prepare the actual cutover.
- Old Vercel deployments must not be deleted.
- High-risk final review is routed to actual `gpt-6-astra`; Astra is reviewer-only, not Owner.

The durable Owner decision is also recorded on Issue #228.

## Live baseline before construction

```text
source base main: d5dda47cef4505e1456c466aaf73dda7ce1e7b60
Production hostname: vibeaico-admin-rebuild.vercel.app
Production deployment: dpl_6GWT6nKWCWKmPbHdyoPX5XS5zH3L
Production Git SHA: 26a46263a2eb42a9286c998b767f69d6db685d43
Production source: git
Production state: READY
```

The Production SHA is an ancestor of the source base. The live compare from Production to that `main` contains docs, governance scripts and tests, but no Product-runtime paths from the existing #228 classifier. Therefore this slice does **not** invent a runtime change merely to force a Production release.

## Why the first canary is Preview-only

The existing Git Integration still owns `main` Production deployments. Turning it off before proving the replacement path would create a release outage risk. At the same time, forcing a redundant Production deployment for a docs/governance-only delta would violate the efficiency goal this Issue exists to enforce.

The first canary therefore proves the dangerous mechanics without moving Production traffic:

```text
manual workflow on main
→ prove exact current main SHA
→ prove exact SHA required `check` is green
→ read Production hostname with VERCEL_TOKEN
→ validate current Production alias/project/repo/ref/SHA
→ prove complete local Git ancestry/diff
→ create one API-driven Git-backed Preview for the exact main SHA
→ wait for READY
→ verify Preview is NOT production and source/project/repo/SHA all match
→ save non-secret artifact
```

If any identity check fails, the canary is red and the old Git Integration stays unchanged.

## Files in this slice

- `.github/workflows/production-deploy-canary.yml`
- `scripts/ci/production-deploy-canary.mjs`
- `tests/unit/production-deploy-canary.228.test.ts`
- this document

No Product runtime, schema, auth, payment, notification or tenant data path is changed.

## Secret boundary

The workflow consumes only:

```text
secrets.VERCEL_TOKEN
```

Project/team IDs and hostnames are non-secret identifiers and are pinned in the workflow to prevent deploying the token against an arbitrary project supplied through workflow input.

The workflow never prints the token and the generated artifact contains only decision/baseline/deployment identity evidence.

A missing secret is a hard failure. The token must not be supplied as `workflow_dispatch` input because workflow inputs are not an appropriate secret store.

## Canary modes

### `observe`

Performs all read/evidence checks and creates no deployment. Useful for proving secret access, Production baseline identity and complete Git comparison.

### `preview_canary`

Performs the same admission checks, then creates exactly one Git-backed **Preview** from the admitted exact main SHA and verifies it reaches `READY` with the expected identity.

The current Production decision may truthfully be `SKIP / NON_RUNTIME_DELTA`; a deliberate Preview canary is still allowed because it does not move Production traffic and exists only to verify the future provider path.

## Explicitly impossible in this slice

The workflow contains no operation that can:

- create a Production-target deployment;
- promote or alias a deployment to Production;
- disable Vercel Git Integration;
- delete a Vercel deployment;
- mutate retention policy;
- mutate TEST/Production Supabase;
- send LINE/email/customer notifications;
- create payments or refunds.

Unit coverage statically locks the workflow against Production mutation verbs in addition to testing the controller behavior.

## Green canary definition

A `preview_canary` is green only when all are true:

1. dispatched from `main`;
2. provided SHA is a full SHA and still equals live `main`;
3. latest exact-SHA `check` is completed/success;
4. current Production hostname resolves to the expected project and trusted Git `main` deployment;
5. Production comparison base and current SHA both exist locally and ancestry is valid;
6. local changed-path range is complete;
7. Vercel accepts an API deployment from the exact Git SHA;
8. Preview reaches `READY`;
9. Preview target is not Production;
10. Preview source/project/Git owner/repo/SHA all match exactly.

`READY` alone is insufficient.

## What happens after a green canary

A separate high-risk cutover slice is then eligible to be prepared. It must still receive exact-head source CI, Sol audit and actual `gpt-6-astra` review before merge. That later slice may:

1. disable automatic `main` Git deployment only after the green canary evidence is attached;
2. add the controlled Production deployment path gated by newest-main SHA + required checks + #228 runtime classifier;
3. de-duplicate one exact main SHA to at most one Production deployment;
4. publish durable Production deployment status for Completion Truth;
5. keep at least the current and prior known-good rollback candidates.

Old deployment deletion remains out of scope even after cutover.

## Current external/tooling boundary

The connected GitHub API surface available to this session can create branches, commits, PRs and workflows but intentionally does not expose repository Actions Secret writes. The canary source can therefore be completed and reviewed without a secret; actually dispatching it requires `VERCEL_TOKEN` to be installed through an authorized GitHub secret-management surface. This is a tooling boundary, not a request for a new Owner decision.
