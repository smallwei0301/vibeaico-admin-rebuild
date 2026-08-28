import { describe, expect, it } from 'vitest';
import {
  classifyTransportFailure,
  completionStatus,
  deliveryTransition,
  redactDeliveryError,
  retryAt,
  type DeliveryRow,
} from '@/server/notifications/delivery';

const NOW = new Date('2030-06-05T01:02:03.000Z');

describe('notification delivery lifecycle (#40, 17 §1–2)', () => {
  it('keeps provider acceptance distinct from inbox delivery', () => {
    const transition = deliveryTransition({ kind: 'accepted', providerMessageId: 'resend_123' }, NOW);
    expect(transition).toMatchObject({
      status: 'ACCEPTED', providerMessageId: 'resend_123', acceptedAt: NOW.toISOString(), deliveredAt: null,
    });
  });

  it('retries transient provider failures with bounded backoff, then dead-letters the fifth failure', () => {
    expect(retryAt(1, NOW)?.toISOString()).toBe('2030-06-05T01:03:03.000Z');
    expect(retryAt(2, NOW)?.toISOString()).toBe('2030-06-05T01:07:03.000Z');
    expect(retryAt(4, NOW)?.toISOString()).toBe('2030-06-05T01:32:03.000Z');
    expect(retryAt(5, NOW)).toBeNull();

    expect(deliveryTransition({ kind: 'retryable', code: 'HTTP_503', message: 'unavailable' }, NOW, 1))
      .toMatchObject({ status: 'RETRY', attemptCount: 2, nextAttemptAt: '2030-06-05T01:07:03.000Z' });
    expect(deliveryTransition({ kind: 'retryable', code: 'HTTP_503', message: 'unavailable' }, NOW, 4))
      .toMatchObject({ status: 'DEAD', attemptCount: 5, nextAttemptAt: null });
  });

  it('does not retry a blocked Telegram binding and marks it invalid for rebinding', () => {
    expect(classifyTransportFailure('TELEGRAM', 403, 'Forbidden: bot was blocked by the user'))
      .toEqual({ kind: 'permanent', code: 'TELEGRAM_BLOCKED', invalidateBinding: true });
    expect(deliveryTransition({ kind: 'permanent', code: 'TELEGRAM_BLOCKED', message: 'blocked' }, NOW, 0))
      .toMatchObject({ status: 'DEAD', attemptCount: 1, lastErrorCode: 'TELEGRAM_BLOCKED' });
  });

  it('treats Telegram blocked, deactivated, and chat-not-found responses as invalid bindings regardless of provider status variant', () => {
    for (const [status, message] of [
      [403, 'Forbidden: user is deactivated'],
      [400, 'Bad Request: chat not found'],
    ] as const) {
      expect(classifyTransportFailure('TELEGRAM', status, message))
        .toEqual({ kind: 'permanent', code: 'TELEGRAM_BLOCKED', invalidateBinding: true });
    }
  });

  it('only completes an outbox event when every delivery has reached a terminal state', () => {
    const delivery = (status: DeliveryRow['status']): DeliveryRow => ({ id: status, status });
    expect(completionStatus([delivery('ACCEPTED'), delivery('SKIPPED')])).toBe('COMPLETE');
    expect(completionStatus([delivery('DEAD'), delivery('DELIVERED')])).toBe('DEAD');
    expect(completionStatus([delivery('RETRY'), delivery('ACCEPTED')])).toBe('OPEN');
  });

  it('redacts destination values, bearer tokens and provider bodies before persisting an error', () => {
    expect(redactDeliveryError(
      'telegram chat 123456789 email owner@example.com Authorization: Bearer secret-token',
    )).toBe('telegram chat [redacted] email [redacted] Authorization: Bearer [redacted]');
  });
});
