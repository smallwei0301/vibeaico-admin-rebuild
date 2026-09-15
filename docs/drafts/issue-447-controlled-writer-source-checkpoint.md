# Issue #447 controlled writer source checkpoint

Status: SOURCE_ONLY / NOT_AUTOMATION_READY

This checkpoint exists so the Product writer slice has a durable scope boundary while source CI runs.
It does not authorize or perform a Production database mutation.

Current source slice:

- trusted-main `PENDING_APPLY` release-plan builder;
- canonical migration-byte digests and plan-bound provider ledger versions;
- live provider ledger ↔ alias-map exact comparison;
- DB advisory transaction lock + post-lock ledger recheck;
- one atomic Management API mutable request;
- `APPLY_UNKNOWN` on mutable-call uncertainty, with no blind retry;
- post-apply provider-ledger readback before schema/ACL/RLS postcheck;
- legacy `run-migrations.mjs` Production path blocked while TEST behavior remains available.

Still required before `AUTOMATION_READY=true`:

1. exact-head source CI;
2. canonical TEST writer canary and counterexamples without Production writes;
3. trusted-main workflow orchestration, durable APPLY_UNKNOWN journal artifact and G7 schema/ACL/RLS readback;
4. dedicated Production writer credential availability / bypass audit;
5. Product Final Risk on exact release execution boundary;
6. final readiness verifier proving the above from trusted-main evidence.
