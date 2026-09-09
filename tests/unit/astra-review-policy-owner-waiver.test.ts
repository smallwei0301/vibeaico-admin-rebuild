import { describe, expect, it } from 'vitest';
import {
  finalRiskGateStatus,
  isOwnerFinalRiskWaiver,
} from '../../scripts/agents/astra-review-policy.mjs';

const status = 'OWNER_WAIVED_FOR_PR_312_2026_09_09';
const scope = 'PR #312 only; one-time exception; does not change the repository default Final Risk policy or authorize fake model evidence';
const current = {
  number: 312,
  state: 'open',
  draft: false,
  user: { login: 'smallwei0301' },
  head: { repo: { owner: { login: 'smallwei0301' } } },
  body: [
    `FINAL_RISK_STATUS: ${status}`,
    `FINAL_RISK_WAIVER_SCOPE: ${scope}`,
    `ASTRA_REVIEW_STATUS: ${status}`,
  ].join('\n'),
};

describe('Owner Final Risk waiver admission', () => {
  it('accepts only the owner-authored, PR-bound, one-time waiver contract', () => {
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
    })).toBe(true);
    expect(finalRiskGateStatus({
      hasErrors: false,
      finalRiskRequired: false,
      ownerFinalRiskWaived: true,
    })).toBe('success');
  });

  it.each([
    ['agent-origin', { origin: 'AGENT' }],
    ['wrong author', { current: { ...current, user: { login: 'someone-else' } } }],
    ['wrong PR scope', { current: { ...current, number: 313 } }],
    ['draft', { current: { ...current, draft: true } }],
    ['parked', { laneState: 'PARKED' }],
  ])('rejects %s', (_label, overrides) => {
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ...overrides,
    })).toBe(false);
  });

  it('keeps an ordinary deferred lane pending', () => {
    expect(finalRiskGateStatus({ hasErrors: false, finalRiskRequired: false })).toBe('pending');
  });
});
