import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { hashRecipientEmail, mapResendDeliveryEvent, verifyResendWebhook } from '@/server/notifications/resend-webhook';

const SECRET = `whsec_${Buffer.from('test-webhook-secret').toString('base64')}`;
const BODY = JSON.stringify({ type: 'email.delivered', data: { email_id: 're_123' } });
const NOW_SECONDS = 1_907_000_000;

function signature(body = BODY, timestamp = NOW_SECONDS) {
  const digest = createHmac('sha256', Buffer.from(SECRET.slice(6), 'base64'))
    .update(`evt_123.${timestamp}.${body}`)
    .digest('base64');
  return `v1,${digest}`;
}

describe('Resend delivery webhook (#40, 17 §3)', () => {
  it('accepts a current valid signature and rejects a changed body', () => {
    const headers = { id: 'evt_123', timestamp: String(NOW_SECONDS), signature: signature() };
    expect(verifyResendWebhook(BODY, headers, SECRET, NOW_SECONDS * 1000)).toBe(true);
    expect(verifyResendWebhook(`${BODY} `, headers, SECRET, NOW_SECONDS * 1000)).toBe(false);
  });

  it('rejects stale, missing, and malformed signatures', () => {
    expect(verifyResendWebhook(BODY, {
      id: 'evt_123', timestamp: String(NOW_SECONDS - 301), signature: signature(BODY, NOW_SECONDS - 301),
    }, SECRET, NOW_SECONDS * 1000)).toBe(false);
    expect(verifyResendWebhook(BODY, { id: null, timestamp: null, signature: null }, SECRET, NOW_SECONDS * 1000)).toBe(false);
    expect(verifyResendWebhook(BODY, {
      id: 'evt_123', timestamp: String(NOW_SECONDS), signature: 'v1,not-base64',
    }, SECRET, NOW_SECONDS * 1000)).toBe(false);
  });

  it('maps provider evidence without calling accepted delivered', () => {
    expect(mapResendDeliveryEvent('email.delivered')).toEqual({ status: 'DELIVERED', errorCode: null, unhealthy: false });
    expect(mapResendDeliveryEvent('email.bounced')).toEqual({ status: 'DEAD', errorCode: 'EMAIL_BOUNCED', unhealthy: true });
    expect(mapResendDeliveryEvent('email.complained')).toEqual({ status: 'DEAD', errorCode: 'EMAIL_COMPLAINED', unhealthy: true });
    expect(mapResendDeliveryEvent('email.opened')).toBeNull();
  });

  it('normalizes an address before creating its non-reversible health key', () => {
    expect(hashRecipientEmail(' Owner@Example.COM ', SECRET)).toBe(hashRecipientEmail('owner@example.com', SECRET));
    expect(hashRecipientEmail('owner@example.com', SECRET)).toMatch(/^\\x[0-9a-f]{64}$/);
    expect(hashRecipientEmail('owner@example.com', SECRET)).not.toContain('owner');
    expect(hashRecipientEmail('owner@example.com', SECRET)).not.toBe(hashRecipientEmail('owner@example.com', `${SECRET}-other`));
  });
});
