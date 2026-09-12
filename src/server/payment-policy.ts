import type { TripPlan } from '@/lib/types';

export type PaymentPolicyInput = {
  mode: TripPlan['depositMode'];
  value: number;
  amountDue: number;
};

export type PaymentPolicyResolution =
  | { valid: true; upfrontAmount: number }
  | {
      valid: false;
      reason: 'AMOUNT_DUE_INVALID' | 'DEPOSIT_VALUE_INVALID' | 'DEPOSIT_EXCEEDS_AMOUNT_DUE' | 'DEPOSIT_PERCENT_OUT_OF_RANGE';
    };

/**
 * Canonical payment-policy validation and upfront-amount calculation shared by
 * service and trip-plan flows. Percentage deposits round to the nearest whole
 * currency unit via Math.round.
 */
export function resolvePaymentPolicy({ mode, value, amountDue }: PaymentPolicyInput): PaymentPolicyResolution {
  if (!Number.isFinite(amountDue) || amountDue < 0) {
    return { valid: false, reason: 'AMOUNT_DUE_INVALID' };
  }

  switch (mode) {
    case 'NONE':
      return { valid: true, upfrontAmount: 0 };
    case 'FULL':
      return { valid: true, upfrontAmount: amountDue };
    case 'DEPOSIT_FIXED':
      if (!Number.isFinite(value) || value <= 0) {
        return { valid: false, reason: 'DEPOSIT_VALUE_INVALID' };
      }
      if (value > amountDue) {
        return { valid: false, reason: 'DEPOSIT_EXCEEDS_AMOUNT_DUE' };
      }
      return { valid: true, upfrontAmount: value };
    case 'DEPOSIT_PERCENT':
      if (!Number.isFinite(value) || value < 1 || value > 100) {
        return { valid: false, reason: 'DEPOSIT_PERCENT_OUT_OF_RANGE' };
      }
      return { valid: true, upfrontAmount: Math.round((amountDue * value) / 100) };
  }
}
