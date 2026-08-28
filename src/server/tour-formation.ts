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
  | 'GUIDE_OVERRIDE_FORM'
  | 'GUIDE_EXTEND'
  | 'GUIDE_CANCEL'
  | 'GUIDE_CONTINUE';

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

export type FormationDeadlineInput = {
  departureAt: Date;
  daysBefore: number;
  now: Date;
  override?: Date;
};

const DAY_MS = 86_400_000;

/**
 * 產生要存進 Departure 的具體截止時間。時區轉換由呼叫端先完成，
 * 這個邊界只負責 0–90 天、不得過期與不得晚於出發的不變規則。
 */
export function calculateFormationDeadline(input: FormationDeadlineInput): Date {
  const departureMs = input.departureAt.getTime();
  const nowMs = input.now.getTime();
  const overrideMs = input.override?.getTime();
  if (!Number.isFinite(departureMs) || !Number.isFinite(nowMs)
      || !Number.isInteger(input.daysBefore) || input.daysBefore < 0 || input.daysBefore > 90
      || (input.override && !Number.isFinite(overrideMs))) {
    throw new Error('FORMATION_DEADLINE_INVALID');
  }

  const deadlineMs = overrideMs ?? departureMs - input.daysBefore * DAY_MS;
  if (departureMs <= nowMs || deadlineMs <= nowMs || deadlineMs > departureMs) {
    throw new Error('FORMATION_DEADLINE_INVALID');
  }
  return new Date(deadlineMs);
}

/**
 * 成團資格與「暫占名額」刻意分開。未完成付款的 PENDING 訂單可能佔 capacity，
 * 但從不會因此被數進 formation。
 */
export function qualifiesForFormation(input: FormationEligibilityInput): boolean {
  if (input.orderStatus === 'CANCELLED'
      || input.paymentStatus === 'REFUND_PENDING'
      || input.paymentStatus === 'REFUNDED') return false;
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

  if (input.trigger === 'GUIDE_OVERRIDE_FORM' && current === 'REVIEW_REQUIRED') {
    return { status: 'FORMED', formedBy: 'GUIDE_OVERRIDE' };
  }

  if (input.trigger === 'GUIDE_EXTEND' && current === 'REVIEW_REQUIRED') {
    return { status: 'COLLECTING' };
  }

  if (input.trigger === 'GUIDE_CONTINUE' && current === 'AT_RISK') {
    return { status: 'FORMED' };
  }

  if (input.trigger === 'GUIDE_CANCEL'
      && (current === 'REVIEW_REQUIRED' || current === 'AT_RISK')) {
    return { status: 'FAILED' };
  }

  throw new Error('FORMATION_TRANSITION_INVALID');
}
