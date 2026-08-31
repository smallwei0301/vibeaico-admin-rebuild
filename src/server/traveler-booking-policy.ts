import type { TripBookingType, TripPlan } from '@/lib/types';

export type DepositMode = TripPlan['depositMode'];

export type DepositRule = {
  mode: DepositMode;
  value: number;
};

export type TravelerBookingPolicy =
  | { kind: 'DEFAULT' }
  | { kind: 'FORCE_DEPOSIT'; deposit: DepositRule }
  | { kind: 'REQUEST_ONLY' }
  | { kind: 'BLOCK_SELF_SERVICE' };

type PolicyInput = {
  policy: TravelerBookingPolicy;
  plan: Pick<TripPlan, 'bookingType' | 'depositMode' | 'depositValue'>;
  availability: {
    tenantOpen: boolean;
    hasCapacity: boolean;
    hasAvailableStaff: boolean;
    paymentSafetySatisfied: boolean;
  };
  source?: 'TRAVELER' | 'ADMIN';
};

type DenialReason =
  | 'TENANT_CLOSED'
  | 'CAPACITY_UNAVAILABLE'
  | 'STAFF_UNAVAILABLE'
  | 'PAYMENT_UNSAFE'
  | 'CONTACT_GUIDE'
  | 'FORCE_DEPOSIT_MODE_REQUIRED'
  | 'FORCE_DEPOSIT_VALUE_INVALID';

export type BookingPolicyDecision =
  | { allowed: false; reason: DenialReason }
  | { allowed: true; checkoutMode: TripBookingType; deposit: DepositRule };

/**
 * Resolves a tenant-private traveler policy at the booking boundary. Existing
 * operational and payment gates always take precedence over policy overrides.
 */
export function resolveTravelerBookingPolicy(input: PolicyInput): BookingPolicyDecision {
  const { availability } = input;
  if (!availability.tenantOpen) return { allowed: false, reason: 'TENANT_CLOSED' };
  if (!availability.hasCapacity) return { allowed: false, reason: 'CAPACITY_UNAVAILABLE' };
  if (!availability.hasAvailableStaff) return { allowed: false, reason: 'STAFF_UNAVAILABLE' };
  if (!availability.paymentSafetySatisfied) return { allowed: false, reason: 'PAYMENT_UNSAFE' };

  if (input.policy.kind === 'BLOCK_SELF_SERVICE' && (input.source ?? 'TRAVELER') === 'TRAVELER') {
    return { allowed: false, reason: 'CONTACT_GUIDE' };
  }

  if (input.policy.kind === 'FORCE_DEPOSIT') {
    const { mode, value } = input.policy.deposit;
    if (mode === 'NONE' || mode === 'FULL') {
      return { allowed: false, reason: 'FORCE_DEPOSIT_MODE_REQUIRED' };
    }
    if (!validDepositValue(mode, value)) {
      return { allowed: false, reason: 'FORCE_DEPOSIT_VALUE_INVALID' };
    }
    return { allowed: true, checkoutMode: input.plan.bookingType, deposit: { mode, value } };
  }

  return {
    allowed: true,
    checkoutMode: input.policy.kind === 'REQUEST_ONLY' ? 'REQUEST' : input.plan.bookingType,
    deposit: { mode: input.plan.depositMode, value: input.plan.depositValue },
  };
}

function validDepositValue(mode: 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT', value: number): boolean {
  if (!Number.isFinite(value) || value < 0) return false;
  if (mode === 'DEPOSIT_FIXED') return value > 0;
  return value >= 1 && value <= 100;
}
