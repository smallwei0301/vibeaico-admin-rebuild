/**
 * #41 formation domain boundary. Database mutation, notification delivery, and
 * provider-specific callbacks intentionally stay outside this pure module.
 */
import type { TourOrderStatus, TourPaymentStatus } from '@/lib/types';

export type DepositMode = 'NONE' | 'DEPOSIT_FIXED' | 'DEPOSIT_PERCENT' | 'FULL';
export type FormationStatus = 'COLLECTING' | 'FORMED' | 'REVIEW_REQUIRED' | 'AT_RISK' | 'FAILED';
export type FormationTrigger = 'QUALIFYING_PAYMENT' | 'QUALIFYING_CANCELLATION' | 'DEADLINE_REACHED' | 'GUIDE_OVERRIDE_FORM';
export type FormationDecision = { status: FormationStatus; formedBy?: 'SYSTEM' | 'GUIDE_OVERRIDE' };

export function qualifiesForFormation(input: {
  depositMode: DepositMode;
  orderStatus: TourOrderStatus;
  paymentStatus: TourPaymentStatus;
}): boolean {
  if (input.orderStatus === 'CANCELLED' || input.paymentStatus === 'REFUNDED') return false;
  if (input.orderStatus !== 'CONFIRMED' && input.orderStatus !== 'COMPLETED') return false;
  if (input.depositMode === 'NONE') return true;
  if (input.depositMode === 'FULL') return input.paymentStatus === 'PAID';
  return input.paymentStatus === 'PARTIAL' || input.paymentStatus === 'PAID';
}

export function transitionFormation(
  current: FormationStatus,
  input: { qualifyingParticipants: number; minToDepart: number; trigger: FormationTrigger },
): FormationDecision {
  if (!Number.isInteger(input.qualifyingParticipants) || input.qualifyingParticipants < 0)
    throw new Error('FORMATION_PARTICIPANTS_INVALID');
  if (!Number.isInteger(input.minToDepart) || input.minToDepart < 1)
    throw new Error('FORMATION_MINIMUM_INVALID');
  const hasMinimum = input.qualifyingParticipants >= input.minToDepart;
  if (input.trigger === 'QUALIFYING_PAYMENT')
    return current === 'COLLECTING' && hasMinimum ? { status: 'FORMED', formedBy: 'SYSTEM' } : { status: current };
  if (input.trigger === 'DEADLINE_REACHED')
    return current === 'COLLECTING' && !hasMinimum ? { status: 'REVIEW_REQUIRED' } : { status: current };
  if (input.trigger === 'QUALIFYING_CANCELLATION')
    return current === 'FORMED' && !hasMinimum ? { status: 'AT_RISK' } : { status: current };
  if (current === 'REVIEW_REQUIRED') return { status: 'FORMED', formedBy: 'GUIDE_OVERRIDE' };
  throw new Error('FORMATION_TRANSITION_INVALID');
}

/** A replay cannot create another FORM event once the durable state is FORMED. */
export function callbackReplayIsNoop(current: FormationStatus, participants: number, minimum: number): boolean {
  return current === 'FORMED' && participants >= minimum;
}

/** Mirrors the tenant predicate required by the SQL formation RPC. */
export function assertFormationTenant(requestTenantId: string, resourceTenantId: string): void {
  if (!requestTenantId || requestTenantId !== resourceTenantId) throw new Error('FORMATION_TENANT_NOT_FOUND');
}
