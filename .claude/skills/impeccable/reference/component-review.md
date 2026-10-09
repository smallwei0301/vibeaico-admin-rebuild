# Component fidelity review

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

- Compare existing component anatomy, spacing, typography, states, focus and touch behavior with the approved project reference.
- Separate visual mismatch, accessibility defect and behavior regression. Use exact targets and observed evidence.
- Review loading, error, empty, disabled and populated states, long labels, keyboard interactions and narrow viewports.
- A comparison image is evidence about appearance; it does not permit replacing factual content or an incumbent component.
- Document unresolved findings and evidence limits. Use the repo independent-review process when implementation is requested.
