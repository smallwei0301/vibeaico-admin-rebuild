# Use visual evidence thoughtfully

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

- Compare actual project screenshots, existing assets and component examples before recommending visual changes.
- Distinguish an illustrative sketch from a verified interface. A polished image does not prove behavior, accessibility or responsiveness.
- Use only authorized existing assets; generation, downloads, licensing and any upload remain separately governed.
- Record source, purpose, target and uncertainty. Do not invent asset provenance or bypass a denied tool.
