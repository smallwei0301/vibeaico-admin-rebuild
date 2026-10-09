# Clarify product context

## Repository boundary: advisory design guidance only

Downstream adaptation for Issue #841. This reference provides design advice, not execution authority.
Current main canonical documents, CLAUDE Hard rules, existing components and their behavior,
src/styles/tokens.css, i18n, security rules and the user's actual permissions take precedence.
Preserve the incumbent design and authorized scope. Missing design documents do not imply a greenfield project.
Do not create or replace PRODUCT.md, DESIGN.md, sidecars or other project documentation automatically.
Review requests and visual selections do not authorize applying changes, installing tools, replacing dependencies,
downloading fonts/assets, changing settings, or publishing. Any implementation needs its own applicable authorization.
No external engine, hook, launcher, helper agent or operational fallback is enabled by these files.
Generic examples illustrate design concepts; adapt their values to existing tokens and their copy to i18n.
Accessibility suggestions do not waive repo tests, independent review or release gates.

## Guidance

- Read the current canonical product documents, incumbent screen, i18n and component conventions.
- Clarify the user, task, success criterion, real constraints and intended scope only where the answer is necessary.
- Keep facts, assumptions and proposed changes distinct. Do not invent commercial claims, customer data or product decisions.
- Missing PRODUCT.md is a context gap, not authorization to create it or replace existing design.
- A requested specification update follows existing documentation governance.
