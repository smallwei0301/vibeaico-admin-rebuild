import { describe, expect, it } from 'vitest';
import { assertFormationTenant, callbackReplayIsNoop, qualifiesForFormation, transitionFormation } from '@/server/tour-formation';

describe('#41 formation domain', () => {
  it('counts a confirmed one-person booking toward a four-person shared departure without treating its hold as qualification', () => {
    expect(qualifiesForFormation({ depositMode: 'FULL', orderStatus: 'PENDING', paymentStatus: 'UNPAID' })).toBe(false);
    expect(qualifiesForFormation({ depositMode: 'DEPOSIT_FIXED', orderStatus: 'CONFIRMED', paymentStatus: 'PARTIAL' })).toBe(true);
  });
  it('makes a callback retransmission a no-op after the durable formation transition', () => {
    expect(callbackReplayIsNoop('FORMED', 4, 4)).toBe(true);
    expect(transitionFormation('FORMED', { qualifyingParticipants: 4, minToDepart: 4, trigger: 'QUALIFYING_PAYMENT' })).toEqual({ status: 'FORMED' });
  });
  it('moves deadline shortfall to review and a post-formation shortfall to at-risk', () => {
    expect(transitionFormation('COLLECTING', { qualifyingParticipants: 3, minToDepart: 4, trigger: 'DEADLINE_REACHED' }).status).toBe('REVIEW_REQUIRED');
    expect(transitionFormation('FORMED', { qualifyingParticipants: 3, minToDepart: 4, trigger: 'QUALIFYING_CANCELLATION' }).status).toBe('AT_RISK');
  });
  it('rejects cross-tenant formation access', () => {
    expect(() => assertFormationTenant('tenant-a', 'tenant-b')).toThrow('FORMATION_TENANT_NOT_FOUND');
  });
});
