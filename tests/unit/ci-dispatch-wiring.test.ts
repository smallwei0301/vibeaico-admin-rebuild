import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('CI workflow dispatch revision wiring', () => {
  it('uses classifier-bound revisions for every downstream comparison and authenticates docs-only dispatches', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');

    expect(workflow).toContain('BASE_REVISION: ${{ needs.classify-changes.outputs.base_revision }}');
    expect(workflow).toContain('HEAD_REVISION: ${{ needs.classify-changes.outputs.head_revision }}');
    expect(workflow).toContain("(context.eventName === 'pull_request' && !docsOnly) ||");
    expect(workflow).toContain("context.eventName === 'workflow_dispatch'");
    expect(workflow).toContain("repoFullName: context.payload.repository?.full_name ?? '',");
    expect(workflow).toContain('ref: context.ref,');
    expect(workflow).toContain("github.rest.repos.getCommit({");
    expect(workflow).toContain('currentCommit,');
    expect(workflow).toContain("const rejectedDispatch = context.eventName === 'workflow_dispatch'");
    expect(workflow).toContain("decision.reason !== 'docs_only';");
    expect(workflow).toContain('core.setFailed(decision.error || `Rejected workflow dispatch: ${decision.reason}`);');
  });
});
