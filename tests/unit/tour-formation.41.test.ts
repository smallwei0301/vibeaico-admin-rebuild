import { describe, expect, it } from 'vitest';
import {
  calculateFormationDeadline,
  qualifiesForFormation,
  transitionFormation,
  type FormationEligibilityInput,
  type FormationStatus,
} from '@/server/tour-formation';

const qualifies = (
  input: Omit<FormationEligibilityInput, 'paidAmount' | 'upfrontRequiredAmount' | 'totalAmount'>
    & Partial<Pick<FormationEligibilityInput, 'paidAmount' | 'upfrontRequiredAmount' | 'totalAmount'>>,
) => qualifiesForFormation({
  paidAmount: 0,
  upfrontRequiredAmount: 0,
  totalAmount: 100,
  ...input,
});

describe('qualifiesForFormation (#41, 18 §5)', () => {
  it('NONE 在訂單成立後即可計入，不把未付款 hold 當成必要付款', () => {
    expect(qualifies({
      depositMode: 'NONE', orderStatus: 'CONFIRMED', paymentStatus: 'UNPAID',
    })).toBe(true);
  });

  it.each(['DEPOSIT_FIXED', 'DEPOSIT_PERCENT'] as const)(
    '%s 只在訂金實際確認後計入',
    (depositMode) => {
      expect(qualifies({ depositMode, orderStatus: 'PENDING', paymentStatus: 'PARTIAL' })).toBe(false);
      expect(qualifies({
        depositMode, orderStatus: 'CONFIRMED', paymentStatus: 'PARTIAL',
        paidAmount: 50, upfrontRequiredAmount: 50,
      })).toBe(true);
    },
  );

  it('PARTIAL 只有實收達 upfront required amount 才算有效報名', () => {
    expect(qualifies({
      depositMode: 'DEPOSIT_FIXED', orderStatus: 'CONFIRMED', paymentStatus: 'PARTIAL',
      paidAmount: 49, upfrontRequiredAmount: 50, totalAmount: 100,
    })).toBe(false);
    expect(qualifies({
      depositMode: 'DEPOSIT_FIXED', orderStatus: 'CONFIRMED', paymentStatus: 'PARTIAL',
      paidAmount: 50, upfrontRequiredAmount: 50, totalAmount: 100,
    })).toBe(true);
  });

  it('FULL 必須全額確認；未付款 hold 只占 capacity 不算 formation', () => {
    expect(qualifies({
      depositMode: 'FULL', orderStatus: 'PENDING', paymentStatus: 'UNPAID',
    })).toBe(false);
    expect(qualifies({
      depositMode: 'FULL', orderStatus: 'CONFIRMED', paymentStatus: 'PARTIAL',
    })).toBe(false);
    expect(qualifies({
      depositMode: 'FULL', orderStatus: 'CONFIRMED', paymentStatus: 'PAID',
      paidAmount: 99, upfrontRequiredAmount: 100, totalAmount: 100,
    })).toBe(false);
    expect(qualifies({
      depositMode: 'FULL', orderStatus: 'CONFIRMED', paymentStatus: 'PAID',
      paidAmount: 100, upfrontRequiredAmount: 100, totalAmount: 100,
    })).toBe(true);
  });

  it('已取消或已退款的訂單絕不計入', () => {
    expect(qualifies({
      depositMode: 'NONE', orderStatus: 'CANCELLED', paymentStatus: 'UNPAID',
    })).toBe(false);
    expect(qualifies({
      depositMode: 'FULL', orderStatus: 'CONFIRMED', paymentStatus: 'REFUNDED',
    })).toBe(false);
    expect(qualifies({
      depositMode: 'NONE', orderStatus: 'CONFIRMED', paymentStatus: 'REFUND_PENDING',
    })).toBe(false);
  });
});

