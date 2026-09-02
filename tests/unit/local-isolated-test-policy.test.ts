import { describe, expect, it } from 'vitest';

import {
  classifyRiskPaths,
  decideLocalIsolatedTest,
  readMetadataField,
} from '../../scripts/ci/local-isolated-test-policy.mjs';

const repo = 'smallwei0301/vibeaico-admin-rebuild';

function body(overrides: Record<string, string> = {}) {
  const fields = {
    TEST_PROFILE: 'LOCAL_ISOLATED',
    TEST_ENV_ID: 'AUTO',
    FINAL_CANONICAL_REQUIRED: 'true',
    ...overrides,
  };
  return Object.entries(fields).map(([key, value]) => `- ${key}: ${value}`).join('\n');
}

describe('local isolated TEST policy', () => {
  it('reads one metadata row without consuming the next row', () => {
    expect(readMetadataField(body(), 'TEST_PROFILE')).toBe('LOCAL_ISOLATED');
    expect(readMetadataField(body(), 'TEST_ENV_ID')).toBe('AUTO');
  });

  it('runs one disposable local slot for a normal same-repo PR', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body(),
      actualHead: 'abc123',
      headRepoFullName: repo,
      repositoryFullName: repo,
    })).toMatchObject({
      runLocal: true,
      profile: 'LOCAL_ISOLATED',
      slots: ['a'],
      canaryBarrierEpoch: null,
      reason: 'per_pr_local_isolated',
      errors: [],
      exactHead: 'abc123',
    });
  });

  it('runs two independent slots behind one future barrier for the infrastructure canary', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'LOCAL_ISOLATED_CANARY' }),
      actualHead: 'canary-sha',
      headRepoFullName: repo,
      repositoryFullName: repo,
      nowEpochSeconds: 1_000,
    });
    expect(decision).toMatchObject({
      runLocal: true,
      slots: ['a', 'b'],
      canaryBarrierEpoch: 1_360,
      reason: 'two_slot_canary',
    });
  });

  it('requires the final remote canonical gate for every local profile', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ FINAL_CANONICAL_REQUIRED: 'false' }),
      actualHead: 'abc123',
    });
    expect(decision.runLocal).toBe(false);
    expect(decision.errors).toContain(
      'LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true',
    );
  });

  it('authenticates manual dispatch against the exact branch head and final gate', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'workflow_dispatch',
      inputProfile: 'LOCAL_ISOLATED',
      inputExpectedHead: 'new-sha',
      inputFinalCanonicalRequired: 'true',
      actualHead: 'new-sha',
    })).toMatchObject({ runLocal: true, reason: 'per_pr_local_isolated' });

    const wrongHead = decideLocalIsolatedTest({
      eventName: 'workflow_dispatch',
      inputProfile: 'LOCAL_ISOLATED',
      inputExpectedHead: 'old-sha',
      inputFinalCanonicalRequired: 'true',
      actualHead: 'new-sha',
    });
    expect(wrongHead.runLocal).toBe(false);
    expect(wrongHead.errors[0]).toContain('expected_head must equal');
  });

  it('does not automatically spend two Docker runners for a fork PR', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'LOCAL_ISOLATED_CANARY' }),
      actualHead: 'fork-sha',
      headRepoFullName: 'external-user/vibeaico-admin-rebuild',
      repositoryFullName: repo,
    })).toMatchObject({
      runLocal: false,
      reason: 'fork_pr_requires_trusted_manual_dispatch',
      errors: [],
    });
  });

  it('keeps source-only work out of Docker and local database lanes', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'SOURCE_ONLY', FINAL_CANONICAL_REQUIRED: 'false' }),
      actualHead: 'abc123',
    })).toMatchObject({
      runLocal: false,
      reason: 'profile_does_not_request_local_test',
    });
  });

  it('routes migration, Auth and Storage through free local isolation plus final remote TEST', () => {
    expect(classifyRiskPaths([
      'supabase/migrations/0063_example.sql',
      'src/app/api/auth/callback/route.ts',
      'src/app/api/upload/route.ts',
    ])).toEqual({
      localIsolatedRequired: true,
      remoteCanonicalRequired: true,
      paidPreviewBranchConsidered: false,
      reasons: ['DATABASE_MIGRATION', 'AUTH', 'STORAGE'],
    });
  });

  it('rejects the retired paid Preview Branch profile', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'REMOTE_BRANCH_REQUIRED' }),
      actualHead: 'abc123',
    });
    expect(decision.runLocal).toBe(false);
    expect(decision.errors).toContain(
      'TEST_PROFILE is invalid: REMOTE_BRANCH_REQUIRED',
    );
  });
});
