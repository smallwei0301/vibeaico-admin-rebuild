# Describe an existing design system

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

- For a requested review, describe observed typography, semantic colors, spacing, radii, borders, shadows, layout and reusable component states.
- Use src/styles/tokens.css and existing components as the source of values; separate observed facts from proposals.
- Include keyboard focus, contrast, responsive behavior, loading, empty, error, disabled and confirmation states.
- Link current canonical documentation instead of creating a competing specification.
- Any requested document draft must name its audience and destination. Only the existing documentation workflow can establish a canonical update.
- Do not automatically write PRODUCT.md, DESIGN.md or a design JSON sidecar.
