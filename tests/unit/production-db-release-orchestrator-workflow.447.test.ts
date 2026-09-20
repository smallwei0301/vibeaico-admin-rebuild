import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const source = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');

function position(text: string) {
  const index = source.indexOf(text);
  expect(index, `missing orchestrator workflow contract: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Production DB trusted-main release orchestrator workflow #447', () => {
  it('defaults to a collect graph without writer credentials or receipt creation', () => {
    const workflow = parse(source);
    expect(workflow.on.workflow_dispatch.inputs.mode.default).toBe('collect');
    for (const name of ['g2', 'g4-backup', 'g4-restore', 'collect']) {
      const job = workflow.jobs[name];
      expect(job.if).toBe("${{ inputs.mode == 'collect' }}");
      expect(job.environment).toBeUndefined();
      expect(JSON.stringify(job)).not.toMatch(/PRODUCTION_DB_WRITER_URL|init-state|mjs prepare|mjs execute/);
    }
    expect(workflow.jobs.prepare.needs).toBe('admission');
    expect(workflow.jobs.prepare.if).toBe("${{ inputs.mode == 'execute' }}");
    expect(workflow.jobs.execute.if).toBe("${{ inputs.mode == 'execute' && needs.prepare.result == 'success' }}");
    expect(JSON.stringify(workflow.jobs.collect)).toContain('production-db-review-bundle-');
  });

  it('validates the attempt-bound frozen bundle before live Final Risk and preparation', () => {
    const verify = position('- name: Verify source provenance and frozen packet bindings');
    const review = position('- name: Reconstruct G5 FINAL_RISK from live GitHub');
    expect(verify).toBeLessThan(review);
    expect(review).toBeLessThan(position('- name: PREPARE controlled Production DB attempt'));
    const prepare = parse(source).jobs.prepare;
    const text = JSON.stringify(prepare);
    expect(text).toContain('listJobsForWorkflowRunAttempt');
    expect(text).toContain('assertReviewBundle');
    expect(text).toContain('steps.provenance.outputs.attempt');
    expect(text).not.toContain('base-packet');
    expect(text).not.toContain('assemble-production-db-release-evidence.mjs');
  });

  it('is manual, globally serialized and read-only at GitHub permission level', () => {
    expect(source).toContain('workflow_dispatch:');
    expect(source).not.toContain('pull_request:');
    expect(source).not.toContain('\npush:');
    expect(source).toContain('contents: read');
    expect(source).toContain('checks: read');
    expect(source).toContain('actions: read');
    expect(source).toContain('pull-requests: read');
    expect(source).toContain('group: production-db-controlled-release');
    expect(source).toContain('cancel-in-progress: false');
  });

  it('requires exact trusted main and AUTOMATION_READY before any writer credential is exposed', () => {
    const readyGate = position('- name: Require machine POLICY_GATED_ACTIVE before any release evidence job');
    const firstWriterSecret = position('PRODUCTION_DB_WRITER_URL: ${{ secrets.PRODUCTION_DB_WRITER_URL }}');
    expect(readyGate).toBeLessThan(firstWriterSecret);
    expect(source).toContain("test \"$GITHUB_REF\" = 'refs/heads/main'");
    expect(source).toContain('git rev-parse origin/main');
    expect(source).toContain("readiness.status !== 'AUTOMATION_READY'");
    expect(source).toContain("readiness.authorizationMode !== 'POLICY_GATED_ACTIVE'");
    expect(source).toContain("readiness.perRunOwnerApproval !== 'NOT_REQUIRED'");
    expect(source).toContain("evidence.writer?.projectBoundWriterCredentialPresent !== true");
    expect(source).toContain("evidence.writer?.writerTransport !== 'POSTGRES_PROJECT_BOUND'");
    expect(source).not.toContain('${{ secrets.SUPABASE_ACCESS_TOKEN }}');
  });

  it('accepts readiness only from the trusted readiness workflow on main with exact SHA', () => {
    expect(source).toContain("run.name !== 'production-db-automation-readiness'");
    expect(source).toContain("!['workflow_dispatch', 'push'].includes(run.event)");
    expect(source).toContain("run.head_branch !== 'main'");
    expect(source).toContain("String(run.head_sha || '').toLowerCase() !== expected");
    expect(source).toContain("run.status !== 'completed' || run.conclusion !== 'success'");
  });

  it('blocks cross-run replay whenever this releaseId already has durable attempt evidence', () => {
    const replayGuard = position('- name: Reject any prior durable attempt for this releaseId');
    const readyGate = position('- name: Verify AUTOMATION_READY run provenance');
    expect(replayGuard).toBeLessThan(readyGate);
    expect(source).toContain('github.rest.actions.listArtifactsForRepo');
    expect(source).toContain('prepared-production-db-attempt-${releaseId}-');
    expect(source).toContain('production-db-apply-result-${releaseId}-');
    expect(source).toContain('production-db-terminal-result-${releaseId}-');
    expect(source).toContain('!artifact.expired');
    expect(source).toContain('DURABLE_PREPARED_ATTEMPT_EXISTS');
  });

  it('reconstructs G2/G4/G1/G5 from canonical evidence instead of workflow-authored PASS flags', () => {
    expect(source).toContain('uses: ./.github/workflows/agent-schema-drift-watch.yml');
    expect(source).toContain('artifact_suffix: g2');
    expect(source).toContain('uses: ./.github/workflows/agent-production-db-backup-observer.yml');
    expect(source).toContain('uses: ./.github/workflows/production-db-restore-rehearsal.yml');
    expect(source).toContain('supabase/production-db-impact-manifest.json');
    expect(source).toContain('assemble-production-db-release-evidence.mjs consistency');
    expect(source).toContain('assemble-production-db-release-evidence.mjs recovery');
    expect(source).toContain('buildProductionDbSourceEvidenceFromGithub');
    expect(source).toContain('buildProductionDbFinalRiskEvidenceFromGithub');
    expect(source).toContain('production-db-release-orchestrator.mjs final-packet');
  });

  it('binds G3 to a successful main workflow_dispatch run and the exact release plan identity', () => {
    expect(source).toContain("run.name !== 'ci'");
    expect(source).toContain("run.event !== 'workflow_dispatch'");
    expect(source).toContain("run.head_branch !== 'main'");
    expect(source).toContain("run.status !== 'completed' || run.conclusion !== 'success'");
    expect(source).toContain('production-db-g3-evidence-${{ inputs.expected_main_sha }}-${{ inputs.g3_run_id }}');
    expect(source).toContain("plan.releaseId !== process.env.RELEASE_ID");
    expect(source).toContain("plan.planDigest !== test.planDigest");
    expect(source).toContain("test.status !== 'TEST_VERIFIED'");
    expect(source).toContain("String(test.sourceRunId) !== String(process.env.G3_RUN_ID)");
  });

  it('durably persists PREPARE before EXECUTE and re-downloads the exact prepared envelope', () => {
    const prepare = position('- name: PREPARE controlled Production DB attempt');
    const persist = position('- name: Durably persist prepared attempt before any mutable request');
    const executeJob = position('  execute:');
    const reload = position('- name: Re-download durable prepared attempt');
    const execute = position('- name: EXECUTE controlled Production DB attempt');
    const persistApply = position('- name: Persist apply result or APPLY_UNKNOWN stop marker');
    expect(prepare).toBeLessThan(persist);
    expect(persist).toBeLessThan(executeJob);
    expect(executeJob).toBeLessThan(reload);
    expect(reload).toBeLessThan(execute);
    expect(source).toContain('prepared-production-db-attempt-${{ inputs.release_id }}-${{ github.run_id }}');
    expect(source).toContain('production-db-release-orchestrator.mjs prepare');
    expect(source).toContain('production-db-release-orchestrator.mjs execute');
    const executeBlock = source.slice(execute, persistApply);
    expect(executeBlock).toContain('$RUNNER_TEMP/prepared/production-db-final-release-packet.json');
    expect(executeBlock).toContain('$RUNNER_TEMP/prepared/prepared-production-db-attempt.json');
    expect(source).toContain('retention-days: 90');
  });

  it('persists uncertainty and runs G7 only after a successful controlled execute', () => {
    const execute = position('- name: EXECUTE controlled Production DB attempt');
    const persistApply = position('- name: Persist apply result or APPLY_UNKNOWN stop marker');
    const g7 = position('  g7:');
    const postcheck = position('  postcheck:');
    expect(execute).toBeLessThan(persistApply);
    expect(persistApply).toBeLessThan(g7);
    expect(g7).toBeLessThan(postcheck);
    expect(source).toContain("if: ${{ needs.execute.result == 'success' }}");
    expect(source).toContain('artifact_suffix: g7');
    expect(source).toContain('production-db-apply-result-${{ inputs.release_id }}-${{ github.run_id }}');
    expect(source).toContain('production-db-release-orchestrator.mjs postcheck');
    expect(source).toContain('production-db-terminal-result-${{ inputs.release_id }}-${{ github.run_id }}');
    expect(source).toContain('if: ${{ always() }}');
  });

  it('uses the same vendored Supabase CA bundle in PREPARE and EXECUTE writer jobs', () => {
    expect(source.match(/NODE_EXTRA_CA_CERTS: \$\{\{ github\.workspace \}\}\/config\/supabase-production-root-bundle\.crt/g)?.length).toBe(2);
    expect(source.match(/test -s "\$NODE_EXTRA_CA_CERTS"/g)?.length).toBe(2);
    expect(source).not.toContain('PRODUCTION_DB_SSL_ROOT_CERT');
    expect(source).not.toContain('NODE_TLS_REJECT_UNAUTHORIZED');
    expect(source).not.toContain('rejectUnauthorized: false');
  });

  it('keeps observer/test credentials separated from the Production writer credential', () => {
    expect(source).toContain('SCHEMA_OBSERVER_TOKEN: ${{ secrets.SCHEMA_OBSERVER_TOKEN }}');
    expect(source).toContain('SUPABASE_BACKUP_OBSERVER_TOKEN: ${{ secrets.SUPABASE_BACKUP_OBSERVER_TOKEN }}');
    expect(source.match(/PRODUCTION_DB_WRITER_URL: \$\{\{ secrets\.PRODUCTION_DB_WRITER_URL \}\}/g)?.length).toBe(2);
    expect(source.match(/environment: production-db-writer/g)?.length).toBe(2);
    expect(source).not.toContain('TEST_DB_RELEASE_TOKEN');
    expect(source).not.toContain('TEST_SUPABASE_SERVICE_ROLE_KEY');
    expect(source).not.toContain('SUPABASE_ACCESS_TOKEN: ${{ secrets.');
  });
});
