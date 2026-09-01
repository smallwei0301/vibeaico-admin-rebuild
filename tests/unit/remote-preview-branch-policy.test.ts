import { describe, expect, it } from 'vitest';

import {
  REMOTE_BRANCH_POLICY,
  buildManagedBranchName,
  buildRemoteBranchLeasePlan,
  classifyRemoteBranchRequirement,
  estimateBranchCostUsd,
  verifyBranchDestroyed,
} from '../../scripts/ci/remote-preview-branch-policy.mjs';

const HEAD = 'a'.repeat(40);

function remotePlan(overrides: Record<string, unknown> = {}) {
  return buildRemoteBranchLeasePlan({
    prNumber: 120,
    exactHead: HEAD,
    slot: 1,
    leaseMinutes: 60,
    changedPaths: ['supabase/migrations/0065_example.sql'],
    prBody: 'TEST_PROFILE: REMOTE_BRANCH_REQUIRED',
    existingBranches: [],
    now: new Date('2026-09-01T16:30:00Z'),
    ...overrides,
  });
}

describe('remote preview branch path classification', () => {
  it('routes database migrations, Auth and Storage changes to a remote branch', () => {
    expect(classifyRemoteBranchRequirement({
      changedPaths: ['supabase/migrations/0065_example.sql'],
    })).toMatchObject({ profile: 'REMOTE_BRANCH_REQUIRED', reasons: ['DATABASE_MIGRATION'] });

    expect(classifyRemoteBranchRequirement({
      changedPaths: ['src/app/api/auth/callback/route.ts'],
    })).toMatchObject({ profile: 'REMOTE_BRANCH_REQUIRED' });

    expect(classifyRemoteBranchRequirement({
      changedPaths: ['src/app/api/upload/image/route.ts'],
    })).toMatchObject({ profile: 'REMOTE_BRANCH_REQUIRED' });
  });

  it('honors explicit migration/auth/storage metadata even when the path is indirect', () => {
    const result = classifyRemoteBranchRequirement({
      changedPaths: ['src/lib/provider.ts'],
      prBody: [
        'TEST_PROFILE: LOCAL_ISOLATED',
        'MIGRATION_TOUCH: false',
        'AUTH_TOUCH: true',
        'STORAGE_TOUCH: false',
      ].join('\n'),
    });
    expect(result).toMatchObject({ profile: 'REMOTE_BRANCH_REQUIRED', reasons: ['DECLARED_AUTH_TOUCH'] });
  });

  it('keeps ordinary API work local and pure UI/docs source-only', () => {
    expect(classifyRemoteBranchRequirement({
      changedPaths: ['src/app/api/services/route.ts'],
    })).toMatchObject({ profile: 'LOCAL_ISOLATED' });

    expect(classifyRemoteBranchRequirement({
      changedPaths: ['src/components/Button.tsx', 'docs/guide.md'],
    })).toMatchObject({ profile: 'SOURCE_ONLY' });
  });
});

describe('remote preview branch lease policy', () => {
  it('creates a deterministic two-slot branch name and a one-hour plan', () => {
    const plan = remotePlan();
    expect(buildManagedBranchName(120, HEAD, 1)).toBe('vibeaico-pr120-s1-aaaaaaaa');
    expect(plan).toMatchObject({
      status: 'PLAN_ONLY',
      operation: 'CREATE_AND_DESTROY_ONLY',
      slot: 1,
      branchName: 'vibeaico-pr120-s1-aaaaaaaa',
      withData: false,
      persistent: false,
      hourlyCostUsd: 0.01344,
      estimatedCostUsd: 0.01344,
      cleanupStatus: 'NOT_CREATED',
    });
    expect(plan.forbiddenOperations).toContain('MERGE_BRANCH');
  });

  it('bills any partial hour as one hour and two hours as two', () => {
    expect(estimateBranchCostUsd(30)).toBe(0.01344);
    expect(estimateBranchCostUsd(60, 2)).toBe(0.02688);
    expect(estimateBranchCostUsd(61)).toBe(0.02688);
  });

  it('requires all paid gates before authorizing creation', () => {
    expect(() => remotePlan({ executePaidBranch: true })).toThrow('not enabled');
    expect(() => remotePlan({
      executePaidBranch: true,
      paidBranchesEnabled: true,
    })).toThrow('SUPABASE_ACCESS_TOKEN');
    expect(() => remotePlan({
      executePaidBranch: true,
      paidBranchesEnabled: true,
      accessTokenAvailable: true,
      costConfirmation: 'yes',
    })).toThrow('cost confirmation');

    expect(remotePlan({
      executePaidBranch: true,
      paidBranchesEnabled: true,
      accessTokenAvailable: true,
      costConfirmation: REMOTE_BRANCH_POLICY.confirmationText,
    })).toMatchObject({ status: 'AUTHORIZED_TO_CREATE' });
  });

  it('never allocates more than two managed branches or reuses an occupied slot', () => {
    const existing = [
      { name: 'vibeaico-pr1-s1-11111111', status: 'ACTIVE_HEALTHY' },
      { name: 'vibeaico-pr2-s2-22222222', status: 'CREATING_PROJECT' },
    ];
    expect(() => remotePlan({ existingBranches: existing })).toThrow('max is 2');

    expect(() => remotePlan({
      existingBranches: [{ name: 'vibeaico-pr1-s1-11111111', status: 'ACTIVE_HEALTHY' }],
    })).toThrow('slot 1 is already occupied');
  });

  it('rejects paid branches for work that local isolation can cover', () => {
    expect(() => buildRemoteBranchLeasePlan({
      prNumber: 120,
      exactHead: HEAD,
      slot: 1,
      changedPaths: ['src/app/api/services/route.ts'],
      prBody: '',
    })).toThrow('LOCAL_ISOLATED');
  });

  it('requires full exact-head identity and bounded lease duration', () => {
    expect(() => remotePlan({ exactHead: 'abc' })).toThrow('40-character');
    expect(() => remotePlan({ slot: 3 })).toThrow('slot must be 1 or 2');
    expect(() => remotePlan({ leaseMinutes: 61 })).toThrow('between 1 and 60');
  });
});

describe('remote branch cleanup proof', () => {
  it('records VERIFIED_DESTROYED only when every branch identifier disappears', () => {
    expect(verifyBranchDestroyed({
      branchId: 'branch-id',
      projectRef: 'branch-ref',
      branchName: 'vibeaico-pr120-s1-aaaaaaaa',
      remainingBranches: [{ name: 'some-other-branch', id: 'other' }],
    })).toMatchObject({ verifiedDestroyed: true, cleanupStatus: 'VERIFIED_DESTROYED' });

    expect(verifyBranchDestroyed({
      branchId: 'branch-id',
      remainingBranches: [{ id: 'branch-id', name: 'still-there' }],
    })).toMatchObject({ verifiedDestroyed: false, cleanupStatus: 'DESTROY_FAILED' });
  });
});
