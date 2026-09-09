# Provider model evidence status

Governance Scoreboard contract v1 deliberately **does not have an executable provider served-model verifier**.

Therefore, until a later bounded change adds and tests such a verifier:

- committed review evidence may use `OPERATOR_ATTESTED` when an operator can truthfully attest the assigned model;
- use `UNKNOWN` when the actual model identity cannot be supported;
- committed evidence **must not use `PROVIDER_VERIFIED`**, even if someone can type a provider-looking execution reference by hand.

`PROVIDER_VERIFIED` is reserved in the evidence schema so the classification does not need to be renamed later. It becomes admissible only after the repository has an executable trusted verification path that can independently validate the provider/platform evidence and served model.

The required unit gate `tests/unit/provider-model-evidence-guard.test.ts` currently enforces this fail-closed state across every committed file under `docs/metrics/review-evidence/`.

This restriction affects Scoreboard truth only. It does **not** change the existing Final Risk merge policy or whether that separate policy accepts `OPERATOR_ATTESTED` evidence.
