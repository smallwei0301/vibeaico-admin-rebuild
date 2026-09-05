# Agent-discovered Issue provenance preflight

Agent-created governance work must carry enough durable context for another Session to decide whether the
Issue is real, duplicated, in scope, and safe to continue. GitHub Actions must not be the first place that
a missing heading or empty evidence section is discovered.

The trusted `issue-provenance` workflow and the local command below use the same policy module:

```text
scripts/agents/issue-provenance-policy.mjs
```

## Run before creating an Issue

Save the proposed Issue body locally, then run:

```bash
npm run agent:issue:preflight -- --body /tmp/agent-discovered-issue.md
```

Success prints:

```text
ISSUE_PROVENANCE_PASS origin=agent
```

A missing file, malformed argument, missing exact heading, empty section, placeholder-only section, invalid
blocker answer, or incomplete requested／actual model line fails closed.

## Canonical Agent-discovered shape

A manually authored body may use:

```markdown
## Issue origin

AGENT_DISCOVERED

### Parent Issue / PR

Issue #123 / PR #456

### Discovered stage

TRIAGE

### Scope Firewall reason

Why this work belongs in governance rather than Product runtime.

### Why this cannot remain in the parent Issue

Why it needs one separate bounded Issue.

### Blocks current goal

YES

### Evidence

- github:issue#123
- github:pull/456

### Requested model / actual model

requested=Terra implementation + Sol audit；actual=unknown
```

GitHub's existing `.github/ISSUE_TEMPLATE/agent-discovered.yml` renders the origin label as
`### Issue origin`. Both `## Issue origin` and `### Issue origin` are therefore accepted, but the section's
first substantive value must be `AGENT_DISCOVERED`.

The seven remaining `###` headings are exact. For example, `### Live evidence` does not replace
`### Evidence`. This intentional strictness keeps the local CLI, Issue Form, and GitHub labeler from
developing separate dialects.

Heading presence alone is insufficient. Sections containing only values such as `none`, `TBD`, `pending`,
`unknown`, `-`, or an HTML comment are treated as empty.

`### Blocks current goal` accepts the three values already represented by manual bodies and the Issue Form:

```text
YES
NO
NO, backlog only
```

The model section must contain both:

```text
requested=<model or role>
actual=<verifiable model or unknown>
```

`actual=unknown` is correct when the platform cannot prove the served model. A prompt saying “use Terra”
is not evidence that Terra was actually served.

## Owner-created Issues

An Issue whose recognized origin section is not `AGENT_DISCOVERED` is classified as `owner-or-unknown`.
The Agent provenance fields are not imposed on Owner-directed Issues.

A stray mention of the word `AGENT_DISCOVERED` elsewhere in prose does not change the Issue origin.

## Trusted workflow behavior

On Issue `opened` or `edited`, the workflow sparse-checks out only the shared policy file from the current
default branch without retaining write credentials. It then manages only these provenance labels:

```text
origin:agent
origin:owner-or-unknown
governance:provenance-incomplete
```

The workflow remains the final live-state labeler. The local command exists to catch the same error before
Issue creation, reducing avoidable workflow runs, red labels, and follow-up edits.

## Safety

This preflight reads one Markdown file. It does not create or edit an Issue, execute TEST, connect to
Supabase, deploy Vercel, modify Production, send LINE messages, charge payments, or expose credentials.