describe('calculateFormationDeadline (#41, 18 §2)', () => {
  const departureAt = new Date('2026-12-31T02:00:00.000Z');
  const now = new Date('2026-08-28T00:00:00.000Z');

  it.each([0, 3, 5, 7, 14, 90])('%d 天都保留為團次 snapshot，不受 Plan 後改影響', (daysBefore) => {
    const deadline = calculateFormationDeadline({ departureAt, daysBefore, now });
    expect(deadline.toISOString()).toBe(new Date(departureAt.getTime() - daysBefore * 86_400_000).toISOString());
  });

  it('短期開團不會靜默產生已過期截止時間', () => {
    expect(() => calculateFormationDeadline({
      departureAt: new Date('2026-08-30T02:00:00.000Z'), daysBefore: 7, now,
    })).toThrow('FORMATION_DEADLINE_INVALID');
  });

  it('允許導遊為短期團次明確覆寫未來截止時間', () => {
    expect(calculateFormationDeadline({
      departureAt: new Date('2026-08-30T02:00:00.000Z'),
      daysBefore: 7,
      override: new Date('2026-08-29T02:00:00.000Z'),
      now,
    }).toISOString()).toBe('2026-08-29T02:00:00.000Z');
  });
});

describe('transitionFormation (#41, 18 §3/§6)', () => {
  const expectStatus = (current: FormationStatus, input: Parameters<typeof transitionFormation>[1], status: FormationStatus) =>
    expect(transitionFormation(current, input).status).toBe(status);

  it('最後一筆有效付款剛好達門檻時，只從 COLLECTING 成團一次', () => {
    expectStatus('COLLECTING', { qualifyingParticipants: 4, minToDepart: 4, trigger: 'QUALIFYING_PAYMENT' }, 'FORMED');
    expectStatus('FORMED', { qualifyingParticipants: 4, minToDepart: 4, trigger: 'QUALIFYING_PAYMENT' }, 'FORMED');
  });

  it('截止仍不足時轉 REVIEW_REQUIRED，不自動取消', () => {
    expectStatus('COLLECTING', { qualifyingParticipants: 3, minToDepart: 4, trigger: 'DEADLINE_REACHED' }, 'REVIEW_REQUIRED');
  });

  it('導遊可在 REVIEW_REQUIRED 覆寫成團，並保留 GUIDE_OVERRIDE 來源', () => {
    expect(transitionFormation('REVIEW_REQUIRED', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_OVERRIDE_FORM',
    })).toMatchObject({
      status: 'FORMED', formedBy: 'GUIDE_OVERRIDE', acceptedRiskParticipants: 3,
    });
  });

  it('已成團後掉到門檻下只進 AT_RISK，絕不自動倒退 COLLECTING', () => {
    expectStatus('FORMED', { qualifyingParticipants: 3, minToDepart: 4, trigger: 'QUALIFYING_CANCELLATION' }, 'AT_RISK');
  });

  it('導遊接受 3/4 風險後，維持 3/4 不重複進 AT_RISK；再掉到 2/4 才重警示', () => {
    expectStatus('FORMED', {
      qualifyingParticipants: 3, minToDepart: 4, acceptedRiskParticipants: 3,
      trigger: 'QUALIFYING_CANCELLATION',
    }, 'FORMED');
    expectStatus('FORMED', {
      qualifyingParticipants: 2, minToDepart: 4, acceptedRiskParticipants: 3,
      trigger: 'QUALIFYING_CANCELLATION',
    }, 'AT_RISK');
  });

  it('導遊可延長募集、取消未成團團次，或確認高風險團繼續出團', () => {
    expectStatus('REVIEW_REQUIRED', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_EXTEND',
    }, 'COLLECTING');
    expectStatus('REVIEW_REQUIRED', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_CANCEL',
    }, 'FAILED');
    expect(transitionFormation('AT_RISK', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_CONTINUE',
    })).toMatchObject({ status: 'FORMED', acceptedRiskParticipants: 3 });
    expectStatus('AT_RISK', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_CANCEL',
    }, 'FAILED');
  });

  it('不接受不合法的人工轉移', () => {
    expect(() => transitionFormation('COLLECTING', {
      qualifyingParticipants: 3, minToDepart: 4, trigger: 'GUIDE_OVERRIDE_FORM',
    })).toThrow('FORMATION_TRANSITION_INVALID');
  });
});
