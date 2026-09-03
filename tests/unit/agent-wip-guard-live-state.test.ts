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
});
