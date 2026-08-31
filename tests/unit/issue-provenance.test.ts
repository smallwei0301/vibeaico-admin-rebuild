import { describe, expect, it } from 'vitest';

// Keep the workflow's parser and its fixtures in the same repository module so
// API-created Issues and Issue Forms cannot silently drift apart.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { classifyIssueProvenance } = require('../../scripts/ci/issue-provenance.cjs') as {
  classifyIssueProvenance: (body: string) => { isAgent: boolean; missing: string[] };
};

describe('Issue provenance parser', () => {
  it('accepts a complete Issue Form body', () => {
    const body = [
      '### Issue origin', 'AGENT_DISCOVERED',
      '### Parent Issue / PR', '#123 / PR #456',
      '### Discovered stage', 'AUDIT',
      '### Scope Firewall reason', 'Security, cross-tenant, data-loss, payment, refund, permission or real-notification risk',
      '### Why this cannot remain in the parent Issue', 'The parent scope cannot safely own this migration.',
      '### Blocks current goal', 'Yes',
      '### Evidence', 'file.ts:10 — failing assertion',
      '### Requested model / actual model', 'requested=Terra, actual=unknown',
    ].join('\n');
    expect(classifyIssueProvenance(body)).toEqual({ isAgent: true, missing: [] });
  });

  it('accepts the canonical API-created key-value body', () => {
    const body = [
      'ISSUE_ORIGIN: AGENT_DISCOVERED',
      'PARENT_ISSUE / PR: #123 / PR #456',
      'DISCOVERED_STAGE: AUDIT',
      'SCOPE_FIREWALL_REASON: security risk',
      'WHY_SEPARATE_FROM_PARENT: separate ownership boundary',
      'BLOCKS_CURRENT_GOAL: Yes',
      'EVIDENCE: file.ts:10',
      'REQUESTED_MODEL / ACTUAL_MODEL: requested=Terra, actual=unknown',
    ].join('\n');
    expect(classifyIssueProvenance(body)).toEqual({ isAgent: true, missing: [] });
  });

  it('does not classify an incidental mention as an agent Issue', () => {
    expect(classifyIssueProvenance('The docs mention AGENT_DISCOVERED as an example.'))
      .toEqual({ isAgent: false, missing: [] });
  });

  it('reports a blank required field instead of accepting a heading', () => {
    const body = [
      '### Issue origin', 'AGENT_DISCOVERED',
      '### Parent Issue / PR', '',
      '### Discovered stage', 'AUDIT',
      '### Scope Firewall reason', 'security risk',
      '### Why this cannot remain in the parent Issue', 'separate boundary',
      '### Blocks current goal', 'Yes',
      '### Evidence', 'file.ts:10',
      '### Requested model / actual model', 'requested=Terra, actual=unknown',
    ].join('\n');
    expect(classifyIssueProvenance(body)).toEqual({
      isAgent: true,
      missing: ['Parent Issue / PR'],
    });
  });
});
