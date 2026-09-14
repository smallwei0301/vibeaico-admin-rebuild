# Schema Truth read-only evidence capture

Date: 2026-09-14
Status: DECIDED / SOURCE IMPLEMENTATION
Issue: #434
Workstream: MODEL_GOVERNANCE

## Decision

Schema drift monitoring must not require database-write capability.

The capture runner uses Supabase Management API `POST /v1/projects/{ref}/database/query/read-only`, which executes through the platform read-only database path. It does not use the write-capable `/database/query` endpoint.

Only the two canonical refs are admitted:

- TEST: `nmwhwngojosmagjuvxol`
- PRODUCTION: `egehnijjpgijmccagxac`

Only the three existing checked-in contracts from `scripts/agents/schema-truth-evidence.mjs` may be sent:

1. `PUBLIC_SCHEMA_METADATA_SQL`
2. `ACL_METADATA_SQL`
3. `MIGRATION_LEDGER_SQL`

There is no CLI, environment-variable, file, stdin, or function parameter that accepts arbitrary SQL for capture.

## Evidence boundary

A successful capture contains metadata only:

- current `origin/main` SHA;
- checked-in query contract version and digest;
- environment and pinned project ref;
- UTC capture time;
- migration ledger identities and digest;
- public-schema surface counts and digests;
- public table/function ACL and RLS metadata;
- self-validating capture digest.

Application rows are not queried and are not included in evidence packets. Tokens are used only in the Authorization header and are never emitted in packet output or failure text.

TEST and Production packets are validated with the existing `normalizeMetadataEvidencePacket()` contract. Pair comparison reuses `compareMetadataEvidence()`; this change does not create a second drift definition.

## Failure semantics

The monitor fails closed on:

- a non-canonical environment/project target;
- a contract name outside the three checked-in queries;
- network/auth/HTTP failure;
- non-JSON or unexpected response shape;
- unknown metadata surfaces, count mismatch, duplicate metadata identities;
- stale or invalid current-main evidence;
- an evidence packet that cannot pass the existing normalizer.

A failed capture is never rewritten as `MATCH`.

## Credential and scheduling boundary

The CLI expects `SUPABASE_READONLY_ACCESS_TOKEN`. The token must be a Supabase Management API credential whose permission is read-only for the database endpoint.

No GitHub Actions schedule or secret is introduced by #434. A scheduled monitor may be added only after a read-only credential is explicitly provisioned for that purpose. Existing write-capable migration credentials must not be silently reused as the monitoring credential merely because they can authenticate.

## Non-goals

This decision does not:

- authorize TEST or Production DDL/DML/migration;
- reconcile any observed drift;
- alter Product schema or migrations;
- decide whether an intentional environment difference is acceptable;
- enable a scheduled workflow;
- change #104 Product Run measurement or #359 model-identity policy.
