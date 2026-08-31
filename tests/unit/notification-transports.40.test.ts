import { describe, expect, it, vi } from 'vitest';

const { resendSend } = vi.hoisted(() => ({ resendSend: vi.fn() }));

vi.mock('resend', () => ({
  Resend: class { emails = { send: resendSend }; },
}));

import { sendEmailTransport, sendEmailWithResend, sendTelegramTransport } from '@/server/notifications/transports';

describe('notification transports (#40, 17 §3–4)', () => {
  it('records Resend API success as ACCEPTED, never DELIVERED', async () => {
    const outcome = await sendEmailTransport(
      { apiKey: 'test-key', from: 'VibeAI <noreply@example.com>', to: 'owner@example.com', subject: '通知', html: '<p>ok</p>' },
      async () => ({ data: { id: 're_123' }, error: null }),
    );
    expect(outcome).toEqual({ kind: 'accepted', providerMessageId: 're_123' });
  });

  it('does not call an Email provider when the platform transport is unconfigured', async () => {
    const sender = vi.fn();
    await expect(sendEmailTransport(
      { apiKey: '', from: 'VibeAI <noreply@example.com>', to: 'owner@example.com', subject: '通知', html: '<p>ok</p>' }, sender,
    )).resolves.toEqual({ kind: 'skipped', code: 'NOT_CONFIGURED' });
    expect(sender).not.toHaveBeenCalled();
  });

  it('passes a stable delivery key to Resend for provider-side retry deduplication', async () => {
    resendSend.mockReset();
    resendSend.mockResolvedValue({ data: { id: 're_delivery_1' }, error: null });

    await expect(sendEmailWithResend({
      apiKey: 'test-key', from: 'VibeAI <noreply@example.com>', to: 'owner@example.com',
      subject: '通知', html: '<p>ok</p>', idempotencyKey: 'delivery-1',
    })).resolves.toEqual({ kind: 'accepted', providerMessageId: 're_delivery_1' });

    expect(resendSend).toHaveBeenCalledWith(
      { from: 'VibeAI <noreply@example.com>', to: 'owner@example.com', subject: '通知', html: '<p>ok</p>' },
      { idempotencyKey: 'delivery-1' },
    );
  });

  it('keeps Telegram 403 blocked as a permanent invalid-binding result', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: false, description: 'Forbidden: bot was blocked by the user' }), {
      status: 403, headers: { 'content-type': 'application/json' },
    }));
    await expect(sendTelegramTransport({ token: 'bot-token', chatId: '123', text: '通知' }, fetcher))
      .resolves.toEqual({ kind: 'permanent', code: 'TELEGRAM_BLOCKED', invalidateBinding: true });
  });

  it('persists the Telegram message id only after sendMessage succeeds', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { message_id: 77 } }), {
      headers: { 'content-type': 'application/json' },
    }));
    await expect(sendTelegramTransport({ token: 'bot-token', chatId: '123', text: '通知' }, fetcher))
      .resolves.toEqual({ kind: 'accepted', providerMessageId: '77' });
    expect(fetcher).toHaveBeenCalledWith(
      'https://api.telegram.org/botbot-token/sendMessage',
      expect.objectContaining({ method: 'POST' }),
    );
  });
});
