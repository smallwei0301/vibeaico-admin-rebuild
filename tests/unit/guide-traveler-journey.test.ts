import { describe, expect, it } from 'vitest';

import {
  buildGuideCheckoutFields,
  buildGuideCompletionView,
  buildGuideSaleOption,
} from '@/lib/guide-traveler-journey';
import { guideTravelerJourneyPage as t } from '@/i18n/zh-TW/pages/guide-traveler-journey';

describe('GUIDE 旅客一條龍 view-model（19 分冊 §2）', () => {
  it('第一屏固定三個必要欄位，方案問題最多再加兩個', () => {
    expect(buildGuideCheckoutFields([])).toEqual([
      { key: 'contactName', kind: 'TEXT', required: true },
      { key: 'contactMethod', kind: 'CONTACT_METHOD', required: true },
      { key: 'partySize', kind: 'PARTY_SIZE', required: true },
    ]);

    expect(buildGuideCheckoutFields([
      { id: 'pickup', kind: 'TEXT' },
      { id: 'fitness', kind: 'CHOICE' },
    ])).toEqual([
      { key: 'contactName', kind: 'TEXT', required: true },
      { key: 'contactMethod', kind: 'CONTACT_METHOD', required: true },
      { key: 'partySize', kind: 'PARTY_SIZE', required: true },
      { key: 'question:pickup', kind: 'TEXT', required: true },
      { key: 'question:fitness', kind: 'CHOICE', required: true },
    ]);
    expect(() => buildGuideCheckoutFields([
      { id: 'one', kind: 'TEXT' },
      { id: 'two', kind: 'TEXT' },
      { id: 'three', kind: 'TEXT' },
    ])).toThrow('GUIDE_REQUIRED_QUESTIONS_LIMIT');
  });

  it.each([
    ['INSTANT', 'availableSlot', 'checkout'],
    ['REQUEST', 'candidateSlot', 'apply'],
  ] as const)('%s 只暴露對應的真實選擇與下一步', (salesMode, selector, action) => {
    expect(buildGuideSaleOption(salesMode)).toEqual({ salesMode, selector, action });
  });

  it('固定團次顯示名額、成團進度、尚差人數與截止日', () => {
    expect(buildGuideSaleOption('SCHEDULED', {
      departsOn: '2026-09-20', startTime: '09:30',
      capacity: 12,
      seatsBooked: 7,
      minToDepart: 8,
      qualifyingParticipants: 5,
      formationDeadlineAt: '2026-09-10T15:59:59.000Z',
      salesStatus: 'OPEN', formationStatus: 'COLLECTING',
    })).toEqual({
      salesMode: 'SCHEDULED', selector: 'departure', action: 'reserve',
      availability: {
        departsOn: '2026-09-20', startTime: '09:30',
        remainingSeats: 5,
        minToDepart: 8,
        qualifyingParticipants: 5,
        remainingToForm: 3,
        formationDeadlineAt: '2026-09-10T15:59:59.000Z',
        salesStatus: 'OPEN', formationStatus: 'COLLECTING',
      },
    });
  });

  it('REQUEST 尚未接受時誠實顯示未鎖位，不能宣稱預約成功', () => {
    const view = buildGuideCompletionView({
      salesMode: 'REQUEST', requestStatus: 'PENDING', paymentStatus: 'UNPAID',
      formationStatus: null, totalAmount: 3600, paidAmount: 0, paymentDueAt: null,
      referenceNo: 'REQ-20260828-001', formationProgress: null,
      meetingInfoAvailableAt: '導遊接受申請後提供',
      orderUrl: '/orders/REQ-20260828-001', guideContactUrl: '/contact/guide-1',
    });

    expect(view).toEqual({
      state: 'REQUEST_PENDING', headline: 'requestPending', nextAction: 'waitForGuide',
      paidAmount: 0, balanceDue: 3600, paymentDueAt: null,
      referenceNo: 'REQ-20260828-001', formationProgress: null,
      meetingInfoAvailableAt: '導遊接受申請後提供',
      orderUrl: '/orders/REQ-20260828-001', guideContactUrl: '/contact/guide-1',
    });
    expect(t.completion.requestPending).toBe('申請已送出，尚未保留時段');
    expect(t.completion.requestPending).not.toContain('預約成功');
  });

  it.each([
    [{ paymentStatus: 'UNPAID', formationStatus: 'COLLECTING', paidAmount: 0 }, 'WAITING_PAYMENT', 'waitingPayment', 'pay'],
    [{ paymentStatus: 'PARTIAL', formationStatus: 'COLLECTING', paidAmount: 1000 }, 'DEPOSIT_PAID_COLLECTING', 'depositPaidCollecting', 'waitForFormation'],
    [{ paymentStatus: 'PARTIAL', formationStatus: 'FORMED', paidAmount: 1000 }, 'FORMED_BALANCE_DUE', 'formedBalanceDue', 'payBalance'],
    [{ paymentStatus: 'PAID', formationStatus: 'FORMED', paidAmount: 3600 }, 'PAID_IN_FULL', 'paidInFull', 'viewOrder'],
  ] as const)('付款與成團事實決定成功頁，不從 provider accepted 猜付款', (facts, state, headline, nextAction) => {
    expect(buildGuideCompletionView({
      salesMode: 'SCHEDULED', requestStatus: null,
      totalAmount: 3600, paymentDueAt: '2026-09-01T15:59:59.000Z', ...facts,
      referenceNo: 'TO-20260828-001',
      formationProgress: facts.formationStatus === 'FORMED' ? null : {
        minToDepart: 4, qualifyingParticipants: 2,
        latestNotificationAt: '2026-09-03T15:59:59.000Z',
      },
      meetingInfoAvailableAt: '2026-09-15T00:00:00.000Z',
      orderUrl: '/orders/TO-20260828-001', guideContactUrl: '/contact/guide-1',
    })).toEqual({
      state, headline, nextAction, paidAmount: facts.paidAmount,
      balanceDue: 3600 - facts.paidAmount,
      paymentDueAt: '2026-09-01T15:59:59.000Z',
      referenceNo: 'TO-20260828-001',
      formationProgress: facts.formationStatus === 'FORMED' ? null : {
        minToDepart: 4, qualifyingParticipants: 2, remainingToForm: 2,
        latestNotificationAt: '2026-09-03T15:59:59.000Z',
      },
      meetingInfoAvailableAt: '2026-09-15T00:00:00.000Z',
      orderUrl: '/orders/TO-20260828-001', guideContactUrl: '/contact/guide-1',
    });
  });

  it('拒絕不可能的付款金額，不用 clamp 掩蓋上游資料錯誤', () => {
    expect(() => buildGuideCompletionView({
      salesMode: 'SCHEDULED', requestStatus: null,
      paymentStatus: 'PAID', formationStatus: 'FORMED',
      totalAmount: 3600, paidAmount: 3601, paymentDueAt: null,
      referenceNo: 'TO-invalid', formationProgress: null,
      meetingInfoAvailableAt: 'later', orderUrl: '/orders/invalid',
      guideContactUrl: '/contact/guide-1',
    })).toThrow('GUIDE_PAYMENT_FACTS_INVALID');
  });

  it('成團尚差人數由事實計算，拒絕有效人數超過門檻的矛盾進度', () => {
    expect(() => buildGuideCompletionView({
      salesMode: 'SCHEDULED', requestStatus: null,
      paymentStatus: 'PARTIAL', formationStatus: 'COLLECTING',
      totalAmount: 3600, paidAmount: 1000, paymentDueAt: null,
      referenceNo: 'TO-invalid-formation',
      formationProgress: {
        minToDepart: 4, qualifyingParticipants: 5,
        latestNotificationAt: '2026-09-03T15:59:59.000Z',
      },
      meetingInfoAvailableAt: 'later', orderUrl: '/orders/invalid',
      guideContactUrl: '/contact/guide-1',
    })).toThrow('GUIDE_FORMATION_FACTS_INVALID');
  });
});
