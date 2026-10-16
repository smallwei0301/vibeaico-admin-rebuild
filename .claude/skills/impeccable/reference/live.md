# Review an interface in context

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

- Inspect the existing surface and its surrounding flow using only already-authorized read-only tools.
- Consider repeated use, long content, navigation interruption, dismissal, focus return and responsive behavior.
- For each suggestion state the target, proposed change, expected benefit and behavior that must be preserved.
- Do not infer Apply consent from a preview or upstream instructions. Ask or use the user’s actual specific authorization.
- No live-poll loop, overlay, manual-edit queue, apply helper or engine endpoint is part of this guidance.
