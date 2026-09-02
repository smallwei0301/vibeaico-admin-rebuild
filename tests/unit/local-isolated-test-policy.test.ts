import { describe, expect, it } from 'vitest';

import {
  classifyRiskPaths,
  decideLocalIsolatedTest,
  readMetadataField,
} from '../../scripts/ci/local-isolated-test-policy.mjs';

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

  it('runs one isolated slot for a normal local profile', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body(),
      actualHead: 'abc123',
      headRepoFullName: 'smallwei0301/vibeaico-admin-rebuild',
      repositoryFullName: 'smallwei0301/vibeaico-admin-rebuild',
    })).toMatchObject({
      runLocal: true,
      profile: 'LOCAL_ISOLATED',
      slots: ['a'],
      canaryBarrierEpoch: null,
      reason: 'per_pr_local_isolated',
      errors: [],
      exactHead: 'abc123',
      paidPreviewBranchStatus: 'DEFERRED_NOT_IN_CONSIDERATION',
    });
  });

  it('runs two independent slots behind one future barrier for the infrastructure canary', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'LOCAL_ISOLATED_CANARY' }),
      actualHead: 'canary-sha',
      headRepoFullName: 'smallwei0301/vibeaico-admin-rebuild',
      repositoryFullName: 'smallwei0301/vibeaico-admin-rebuild',
      nowEpochSeconds: 1_000,
    });
    expect(decision.runLocal).toBe(true);
    expect(decision.slots).toEqual(['a', 'b']);
    expect(decision.canaryBarrierEpoch).toBe(1_360);
    expect(decision.reason).toBe('two_slot_canary');
  });

  it('refuses to let a local green result masquerade as final canonical validation', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ FINAL_CANONICAL_REQUIRED: 'false' }),
      actualHead: 'abc123',
    });
    expect(decision.runLocal).toBe(false);
    expect(decision.errors).toContain('LOCAL_ISOLATED profiles must set FINAL_CANONICAL_REQUIRED=true');
  });

  it('authenticates manual dispatch against the exact branch head and explicit final gate', () => {
    const valid = decideLocalIsolatedTest({
      eventName: 'workflow_dispatch',
      inputProfile: 'LOCAL_ISOLATED',
      inputExpectedHead: 'new-sha',
      inputFinalCanonicalRequired: 'true',
      actualHead: 'new-sha',
    });
    expect(valid).toMatchObject({ runLocal: true, reason: 'per_pr_local_isolated' });

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
      repositoryFullName: 'smallwei0301/vibeaico-admin-rebuild',
    })).toMatchObject({
      runLocal: false,
      reason: 'fork_pr_requires_trusted_manual_dispatch',
      errors: [],
    });
  });

  it('keeps source-only work out of Docker and the local database lane', () => {
    expect(decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'SOURCE_ONLY', FINAL_CANONICAL_REQUIRED: 'false' }),
      actualHead: 'abc123',
    })).toMatchObject({
      runLocal: false,
      reason: 'profile_does_not_request_local_test',
    });
  });

  it('routes migration, auth and storage paths to free local isolation plus the final shared TEST', () => {
    expect(classifyRiskPaths([
      'supabase/migrations/0063_example.sql',
      'src/app/api/auth/callback/route.ts',
      'src/app/api/upload/route.ts',
    ])).toEqual({
      localIsolatedRequired: true,
      finalCanonicalRequired: true,
      recommendedProfile: 'LOCAL_ISOLATED',
      paidPreviewBranchStatus: 'DEFERRED_NOT_IN_CONSIDERATION',
      remoteBranchRecommended: false,
      reasons: ['DATABASE_MIGRATION', 'AUTH', 'STORAGE'],
    });
  });

  it('rejects the retired paid Preview Branch profile with an explicit replacement route', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'REMOTE_BRANCH_REQUIRED' }),
      actualHead: 'abc123',
    });

    expect(decision.runLocal).toBe(false);
    expect(decision.reason).toBe('invalid_local_test_contract');
    expect(decision.errors).toContain(
      'TEST_PROFILE REMOTE_BRANCH_REQUIRED is retired; use LOCAL_ISOLATED with FINAL_CANONICAL_REQUIRED=true, then SHARED_CANONICAL',
    );
  });
});
