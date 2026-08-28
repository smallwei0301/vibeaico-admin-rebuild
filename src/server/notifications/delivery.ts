/**
 * Delivery-state rules shared by the outbox dispatcher and cron worker.
 *
 * This file intentionally has no database or provider imports.  The provider
 * adapter reports a small outcome; this module is the only place that turns it
 * into persisted delivery state.  That keeps "accepted" distinct from
 * "delivered" across Email, Telegram, and future channels (17 §2–3).
 */

export type NotificationChannel = 'EMAIL' | 'TELEGRAM' | 'LINE';
export type DeliveryStatus =
  | 'PENDING' | 'PROCESSING' | 'ACCEPTED' | 'DELIVERED' | 'RETRY' | 'DEAD' | 'SKIPPED';
export type OutboxStatus = 'OPEN' | 'COMPLETE' | 'DEAD';

export interface DeliveryRow {
  id: string;
  status: DeliveryStatus;
}

export type TransportOutcome =
  | { kind: 'accepted'; providerMessageId: string }
  | { kind: 'delivered'; providerMessageId?: string }
  | { kind: 'skipped'; code: string; message?: string }
  | { kind: 'retryable'; code: string; message?: string }
  | { kind: 'permanent'; code: string; message?: string; invalidateBinding?: boolean };

export interface DeliveryTransition {
  status: DeliveryStatus;
  attemptCount: number;
  nextAttemptAt: string | null;
  providerMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  acceptedAt: string | null;
  deliveredAt: string | null;
  bindingInvalid: boolean;
}

/** Five provider attempts total. Failures 1–4 wait before the next attempt; failure 5 is DEAD. */
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 30 * 60_000] as const;

/** `attemptCount` is the failed attempt number, starting at one. */
export function retryAt(attemptCount: number, now = new Date()): Date | null {
  const delay = RETRY_DELAYS_MS[attemptCount - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay);
}

export function deliveryTransition(
  outcome: TransportOutcome,
  now = new Date(),
  priorAttemptCount = 0,
): DeliveryTransition {
  const attempted = priorAttemptCount + 1;
  const iso = now.toISOString();
  const base = {
    attemptCount: attempted,
    providerMessageId: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    acceptedAt: null,
    deliveredAt: null,
    bindingInvalid: false,
  };

  if (outcome.kind === 'accepted') {
    return { ...base, status: 'ACCEPTED', nextAttemptAt: null, providerMessageId: outcome.providerMessageId, acceptedAt: iso };
  }
  if (outcome.kind === 'delivered') {
    return { ...base, status: 'DELIVERED', nextAttemptAt: null, providerMessageId: outcome.providerMessageId ?? null, deliveredAt: iso };
  }
  if (outcome.kind === 'skipped') {
    return { ...base, status: 'SKIPPED', nextAttemptAt: null, lastErrorCode: outcome.code,
      lastErrorMessage: outcome.message ? redactDeliveryError(outcome.message) : null };
  }
  if (outcome.kind === 'permanent') {
    return { ...base, status: 'DEAD', nextAttemptAt: null, lastErrorCode: outcome.code,
      lastErrorMessage: outcome.message ? redactDeliveryError(outcome.message) : null,
      bindingInvalid: outcome.invalidateBinding ?? false };
  }

  const nextAttemptAt = retryAt(attempted, now);
  return {
    ...base,
    status: nextAttemptAt ? 'RETRY' : 'DEAD',
    nextAttemptAt: nextAttemptAt?.toISOString() ?? null,
    lastErrorCode: outcome.code,
    lastErrorMessage: outcome.message ? redactDeliveryError(outcome.message) : null,
  };
}

export function completionStatus(deliveries: DeliveryRow[]): OutboxStatus {
  if (deliveries.some((delivery) => delivery.status === 'PENDING' || delivery.status === 'PROCESSING' || delivery.status === 'RETRY'))
    return 'OPEN';
  return deliveries.some((delivery) => delivery.status === 'DEAD') ? 'DEAD' : 'COMPLETE';
}

/** Transport classification never records provider response bodies verbatim. */
export function classifyTransportFailure(
  channel: NotificationChannel,
  status: number | undefined,
  message = '',
): Extract<TransportOutcome, { kind: 'retryable' | 'permanent' }> {
  const normalized = message.toLowerCase();
  if (channel === 'TELEGRAM' && (status === 400 || status === 403) &&
    (normalized.includes('blocked') || normalized.includes('chat not found') || normalized.includes('user is deactivated')))
    return { kind: 'permanent', code: 'TELEGRAM_BLOCKED', invalidateBinding: true };
  if (status === 400 || status === 401 || status === 403 || status === 404 || status === 422)
    return { kind: 'permanent', code: `HTTP_${status}` };
  if (status === 408 || status === 429 || (status !== undefined && status >= 500))
    return { kind: 'retryable', code: `HTTP_${status}` };
  return { kind: 'retryable', code: 'TRANSPORT_ERROR' };
}

/** Store useful diagnostics without persisting addresses, chat ids, or secrets. */
export function redactDeliveryError(value: string): string {
  return value
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, '[redacted]')
    .replace(/\b(?:chat\s+)?\d{7,}\b/gi, (match) => match.toLowerCase().startsWith('chat ') ? 'chat [redacted]' : '[redacted]')
    .replace(/(authorization:\s*bearer\s+)[^\s,;]+/gi, '$1[redacted]')
    .replace(/\b(?:bot)?\d{6,}:[A-Za-z0-9_-]{20,}\b/g, '[redacted]')
    .slice(0, 500);
}
