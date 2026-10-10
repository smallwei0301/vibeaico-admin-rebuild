# Plan a bounded design change

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

- Establish whether the requested task refines the incumbent surface or explicitly authorizes a new identity. Preserve by default.
- Read current canonical product truth, existing components, tokens, copy and representative visual evidence.
- Describe the user job, information hierarchy, primary action, realistic content and necessary responsive states.
- Prefer the existing design language and reusable components. Identify any proposed system-level change explicitly before implementation.
- Do not treat examples as orders to ignore existing design or invent product claims. Missing design documents do not change the boundary.
- Review semantics, keyboard access, contrast, focus, loading, error, empty and interruption/re-entry flows.
- Use the repo’s existing implementation, tests and independent-review gates for any separately authorized edits.
- Keep the result as design guidance unless a specific implementation or document action is requested.
