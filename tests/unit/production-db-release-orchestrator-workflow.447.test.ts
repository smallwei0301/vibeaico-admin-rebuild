import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const source = readFileSync('.github/workflows/production-db-release-orchestrator.yml', 'utf8');

async function verifyBaselineRun(patch: any = {}, jobsPatch?: (jobs: any[]) => void, artifactsPatch?: (artifacts: any[]) => void) {
  const step = parse(source).jobs.admission.steps.find((s: any) => s.name === 'Verify separate TEST 0098 baseline run and artifact provenance');
  expect(step).toBeDefined();
  const head = 'a7368f05c4f8c3c6e2901b2387139b90e2ef3ef2';
  const run: any = { id: 38025747318, repository: { full_name: 'smallwei0301/vibeaico-admin-rebuild' }, name: 'ci',
    path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'main', head_sha: head, run_attempt: 1,
    status: 'completed', conclusion: 'success', ...patch };
  const jobs = [{ name: 'integration', run_attempt: 1, status: 'completed', conclusion: 'success', steps: [
    'Apply explicit canonical TEST 0098 baseline', 'Upload canonical TEST 0098 baseline evidence', 'Run integration tests', 'Run E2E tests',
  ].map(name => ({ name, status: 'completed', conclusion: 'success' })) }];
  const artifacts = [{ id: 11659019044, name: `test-baseline-0098-evidence-${head}-38025747318`, expired: false,
    workflow_run: { id: 38025747318, head_sha: head } }];
  jobsPatch?.(jobs); artifactsPatch?.(artifacts);
  const output: any = {};
  const previous = process.env.TEST_BASELINE_RUN_ID;
  process.env.TEST_BASELINE_RUN_ID = '38025747318';
  try {
    const github: any = { rest: { actions: { getWorkflowRun: async () => ({ data: run }),
      listJobsForWorkflowRunAttempt: Symbol('jobs'), listWorkflowRunArtifacts: Symbol('artifacts') } },
      paginate: async (method: symbol, args: any) => {
        expect(args.run_id).toBe(38025747318);
        if (method === github.rest.actions.listJobsForWorkflowRunAttempt) { expect(args.attempt_number).toBe(1); return jobs; }
        return artifacts;
      } };
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    await new AsyncFunction('github', 'context', 'core', step.with.script)(github,
      { repo: { owner: 'smallwei0301', repo: 'vibeaico-admin-rebuild' } }, { setOutput: (key: string, value: any) => { output[key] = value; } });
    return output;
  } finally { if (previous === undefined) delete process.env.TEST_BASELINE_RUN_ID; else process.env.TEST_BASELINE_RUN_ID = previous; }
}

function position(text: string) {
  const index = source.indexOf(text);
  expect(index, `missing orchestrator workflow contract: ${text}`).toBeGreaterThanOrEqual(0);
  return index;
}

