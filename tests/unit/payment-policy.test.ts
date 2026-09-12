import { describe, expect, it } from 'vitest';
import { resolvePaymentPolicy } from '@/server/payment-policy';

describe('resolvePaymentPolicy', () => {
  it('allows a fixed deposit equal to the amount due but denies one above it', () => {
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_FIXED', value: 1_000, amountDue: 1_000 }))
      .toEqual({ valid: true, upfrontAmount: 1_000 });
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_FIXED', value: 1_001, amountDue: 1_000 }))
      .toEqual({ valid: false, reason: 'DEPOSIT_EXCEEDS_AMOUNT_DUE' });
  });

  it('enforces percent boundaries and applies the canonical nearest-integer rounding', () => {
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_PERCENT', value: 1, amountDue: 999 }))
      .toEqual({ valid: true, upfrontAmount: 10 });
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_PERCENT', value: 100, amountDue: 999 }))
      .toEqual({ valid: true, upfrontAmount: 999 });
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_PERCENT', value: 0, amountDue: 999 }))
      .toEqual({ valid: false, reason: 'DEPOSIT_PERCENT_OUT_OF_RANGE' });
    expect(resolvePaymentPolicy({ mode: 'DEPOSIT_PERCENT', value: 100.1, amountDue: 999 }))
      .toEqual({ valid: false, reason: 'DEPOSIT_PERCENT_OUT_OF_RANGE' });
  });

  it('maps NONE and FULL to their defined upfront amount', () => {
    expect(resolvePaymentPolicy({ mode: 'NONE', value: 0, amountDue: 999 }))
      .toEqual({ valid: true, upfrontAmount: 0 });
    expect(resolvePaymentPolicy({ mode: 'FULL', value: 0, amountDue: 999 }))
      .toEqual({ valid: true, upfrontAmount: 999 });
  });
});
