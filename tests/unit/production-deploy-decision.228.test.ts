import { describe, expect, it } from 'vitest';
import {
  classifyProductionPaths,
  decideProductionDeployCandidate,
  isProductionRuntimePath,
} from '../../scripts/ci/production-deploy-decision.mjs';

const SHA_A = '1111111111111111111111111111111111111111';
const SHA_B = '2222222222222222222222222222222222222222';
const SHA_C = '3333333333333333333333333333333333333333';

function decide(overrides: Record<string, unknown> = {}) {
  return decideProductionDeployCandidate({
    currentSha: SHA_C,
    latestMainSha: SHA_C,
    lastProductionSha: SHA_A,
    comparisonBaseSha: SHA_A,
    checksState: 'SUCCESS',
    changedPaths: ['docs/note.md'],
    ...overrides,
  });
}

describe('Issue #228 Production deployment dry-run decision', () => {
  it('shares the conservative runtime boundary with the existing Vercel ignored-build policy', () => {
    expect(isProductionRuntimePath('src/app/page.tsx')).toBe(true);
    expect(isProductionRuntimePath('public/logo.svg')).toBe(true);
    expect(isProductionRuntimePath('package-lock.json')).toBe(true);
    expect(isProductionRuntimePath('vercel.json')).toBe(true);
    expect(isProductionRuntimePath('docs/decision.md')).toBe(false);
    expect(isProductionRuntimePath('tests/unit/example.test.ts')).toBe(false);
    expect(isProductionRuntimePath('.github/workflows/ci.yml')).toBe(false);
  });

  it('deduplicates and normalizes changed paths before classifying them', () => {
    expect(classifyProductionPaths([
      './docs/a.md',
      'docs/a.md',
      'src\\app\\page.tsx',
    ])).toEqual({
      comparable: true,
      changedPaths: ['docs/a.md', 'src/app/page.tsx'],
      runtimePaths: ['src/app/page.tsx'],
    });
  });

  it('skips a stale SHA even if its CI eventually turns green', () => {
    expect(decide({ currentSha: SHA_B, latestMainSha: SHA_C, changedPaths: ['src/app/page.tsx'] }))
      .toMatchObject({ action: 'SKIP', reason: 'STALE_SHA' });
  });

  it('waits while required checks are pending and blocks failed or cancelled CI', () => {
    expect(decide({ checksState: 'PENDING', changedPaths: ['src/app/page.tsx'] }))
      .toMatchObject({ action: 'WAIT', reason: 'CHECKS_PENDING' });
    expect(decide({ checksState: 'FAILURE', changedPaths: ['src/app/page.tsx'] }))
      .toMatchObject({ action: 'BLOCK', reason: 'CHECKS_NOT_GREEN' });
    expect(decide({ checksState: 'CANCELLED', changedPaths: ['src/app/page.tsx'] }))
      .toMatchObject({ action: 'BLOCK', reason: 'CHECKS_NOT_GREEN' });
  });

  it('never redeploys the same exact Production SHA', () => {
    expect(decide({ lastProductionSha: SHA_C, comparisonBaseSha: SHA_C }))
      .toMatchObject({ action: 'SKIP', reason: 'ALREADY_DEPLOYED' });
  });

  it('skips a verified docs/tests/governance-only range without contacting Vercel', () => {
    expect(decide({
      changedPaths: [
        'docs/OWNER-DECISIONS.md',
        'tests/unit/safety.test.ts',
        '.github/workflows/ci.yml',
      ],
    })).toMatchObject({
      action: 'SKIP',
      reason: 'NON_RUNTIME_DELTA',
      runtimePaths: [],
    });
  });

  it('marks a verified runtime range as WOULD_DEPLOY, never as a real deploy action', () => {
    expect(decide({ changedPaths: ['docs/note.md', 'src/server/orders.ts'] }))
      .toMatchObject({
        action: 'WOULD_DEPLOY',
        reason: 'RUNTIME_DELTA',
        runtimePaths: ['src/server/orders.ts'],
      });
  });

  it('preserves an earlier runtime change when rapid main commits are coalesced', () => {
    // Imagine SHA_B changed runtime and newest SHA_C only changed docs. The adapter
    // must diff SHA_A..SHA_C, so the aggregate path list still contains the runtime file.
    expect(decide({
      currentSha: SHA_C,
      latestMainSha: SHA_C,
      lastProductionSha: SHA_A,
      comparisonBaseSha: SHA_A,
      changedPaths: ['src/app/api/orders/route.ts', 'docs/closeout.md'],
    })).toMatchObject({
      action: 'WOULD_DEPLOY',
      reason: 'RUNTIME_DELTA',
    });
  });

  it('blocks a parent-only or otherwise wrong comparison base', () => {
    expect(decide({ comparisonBaseSha: SHA_B, changedPaths: ['docs/closeout.md'] }))
      .toMatchObject({ action: 'BLOCK', reason: 'UNTRUSTED_COMPARISON_BASE' });
  });

  it('fails safe toward WOULD_DEPLOY when no deployed baseline or usable diff exists', () => {
    expect(decide({ lastProductionSha: '', comparisonBaseSha: '', changedPaths: ['docs/a.md'] }))
      .toMatchObject({ action: 'WOULD_DEPLOY', reason: 'NO_DEPLOYED_BASELINE' });
    expect(decide({ changedPaths: [] }))
      .toMatchObject({ action: 'WOULD_DEPLOY', reason: 'CLASSIFIER_FAILED_FAIL_SAFE' });
    expect(decide({ changedPaths: null }))
      .toMatchObject({ action: 'WOULD_DEPLOY', reason: 'CLASSIFIER_FAILED_FAIL_SAFE' });
  });

  it('blocks malformed SHA/check evidence instead of guessing', () => {
    expect(decide({ currentSha: 'not-a-sha' }))
      .toMatchObject({ action: 'BLOCK', reason: 'UNTRUSTED_SHA' });
    expect(decide({ lastProductionSha: 'bad' }))
      .toMatchObject({ action: 'BLOCK', reason: 'UNTRUSTED_LAST_PRODUCTION_SHA' });
    expect(decide({ checksState: 'MAYBE' }))
      .toMatchObject({ action: 'BLOCK', reason: 'UNTRUSTED_CHECK_STATE' });
  });
});
