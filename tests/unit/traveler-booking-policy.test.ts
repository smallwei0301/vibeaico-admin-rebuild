import { describe, expect, it } from 'vitest';
import { resolveTravelerBookingPolicy } from '@/server/traveler-booking-policy';

const available = {
  tenantOpen: true,
  hasCapacity: true,
  hasAvailableStaff: true,
  paymentSafetySatisfied: true,
};

describe('resolveTravelerBookingPolicy (19 §4 / Issue #44)', () => {
  it('DEFAULT 沿用方案販售與收款政策', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'DEFAULT' },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'INSTANT',
      deposit: { mode: 'NONE', value: 0 },
    });
  });

  it('DEFAULT 保留現有 TripPlan 的固定團次 SCHEDULED 契約', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'DEFAULT' },
      plan: { salesMode: 'SCHEDULED', depositMode: 'DEPOSIT_PERCENT', depositValue: 30 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'SCHEDULED',
      deposit: { mode: 'DEPOSIT_PERCENT', value: 30 },
    });
  });

  it('FORCE_DEPOSIT 覆蓋方案的免預收政策', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_FIXED', value: 1_000 } },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'INSTANT',
      deposit: { mode: 'DEPOSIT_FIXED', value: 1_000 },
    });
  });

  it('REQUEST_ONLY 將即時成交降為申請，但保留方案收款 snapshot', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'REQUEST_ONLY' },
      plan: { salesMode: 'INSTANT', depositMode: 'FULL', depositValue: 0 },
      availability: available,
    })).toEqual({
      allowed: true,
      checkoutMode: 'REQUEST',
      deposit: { mode: 'FULL', value: 0 },
    });
  });

  it('BLOCK_SELF_SERVICE 阻擋旅客自助，但保留後台代建能力', () => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'BLOCK_SELF_SERVICE' },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
      source: 'TRAVELER',
    })).toEqual({
      allowed: false,
      reason: 'CONTACT_GUIDE',
    });

    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'BLOCK_SELF_SERVICE' },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
      source: 'ADMIN',
    })).toEqual({
      allowed: true,
      checkoutMode: 'INSTANT',
      deposit: { mode: 'NONE', value: 0 },
    });
  });

  it.each([
    ['tenantOpen', 'TENANT_CLOSED'],
    ['hasCapacity', 'CAPACITY_UNAVAILABLE'],
    ['hasAvailableStaff', 'STAFF_UNAVAILABLE'],
    ['paymentSafetySatisfied', 'PAYMENT_UNSAFE'],
  ] as const)('旅客政策不能繞過 %s 安全門', (gate, reason) => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit: { mode: 'DEPOSIT_PERCENT', value: 30 } },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: { ...available, [gate]: false },
    })).toEqual({ allowed: false, reason });
  });

  it.each([
    [{ mode: 'NONE', value: 1_000 }, 'FORCE_DEPOSIT_MODE_REQUIRED'],
    [{ mode: 'FULL', value: 0 }, 'FORCE_DEPOSIT_MODE_REQUIRED'],
    [{ mode: 'DEPOSIT_FIXED', value: 0 }, 'FORCE_DEPOSIT_VALUE_INVALID'],
    [{ mode: 'DEPOSIT_PERCENT', value: 101 }, 'FORCE_DEPOSIT_VALUE_INVALID'],
  ] as const)('拒絕不相容的強制定金規則 %#', (deposit, reason) => {
    expect(resolveTravelerBookingPolicy({
      policy: { kind: 'FORCE_DEPOSIT', deposit },
      plan: { salesMode: 'INSTANT', depositMode: 'NONE', depositValue: 0 },
      availability: available,
    })).toEqual({ allowed: false, reason });
  });
});
