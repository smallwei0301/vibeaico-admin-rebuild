import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync(
  resolve(process.cwd(), '.github/workflows/agent-wip-guard.yml'),
  'utf8',
);

describe('agent WIP Guard live-state dispatch', () => {
  it('re-reads the current PR before parsing metadata or deciding a TEST transition', () => {
    const payloadIndex = workflow.indexOf(
      'const payloadCurrent = context.payload.pull_request;',
    );
    const liveReadIndex = workflow.indexOf(
      'const { data: current } = await github.rest.pulls.get({',
    );
    const metadataIndex = workflow.indexOf(
      'const metadata = policy.parseLaneMetadata(current);',
    );

    expect(payloadIndex).toBeGreaterThan(-1);
    expect(liveReadIndex).toBeGreaterThan(payloadIndex);
    expect(metadataIndex).toBeGreaterThan(liveReadIndex);
    expect(workflow).toContain('pull_number: payloadCurrent.number');
    expect(workflow).not.toContain(
      'const current = context.payload.pull_request;',
    );
  });

  it('uses live labels rather than stale event labels for one-shot remote TEST dispatch', () => {
    const liveLabelsIndex = workflow.indexOf(
      'const liveExisting = (current.labels ?? [])',
    );
    const labelWriteIndex = workflow.indexOf(
      'await github.rest.issues.setLabels({',
    );
    const dispatchDecisionIndex = workflow.indexOf(
      "!liveExisting.includes('lane:test-validation')",
    );
    const dispatchIndex = workflow.indexOf(
      'await github.rest.actions.createWorkflowDispatch({',
    );

    expect(liveLabelsIndex).toBeGreaterThan(-1);
    expect(labelWriteIndex).toBeGreaterThan(liveLabelsIndex);
    expect(dispatchDecisionIndex).toBeGreaterThan(labelWriteIndex);
    expect(dispatchIndex).toBeGreaterThan(dispatchDecisionIndex);
    expect(workflow).not.toContain(
      "!rawExisting.includes('lane:test-validation')",
    );
  });

  it('serializes only the same PR and cancels stale in-flight guard runs', () => {
    expect(workflow).toContain(
      'group: agent-wip-guard-${{ github.repository }}-${{ github.event.pull_request.number }}',
    );
    expect(workflow).toContain('cancel-in-progress: true');
    expect(workflow).not.toContain('group: agent-wip-guard-${{ github.repository }}\n');
  });

  it('writes a dedicated policy status that remains failed even when duplicate email noise is suppressed', () => {
    expect(workflow).toContain('statuses: write');
    expect(workflow).toContain("context: 'Agent WIP Policy'");
    expect(workflow).toContain("state: errors.length ? 'failure' : 'success'");
    expect(workflow).toContain('const duplicateFailure = Boolean(');
    expect(workflow).toContain('alert.isDuplicateWipFailure({');
    expect(workflow).toContain('DUPLICATE_NOTIFICATION_SUPPRESSED: ${duplicateFailure}');

    const statusIndex = workflow.indexOf('await github.rest.repos.createCommitStatus({');
    const duplicateWarningIndex = workflow.indexOf('core.warning(`Duplicate WIP failure suppressed');
    const firstFailureIndex = workflow.indexOf('core.setFailed(errors.join');
    expect(statusIndex).toBeGreaterThan(-1);
    expect(duplicateWarningIndex).toBeGreaterThan(statusIndex);
    expect(firstFailureIndex).toBeGreaterThan(duplicateWarningIndex);
  });

  it('binds the fingerprint to the PR number, exact head and complete error set', () => {
    expect(workflow).toContain('alert.buildWipErrorFingerprint({');
    expect(workflow).toContain('prNumber: current.number');
    expect(workflow).toContain('headSha: current.head.sha');
    expect(workflow).toContain('errors,');
    expect(workflow).toContain('- EXACT_HEAD: ${current.head.sha}');
    expect(workflow).toContain('- ERROR_FINGERPRINT: ${fingerprint}');
  });
});
