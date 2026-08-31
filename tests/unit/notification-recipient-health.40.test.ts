import { beforeEach, describe, expect, it, vi } from 'vitest';
import { emailRecipientGate } from '@/server/notifications/outbox';

describe('notification recipient-health gate (#40, 17 §3)', () => {
  beforeEach(() => vi.unstubAllEnvs());

  it('fails closed without the hash key and does not query or send as healthy', async () => {
    vi.stubEnv('RESEND_RECIPIENT_HEALTH_KEY', undefined);
    const from = vi.fn();

    await expect(emailRecipientGate({ from } as never, 'owner@example.com'))
      .resolves.toEqual({ kind: 'retryable', code: 'RECIPIENT_HEALTH_KEY_MISSING' });

    expect(from).not.toHaveBeenCalled();
  });
});
