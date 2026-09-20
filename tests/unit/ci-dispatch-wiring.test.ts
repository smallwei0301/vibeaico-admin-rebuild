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
    expect(workflow).toContain("group: ${{ needs.classify-changes.outputs.run_test_validation == 'true' && 'shared-test-supabase-integration' || needs.classify-changes.outputs.docs_only == 'true' && format('docs-integration-{0}', github.run_id) || format('source-only-integration-{0}', github.run_id) }}");
    expect(workflow.match(/needs\.classify-changes\.outputs\.docs_only == 'true' && needs\.classify-changes\.outputs\.run_test_validation != 'true'/g)).toHaveLength(3);
    expect(workflow.match(/needs\.classify-changes\.outputs\.docs_only != 'true' \|\| needs\.classify-changes\.outputs\.run_test_validation == 'true'/g)).toHaveLength(4);
  });

  it('emits raw shared TEST evidence only after a trusted main_manual run and never overclaims cleanup or AUTHZ coverage', () => {
    const workflow = readFileSync(resolve(process.cwd(), '.github/workflows/ci.yml'), 'utf8');
    const e2e = workflow.indexOf('name: Run E2E tests');
    const emit = workflow.indexOf('name: Emit trusted-main shared TEST raw evidence');
    const upload = workflow.indexOf('name: Upload trusted-main shared TEST raw evidence');

    expect(e2e).toBeGreaterThan(0);
    expect(emit).toBeGreaterThan(e2e);
    expect(upload).toBeGreaterThan(emit);
    expect(workflow).toContain("github.event_name == 'workflow_dispatch'");
    expect(workflow).toContain("github.ref == 'refs/heads/main'");
    expect(workflow).toContain("inputs.dispatch_reason == 'main_manual'");
    expect(workflow).toContain('test "$MAIN_SHA" = "$EXPECTED_HEAD"');
    expect(workflow).toContain("url.hostname !== 'nmwhwngojosmagjuvxol.supabase.co'");
    expect(workflow).toContain("status: 'SHARED_TEST_RUN_VERIFIED'");
    expect(workflow).toContain("cleanupClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS'");
    expect(workflow).toContain("authzCoverageClaim: 'NOT_INFERRED_FROM_WORKFLOW_SUCCESS'");
    expect(workflow).toContain('databaseMutationAuthorized: false');
    expect(workflow).toContain('productionMutationPerformed: false');
    expect(workflow).not.toContain("cleanupClaim: 'PASSED'");
    expect(workflow).not.toContain("authzCoverageClaim: 'PASSED'");
  });
});
