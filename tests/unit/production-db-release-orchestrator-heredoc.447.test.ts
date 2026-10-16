import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const source = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');
const workflow = parse(source);
const runBlocks: Array<{ job: string; step: string; run: string }> = Object.entries<any>(workflow.jobs)
  .flatMap(([job, def]) => (def.steps ?? []).filter((step: any) => typeof step.run === 'string')
    .map((step: any) => ({ job, step: step.name ?? '(unnamed)', run: step.run as string })));

describe('production-db-release-orchestrator workflow shell safety #447', () => {
  it('parses a non-trivial number of run blocks', () => {
    expect(runBlocks.length).toBeGreaterThan(10);
  });

  it('terminates every heredoc with a delimiter line that is exact after YAML de-indentation', () => {
    let heredocs = 0;
    for (const { job, step, run } of runBlocks) {
      const lines = run.split('\n');
      lines.forEach((line, index) => {
        for (const match of line.matchAll(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/g)) {
          heredocs += 1;
          const delimiter = match[2];
          expect(lines.slice(index + 1).includes(delimiter), `${job} / ${step}: heredoc ${delimiter} has no exact terminator line`).toBe(true);
        }
      });
    }
    expect(heredocs).toBeGreaterThan(0);
  });

  it('persists the apply result without a heredoc', () => {
    const block = runBlocks.find((item) => item.step === 'Persist apply result or APPLY_UNKNOWN stop marker');
    expect(block).toBeDefined();
    expect(block!.run).not.toMatch(/<</);
    expect(block!.run).toContain('EXECUTE_REJECTED_PRE_MUTATION');
  });
});

