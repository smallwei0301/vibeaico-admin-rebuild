import { describe, expect, it } from 'vitest';
import {
  finalRiskGateStatus,
  isOwnerFinalRiskWaiver,
} from '../../scripts/agents/astra-review-policy.mjs';

const status = 'OWNER_WAIVED_FOR_PR_312_2026_09_09';
const scope = 'PR #312 only; one-time exception; does not change the repository default Final Risk policy or authorize fake model evidence';
const changeDigest = 'a'.repeat(64);
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
const ownerAttestation = {
  user: { login: 'smallwei0301' },
  body: [
    'OWNER_FINAL_RISK_WAIVER: PR #312',
    `WAIVER_STATUS: ${status}`,
    'REVIEWED_HEAD: 2b9acb1e8308958f4e1df4788d1fd6e451e1cf83',
    `CHANGE_DIGEST: ${changeDigest}`,
  ].join('\n'),
};

describe('Owner Final Risk waiver admission', () => {
  it('accepts only the owner-authored, PR-bound, one-time waiver contract', () => {
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation],
      changeDigest,
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
    ['missing owner attestation', { ownerAttestations: [] }],
    ['changed content digest', { changeDigest: 'b'.repeat(64) }],
  ])('rejects %s', (_label, overrides) => {
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation],
      changeDigest,
      ...overrides,
    })).toBe(false);
  });

  it('rejects an older grant when a later owner revocation exists', () => {
    const revoked = {
      id: 2,
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        'WAIVER_STATUS: OWNER_WAIVER_REVOKED_FOR_PR_312_2026_09_09',
      ].join('\\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [{ ...ownerAttestation, id: 1 }, revoked],
      changeDigest,
    })).toBe(false);
  });

  it('allows a later complete owner grant to renew a revoked waiver', () => {
    const revoked = {
      id: 2,
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        'WAIVER_STATUS: OWNER_WAIVER_REVOKED_FOR_PR_312_2026_09_09',
      ].join('\\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [revoked, { ...ownerAttestation, id: 3 }],
      changeDigest,
    })).toBe(true);
  });

  it('keeps an ordinary deferred lane pending', () => {
    expect(finalRiskGateStatus({ hasErrors: false, finalRiskRequired: false })).toBe('pending');
  });
});
