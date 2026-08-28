/**
 * #41 成團規則的純領域邊界。
 *
 * 這裡不讀取資料庫，也不派送通知；呼叫端必須在同一個資料庫交易中，依回傳的
 * 結果更新 Departure 與寫入 outbox。保持純函式讓 callback 重放與資料庫 RPC
 * 使用同一組可測的語意。
 */

import type { TourOrderStatus, TourPaymentStatus } from '@/lib/types';

export type DepositMode = 'NONE' | 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT' | 'FULL';

export type FormationStatus =
  | 'COLLECTING'
  | 'FORMED'
  | 'REVIEW_REQUIRED'
  | 'AT_RISK'
  | 'FAILED';

export type FormationTrigger =
  | 'QUALIFYING_PAYMENT'
  | 'QUALIFYING_CANCELLATION'
  | 'DEADLINE_REACHED'
  | 'GUIDE_OVERRIDE_FORM';

export type FormationDecision = {
  status: FormationStatus;
  formedBy?: 'SYSTEM' | 'GUIDE_OVERRIDE';
};

export type FormationEligibilityInput = {
  depositMode: DepositMode;
  orderStatus: TourOrderStatus;
  paymentStatus: TourPaymentStatus;
};

export type FormationTransitionInput = {
  qualifyingParticipants: number;
  minToDepart: number;
  trigger: FormationTrigger;
};

/**
 * 成團資格與「暫占名額」刻意分開。未完成付款的 PENDING 訂單可能佔 capacity，
 * 但從不會因此被數進 formation。
 */
export function qualifiesForFormation(input: FormationEligibilityInput): boolean {
  if (input.orderStatus === 'CANCELLED' || input.paymentStatus === 'REFUNDED') return false;
  if (input.orderStatus !== 'CONFIRMED' && input.orderStatus !== 'COMPLETED') return false;

  switch (input.depositMode) {
    case 'NONE':
      return true;
    case 'DEPOSIT_FIXED':
    case 'DEPOSIT_PERCENT':
      return input.paymentStatus === 'PARTIAL' || input.paymentStatus === 'PAID';
    case 'FULL':
      return input.paymentStatus === 'PAID';
  }
}

/**
 * 計算單一合法的 formation 狀態轉移。實際的 compare-and-set、audit 與 outbox
 * idempotency 由 #41 migration/RPC 在同一交易中執行，避免並發 callback 二次成團。
 */
export function transitionFormation(
  current: FormationStatus,
  input: FormationTransitionInput,
): FormationDecision {
  if (!Number.isInteger(input.qualifyingParticipants) || input.qualifyingParticipants < 0) {
    throw new Error('FORMATION_PARTICIPANTS_INVALID');
  }
  if (!Number.isInteger(input.minToDepart) || input.minToDepart < 1) {
    throw new Error('FORMATION_MINIMUM_INVALID');
  }

  const hasMinimum = input.qualifyingParticipants >= input.minToDepart;

  if (input.trigger === 'QUALIFYING_PAYMENT') {
    if (current === 'COLLECTING' && hasMinimum) return { status: 'FORMED', formedBy: 'SYSTEM' };
    return { status: current };
  }

  if (input.trigger === 'DEADLINE_REACHED') {
    if (current === 'COLLECTING' && !hasMinimum) return { status: 'REVIEW_REQUIRED' };
    return { status: current };
  }

  if (input.trigger === 'QUALIFYING_CANCELLATION') {
    if (current === 'FORMED' && !hasMinimum) return { status: 'AT_RISK' };
    return { status: current };
  }

  if (current === 'REVIEW_REQUIRED') {
    return { status: 'FORMED', formedBy: 'GUIDE_OVERRIDE' };
  }

  throw new Error('FORMATION_TRANSITION_INVALID');
}
