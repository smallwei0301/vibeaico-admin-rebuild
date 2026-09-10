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
  id: 1,
  created_at: '2026-09-09T09:00:00Z',
  updated_at: '2026-09-09T09:00:00Z',
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

  it.each(['REVOKED', 'DENIED'])('rejects an older grant when a later owner %s exists', (decision) => {
    const revoked = {
      id: 2,
      created_at: '2026-09-09T10:01:00Z',
      updated_at: '2026-09-09T10:01:00Z',
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        `WAIVER_STATUS: OWNER_WAIVER_${decision}_FOR_PR_312_2026_09_09`,
      ].join('\n'),
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
      created_at: '2026-09-09T10:01:00Z',
      updated_at: '2026-09-09T10:01:00Z',
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        'WAIVER_STATUS: OWNER_WAIVER_REVOKED_FOR_PR_312_2026_09_09',
      ].join('\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [revoked, {
        ...ownerAttestation,
        id: 3,
        created_at: '2026-09-09T10:02:00Z',
        updated_at: '2026-09-09T10:02:00Z',
      }],
      changeDigest,
    })).toBe(true);
  });

  it('treats a later edit as newer than a higher-id grant', () => {
    const editedRevocation = {
      id: 1,
      created_at: '2026-09-09T10:00:00Z',
      updated_at: '2026-09-09T10:04:00Z',
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        'WAIVER_STATUS: OWNER_WAIVER_REVOKED_FOR_PR_312_2026_09_09',
      ].join('\n'),
    };
    const newerGrant = {
      ...ownerAttestation,
      id: 2,
      created_at: '2026-09-09T10:03:00Z',
      updated_at: '2026-09-09T10:03:00Z',
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [newerGrant, editedRevocation],
      changeDigest,
    })).toBe(false);
  });

  it('does not revive an older grant after a durable invalidation marker', () => {
    const invalidation = {
      id: 4,
      created_at: '2026-09-09T10:03:00Z',
      updated_at: '2026-09-09T10:03:00Z',
      user: { login: 'github-actions[bot]' },
      body: [
        '<!-- agent-wip-guard-waiver-invalidation -->',
        'OWNER_FINAL_RISK_INVALIDATED: PR #312',
        'INVALIDATION_EVENT_KEY: edited:2:2026-09-09T10:02:00Z',
      ].join('\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation, invalidation],
      changeDigest,
    })).toBe(false);

    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [
        ownerAttestation,
        invalidation,
        {
          ...ownerAttestation,
          id: 5,
          created_at: '2026-09-09T10:04:00Z',
          updated_at: '2026-09-09T10:04:00Z',
        },
      ],
      changeDigest,
    })).toBe(true);
  });

  it('ignores an untrusted comment that only imitates an invalidation marker', () => {
    const spoofedInvalidation = {
      id: 6,
      created_at: '2026-09-09T10:03:00Z',
      updated_at: '2026-09-09T10:03:00Z',
      user: { login: 'untrusted-contributor' },
      body: [
        '<!-- agent-wip-guard-waiver-invalidation -->',
        'OWNER_FINAL_RISK_INVALIDATED: PR #312',
        'INVALIDATION_EVENT_KEY: deleted:2:2026-09-09T10:02:00Z',
      ].join('\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation, spoofedInvalidation],
      changeDigest,
    })).toBe(true);
  });

  it('rejects a singleton waiver event without a real timestamp', () => {
    const missingTimestampGrant = {
      ...ownerAttestation,
      created_at: undefined,
      updated_at: undefined,
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [missingTimestampGrant],
      changeDigest,
    })).toBe(false);
  });

  it('does not revive a waiver after close-delete-reopen lifecycle', () => {
    const invalidation = {
      id: 7,
      created_at: '2026-09-09T10:06:00Z',
      updated_at: '2026-09-09T10:06:00Z',
      user: { login: 'github-actions[bot]' },
      body: [
        '<!-- agent-wip-guard-waiver-invalidation -->',
        'OWNER_FINAL_RISK_INVALIDATED: PR #312',
        'INVALIDATION_EVENT_KEY: deleted:2:2026-09-09T10:05:00Z',
      ].join('\n'),
    };
    const closed = { ...current, state: 'closed' };
    expect(isOwnerFinalRiskWaiver({
      current: closed,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation, invalidation],
      changeDigest,
    })).toBe(false);
    expect(isOwnerFinalRiskWaiver({
      current: { ...current, state: 'open' },
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [ownerAttestation, invalidation],
      changeDigest,
    })).toBe(false);
  });

  it('fails closed when relevant waiver events have equal timestamps', () => {
    const grant = {
      ...ownerAttestation,
      id: 10,
      created_at: '2026-09-09T10:05:00Z',
      updated_at: '2026-09-09T10:05:00Z',
    };
    const revoke = {
      id: 11,
      created_at: '2026-09-09T10:05:00Z',
      updated_at: '2026-09-09T10:05:00Z',
      user: { login: 'smallwei0301' },
      body: [
        'OWNER_FINAL_RISK_WAIVER: PR #312',
        'WAIVER_STATUS: OWNER_WAIVER_REVOKED_FOR_PR_312_2026_09_09',
      ].join('\n'),
    };
    expect(isOwnerFinalRiskWaiver({
      current,
      owner: 'smallwei0301',
      origin: 'OWNER',
      laneState: 'OWNER_BLOCKED',
      ownerAttestations: [grant, revoke],
      changeDigest,
    })).toBe(false);
  });

  it('keeps an ordinary deferred lane pending', () => {
    expect(finalRiskGateStatus({ hasErrors: false, finalRiskRequired: false })).toBe('pending');
  });
});
