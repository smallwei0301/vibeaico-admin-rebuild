# Third-party design guidance: sources and notices

This is a downstream guidance-only adaptation for Issue #841, reconstructed as a NEW r02 candidate from verified PR #836 bytes. It is not restoration of the missing historical safe patch. All 15 skill entries remain available as advisory references. External engine scripts, four engine agents and their degraded helper references are removed. No engine or hook is installed or enabled.

## Immutable sources

- Impeccable by Paul Bakaus: [pbakaus/impeccable at ffeda44b00b1e39bd901621dcd3a7e44ba184ce1](https://github.com/pbakaus/impeccable/tree/ffeda44b00b1e39bd901621dcd3a7e44ba184ce1), from plugin/skills/impeccable and plugin/agents. Apache-2.0: [original license](impeccable/LICENSE). Exact upstream [NOTICE](impeccable/NOTICE.md) is retained.
- Emil Kowalski’s 14 design skills: [emilkowalski/skills at e8a175de22ae1e49370fc144c1f3bb9aeedf988d](https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d), from skills/. MIT: [original license](emil-design-eng/LICENSE).
- The Impeccable iOS and Android references derive from ehmo’s platform-design-skills, as identified by upstream NOTICE. Author: ehmo; license: MIT. The [license source at dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9](https://github.com/ehmo/platform-design-skills/blob/dc2be825d8b439caea78e9eaa8fb3ac23b0ff3e9/LICENSE) is preserved in [PLATFORM-DESIGN-LICENSE](impeccable/PLATFORM-DESIGN-LICENSE). This license pin is independently verified; it does not claim which ehmo revision Impeccable originally used.

[SOURCE-PROVENANCE.json](SOURCE-PROVENANCE.json) records every original imported source blob and its immutable upstream mapping. 81 source blobs match exactly; four existing differences are only newline or trailing-whitespace normalization. The floating provenance note is replaced here. All downstream modifications are identified below; no original test or review PASS is inherited.

## Downstream adaptation

- Removes all 11 files in the engine scripts tree, the four engine-only agents, and four degraded helper references
- Replaces operational workflows with design-only guidance, preserving reusable principles, critique material, examples, recipes and catalogs
- Removes automatic PRODUCT.md/DESIGN.md creation, assumed Apply consent, tool-instruction precedence, and operational fallback/install paths
- Adds the Repository boundary to every retained entry and reference. Current canonical rules, CLAUDE Hard rules, tokens.css, i18n, existing components, incumbent design, security and actual authorization take precedence
- Generic examples remain illustrative; they are not instructions to import dependencies, hardcode app values or bypass the project’s approved workflow

Original license and upstream NOTICE text are preserved without rewriting. This attribution does not imply endorsement by any upstream author. Local static checks do not establish Node22 CI, independent exact-head approval or full product acceptance.