describe('Production DB trusted-main release orchestrator workflow #447', () => {
  it('binds the separate historical baseline run, successful steps and unique artifact without changing the G3 plan', async () => {
    const output = await verifyBaselineRun();
    expect(JSON.parse(output.source)).toMatchObject({ sourceRun: { id: '38025747318', attempt: 1,
      headSha: 'a7368f05c4f8c3c6e2901b2387139b90e2ef3ef2', baselineStep: 'success', integrationStep: 'success', e2eStep: 'success' }, artifact: { id: '11659019044' } });
    expect(output.artifact_id).toBe('11659019044');
    const workflow = parse(source);
    expect(workflow.on.workflow_dispatch.inputs.test_baseline_run_id.required).toBe(false);
    const steps = workflow.jobs.admission.steps;
    const download = steps.find((s: any) => s.name === 'Download exact separate TEST 0098 baseline artifact');
    expect(download.with['artifact-ids']).toBe('${{ steps.baseline-source.outputs.artifact_id }}');
    expect(download.with['run-id']).toBe('${{ inputs.test_baseline_run_id }}');
    const assemble = steps.find((s: any) => s.name === 'Reassemble exact G3 evidence for read-only ledger mapping').run;
    expect(assemble).toContain('testBaseline0098');
    expect(assemble).toContain('verifyTestBaseline0098Binding');
    expect(assemble).not.toMatch(/plan\.migrations\.(?:push|splice)|plan\.mainSha\s*=/);
  });
  it('downloads the exact ID to the consumer path and detects the default artifact-name subdirectory layout', async () => {
    const steps = parse(source).jobs.admission.steps;
    const download = steps.find((s: any) => s.name === 'Download exact separate TEST 0098 baseline artifact');
    const assemble = steps.find((s: any) => s.name === 'Reassemble exact G3 evidence for read-only ledger mapping').run;
    const body = assemble.slice(assemble.indexOf('let testBaseline0098;'), assemble.indexOf('fs.appendFileSync', assemble.indexOf('let testBaseline0098;')));
    const output = await verifyBaselineRun();
    const facts = JSON.parse(output.source);
    const repoFile = '0098_reconcile_tour_orders_legacy_contact_columns';
    const hash = 'f0bd13dcf2226143d90dc1ca3431df7a3020e3d3f9eabd446b640b03261193e5';
    const receipt = { schemaVersion: 1, status: 'TEST_BASELINE_0098_VERIFIED', repository: facts.sourceRun.repository,
      testProjectRef: 'nmwhwngojosmagjuvxol', mainSha: facts.sourceRun.headSha, sourceRunId: facts.sourceRun.id, sourceRunAttempt: 1,
      migration: { repoFile, sha256: hash, ledger: { version: '0098', name: repoFile, created_by: 'vibeaico-test-baseline-0098', idempotency_key: `test-baseline-0098:${hash}` } },
      columnFingerprints: { before: 'b'.repeat(64), after: 'c'.repeat(64) }, testMutationPerformed: true, productionMutationPerformed: false, databaseMutationAuthorized: false };
    const execute = (mergeMultiple: boolean) => {
      const root = mkdtempSync(join(tmpdir(), 'baseline-artifact-layout-'));
      try {
        // download-artifact v4 with artifact-ids and no name uses a per-artifact
        // directory unless merge-multiple=true, even for a single exact ID.
        const destination = join(root, 'test-baseline-0098', ...(mergeMultiple ? [] : [facts.artifact.name]));
        mkdirSync(destination, { recursive: true });
        writeFileSync(join(destination, 'test-baseline-0098-evidence.json'), JSON.stringify(receipt));
        return spawnSync(process.execPath, ['--input-type=module', '-e', `import fs from 'node:fs';\n${body}\nconsole.log(testBaseline0098.receipt.mainSha);`], {
          encoding: 'utf8', timeout: 10_000, env: { ...process.env, RUNNER_TEMP: root, EXPECTED_MAIN_SHA: facts.sourceRun.headSha, TEST_BASELINE_SOURCE: output.source },
        });
      } finally { rmSync(root, { recursive: true, force: true }); }
    };
    const valid = execute(download.with['merge-multiple'] === true);
    expect(valid.status, valid.stderr).toBe(0);
    expect(valid.stdout).toContain(facts.sourceRun.headSha);
    const defaultLayout = execute(false);
    expect(defaultLayout.status).toBe(1);
    expect(defaultLayout.stderr).toContain('ENOENT');
  });
  it.each(['id', 'repository', 'name', 'path', 'event', 'head_branch', 'head_sha', 'run_attempt', 'status', 'conclusion'])('rejects actual baseline GitHub provenance mismatch: %s', async (field) => {
    const value = field === 'id' ? 38025747319 : field === 'repository' ? { full_name: 'other/repo' } : field === 'run_attempt' ? 0 : 'wrong';
    await expect(verifyBaselineRun({ [field]: value })).rejects.toThrow(/UNTRUSTED_TEST_BASELINE_SOURCE/);
  });
  it.each(['missing job', 'duplicate job', 'failed job', 'wrong job attempt', 'missing baseline', 'skipped baseline', 'failed integration', 'skipped E2E', 'duplicate step'])('rejects unexecuted or ambiguous baseline jobs: %s', async (fault) => {
    await expect(verifyBaselineRun({}, jobs => {
      if (fault === 'missing job') jobs.length = 0;
      if (fault === 'duplicate job') jobs.push(structuredClone(jobs[0]));
      if (fault === 'failed job') jobs[0].conclusion = 'failure';
      if (fault === 'wrong job attempt') jobs[0].run_attempt = 2;
      if (fault === 'missing baseline') jobs[0].steps.shift();
      if (fault === 'skipped baseline') jobs[0].steps[0].conclusion = 'skipped';
      if (fault === 'failed integration') jobs[0].steps[2].conclusion = 'failure';
      if (fault === 'skipped E2E') jobs[0].steps[3].conclusion = 'skipped';
      if (fault === 'duplicate step') jobs[0].steps.push(structuredClone(jobs[0].steps[0]));
    })).rejects.toThrow(/TEST_BASELINE_EXECUTION_REQUIRED/);
  });
  it.each(['missing', 'duplicate', 'expired', 'wrong run', 'wrong head', 'wrong id'])('rejects baseline artifact %s', async (fault) => {
    await expect(verifyBaselineRun({}, undefined, artifacts => {
      if (fault === 'missing') artifacts.length = 0;
      if (fault === 'duplicate') artifacts.push(structuredClone(artifacts[0]));
      if (fault === 'expired') artifacts[0].expired = true;
      if (fault === 'wrong run') artifacts[0].workflow_run.id++;
      if (fault === 'wrong head') artifacts[0].workflow_run.head_sha = 'b'.repeat(40);
      if (fault === 'wrong id') artifacts[0].id = 0;
    })).rejects.toThrow(/TEST_BASELINE_ARTIFACT_MISMATCH/);
  });
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
    expect(executeBlock).toContain('$RUNNER_TEMP/prepared/readiness/production-db-automation-evidence.json');
    expect(executeBlock).toContain('$RUNNER_TEMP/prepared/g3/production-db-release-plan.json');
    expect(source.slice(position('  postcheck:'))).toContain('$RUNNER_TEMP/prepared/g3/production-db-release-plan.json');
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