describe('production-db-release-orchestrator postcheck mode #447', () => {
  const inputs = workflow.on.workflow_dispatch.inputs;
  it('offers postcheck mode and keeps collect/execute paths out of it', () => {
    expect(inputs.mode.options).toEqual(['collect', 'execute', 'postcheck']);
    for (const name of ['g2', 'g4-backup', 'g4-restore', 'collect']) expect(workflow.jobs[name].if).toBe("${{ inputs.mode == 'collect' }}");
    expect(workflow.jobs.prepare.if).toBe("${{ inputs.mode == 'execute' }}");
    expect(workflow.jobs.execute.if).toContain("inputs.mode == 'execute'");
    expect(workflow.jobs.g7.needs).toEqual(['admission', 'execute']);
    expect(workflow.jobs.postcheck.needs).toEqual(['execute', 'g7']);
  });

  it('admission accepts postcheck with evidence_run_id, no Final Risk PR and no baseline run', () => {
    const verify = workflow.jobs.admission.steps.find((step: any) => step.name === 'Verify exact main and numeric provenance inputs').run as string;
    expect(verify).toContain('"$MODE" = postcheck');
    const postcheckBranch = verify.split('if [ "$MODE" = postcheck ]; then')[1].split('fi')[0];
    expect(postcheckBranch).toContain('EVIDENCE_RUN_ID');
    expect(postcheckBranch).toContain('test -z "$TEST_BASELINE_RUN_ID"');
    expect(postcheckBranch).not.toContain('FINAL_RISK_PR');
    for (const name of ['Reject any prior durable attempt for this releaseId', 'Verify AUTOMATION_READY run provenance',
      'Download trusted automation readiness artifact', 'Require machine POLICY_GATED_ACTIVE before any release evidence job']) {
      expect(workflow.jobs.admission.steps.find((step: any) => step.name === name).if).toBe("${{ inputs.mode != 'postcheck' }}");
    }
  });

  it('runs read-only G7 and the postcheck CLI against the prior EXECUTE run without any writer access', () => {
    expect(workflow.jobs['g7-recheck'].with.release_ledger_binding).toBe('${{ needs.admission.outputs.g3_ledger_binding }}');
    expect(workflow.jobs.g7.with.release_ledger_binding).toBe('${{ needs.admission.outputs.g3_ledger_binding }}');
    expect(workflow.jobs.g7.needs).toEqual(expect.arrayContaining(['admission', 'execute']));
    expect(workflow.jobs.g7.with.release_phase).toBe('post_apply');
    expect(workflow.jobs['g7-recheck'].with.release_phase).toBe('post_apply');
    expect(workflow.jobs.g2.with.release_phase).toBeUndefined(); // collect keeps the pre_apply default
    const observer = readFileSync(new URL('../../.github/workflows/agent-schema-drift-watch.yml', import.meta.url), 'utf8');
    const call = observer.split('  workflow_call:')[1].split('permissions:')[0];
    expect(call).toMatch(/release_phase:[\s\S]*default: pre_apply/);
    expect(observer.split('  workflow_dispatch:')[1].split('  workflow_call:')[0]).not.toContain('release_phase');
    expect(observer).toContain('if test "$RELEASE_PHASE" = post_apply; then exit 0; fi');
    const afterSkip = observer.split('if test "$RELEASE_PHASE" = post_apply; then exit 0; fi')[1];
    expect(afterSkip).toContain('assemble-production-db-release-evidence.mjs consistency');
    expect(observer.split('if test "$RELEASE_PHASE" = post_apply; then exit 0; fi')[0]).toContain('test "$observer_exit" = 2');
    for (const name of ['Verify G3 provenance for read-only ledger comparison', 'Download G3 ledger comparison provenance',
      'Reassemble exact G3 evidence for read-only ledger mapping']) {
      const gate = workflow.jobs.admission.steps.find((step: any) => step.name === name).if as string;
      for (const mode of ['collect', 'execute', 'postcheck']) expect(gate).toContain(`inputs.mode == '${mode}'`);
    }
    const jobs = [workflow.jobs['g7-recheck'], workflow.jobs['postcheck-recheck']];
    for (const job of jobs) {
      expect(job.if).toContain("inputs.mode == 'postcheck'");
      expect(job.environment).toBeUndefined();
    }
    expect(JSON.stringify(jobs)).not.toMatch(/PRODUCTION_DB_WRITER_URL|production-db-writer|mjs prepare|mjs execute|init-state/);
    const steps = workflow.jobs['postcheck-recheck'].steps;
    const downloads = steps.filter((step: any) => step.uses?.startsWith('actions/download-artifact'));
    const prior = downloads.filter((step: any) => step.with['run-id'] === '${{ inputs.evidence_run_id }}');
    expect(prior.map((step: any) => step.with.name)).toEqual([
      'prepared-production-db-attempt-${{ inputs.release_id }}-${{ inputs.evidence_run_id }}',
      'production-db-apply-result-${{ inputs.release_id }}-${{ inputs.evidence_run_id }}',
    ]);
    prior.forEach((step: any) => expect(step.with['github-token']).toBe('${{ github.token }}'));
    const finalize = steps.find((step: any) => step.name === 'G7 finalize Production schema readiness').run as string;
    expect(finalize).toContain('git diff --quiet "$plan_main" "$EXPECTED_MAIN_SHA" -- supabase/migrations supabase/local-migrations supabase/config.toml');
    expect(finalize).toContain('--migrations-unchanged-since-plan');
    expect(finalize).toContain('$RUNNER_TEMP/prepared/production-db-consistency-evidence.json');
    expect(steps.find((step: any) => step.name === 'Require APPLIED_CONFIRMED apply result for the same release and plan').run).toContain('APPLIED_CONFIRMED');
    expect(steps.find((step: any) => step.name === 'Upload production-db-terminal-result').with.name)
      .toBe('production-db-terminal-result-${{ inputs.release_id }}-${{ github.run_id }}');
  });

  it('passes the consistency evidence to the in-run postcheck', () => {
    const finalize = workflow.jobs.postcheck.steps.find((step: any) => step.name === 'G7 finalize Production schema readiness').run as string;
    expect(finalize).toContain('$RUNNER_TEMP/prepared/production-db-consistency-evidence.json');
    expect(finalize).not.toContain('--migrations-unchanged-since-plan');
  });
});
