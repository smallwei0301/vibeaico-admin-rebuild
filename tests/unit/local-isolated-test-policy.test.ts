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
    })).toMatchObject({
      runLocal: true,
      profile: 'LOCAL_ISOLATED',
      slots: ['a'],
      reason: 'per_pr_local_isolated',
      errors: [],
      exactHead: 'abc123',
    });
  });

  it('runs two independent slots for the infrastructure canary', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'pull_request',
      body: body({ TEST_PROFILE: 'LOCAL_ISOLATED_CANARY' }),
      actualHead: 'canary-sha',
    });
    expect(decision.runLocal).toBe(true);
    expect(decision.slots).toEqual(['a', 'b']);
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

  it('authenticates manual dispatch against the exact branch head', () => {
    const decision = decideLocalIsolatedTest({
      eventName: 'workflow_dispatch',
      inputProfile: 'LOCAL_ISOLATED',
      inputExpectedHead: 'old-sha',
      actualHead: 'new-sha',
      body: body(),
    });
    expect(decision.runLocal).toBe(false);
    expect(decision.errors[0]).toContain('expected_head must equal');
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

  it('flags migration, auth and storage paths for a future Supabase Branch', () => {
    expect(classifyRiskPaths([
      'supabase/migrations/0063_example.sql',
      'src/app/api/auth/callback/route.ts',
      'src/app/api/upload/route.ts',
    ])).toEqual({
      remoteBranchRecommended: true,
      reasons: ['DATABASE_MIGRATION', 'AUTH', 'STORAGE'],
    });
  });
});
