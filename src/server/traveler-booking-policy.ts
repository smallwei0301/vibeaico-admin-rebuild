import type { TripBookingType, TripPlan } from '@/lib/types';
import { resolvePaymentPolicy } from '@/server/payment-policy';

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
  amountDue: number;
  availability: {
    tenantOpen: boolean;
    hasCapacity: boolean;
    hasAvailableStaff: boolean;
    paymentSafetySatisfied: boolean;
  };
};

type DenialReason =
  | 'TENANT_CLOSED'
  | 'CAPACITY_UNAVAILABLE'
  | 'STAFF_UNAVAILABLE'
  | 'PAYMENT_UNSAFE'
  | 'CONTACT_GUIDE'
  | 'PAYMENT_POLICY_INVALID';

export type BookingPolicyDecision =
  | { allowed: false; reason: DenialReason }
  | { allowed: true; checkoutMode: TripBookingType; deposit: DepositRule; upfrontAmount: number };

/**
 * Resolves a tenant-private policy for a traveler self-service attempt.
 * Existing operational and payment gates always take precedence. Trusted
 * back-office creation must use its separately authorized server entry point.
 */
export function resolveTravelerBookingPolicy(input: PolicyInput): BookingPolicyDecision {
  const { availability } = input;
  if (!availability.tenantOpen) return { allowed: false, reason: 'TENANT_CLOSED' };
  if (!availability.hasCapacity) return { allowed: false, reason: 'CAPACITY_UNAVAILABLE' };
  if (!availability.hasAvailableStaff) return { allowed: false, reason: 'STAFF_UNAVAILABLE' };
  if (!availability.paymentSafetySatisfied) return { allowed: false, reason: 'PAYMENT_UNSAFE' };

  if (input.policy.kind === 'BLOCK_SELF_SERVICE') {
    return { allowed: false, reason: 'CONTACT_GUIDE' };
  }

  const deposit = input.policy.kind === 'FORCE_DEPOSIT'
    ? input.policy.deposit
    : { mode: input.plan.depositMode, value: input.plan.depositValue };
  if (input.policy.kind === 'FORCE_DEPOSIT' && (deposit.mode === 'NONE' || deposit.mode === 'FULL')) {
    return { allowed: false, reason: 'PAYMENT_POLICY_INVALID' };
  }
  const payment = resolvePaymentPolicy({ ...deposit, amountDue: input.amountDue });
  if (!payment.valid) {
    return { allowed: false, reason: 'PAYMENT_POLICY_INVALID' };
  }

  return {
    allowed: true,
    checkoutMode: input.policy.kind === 'REQUEST_ONLY' ? 'REQUEST' : input.plan.bookingType,
    deposit,
    upfrontAmount: payment.upfrontAmount,
  };
}
