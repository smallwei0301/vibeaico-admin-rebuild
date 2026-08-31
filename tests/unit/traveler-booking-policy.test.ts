import { describe, expect, it } from 'vitest';
import { resolveTravelerBookingPolicy } from '@/server/traveler-booking-policy';

const available = {
  tenantOpen: true,
  hasCapacity: true,
  hasAvailableStaff: true,
  paymentSafetySatisfied: true,
};

describe('resolveTravelerBookingPolicy (#44)', () => {
  it('uses the current TripPlan bookingType and deposit policy by default', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'DEFAULT' },
      plan: { bookingType: 'SCHEDULED', depositMode: 'DEPOSIT_PERCENT', depositValue: 30 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'SCHEDULED',
      deposit: { mode: 'DEPOSIT_PERCENT', value: 30 },
    });
  });

  it('allows only a valid forced deposit and preserves the plan booking type', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_FIXED', value: 1_000 } },
      plan: { bookingType: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'INSTANT',
      deposit: { mode: 'DEPOSIT_FIXED', value: 1_000 },
    });

    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_PERCENT', value: 101 } },
      plan: { bookingType: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({ allowed: false, reason: 'FORCE_DEPOSIT_VALUE_INVALID' });
  });

  it('does not let a traveler override operational, payment, or self-service gates', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'BLOCK_SELF_SERVICE' },
      plan: { bookingType: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({ allowed: false, reason: 'CONTACT_GUIDE' });

    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'BLOCK_SELF_SERVICE' },
      plan: { bookingType: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
      source: 'ADMIN',
    })).toEqual({
      allowed: true,
      checkoutMode: 'INSTANT',
      deposit: { mode: 'NONE', value: 0 },
    });

    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_PERCENT', value: 30 } },
      plan: { bookingType: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: { ...available, paymentSafetySatisfied: false },
    })).toEqual({ allowed: false, reason: 'PAYMENT_UNSAFE' });
  });

  it('changes instant sale to a request without changing the payment snapshot', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'REQUEST_ONLY' },
      plan: { bookingType: 'INSTANT', depositMode: 'FULL', depositValue: 0 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'REQUEST',
      deposit: { mode: 'FULL', value: 0 },
    });
  });
});
