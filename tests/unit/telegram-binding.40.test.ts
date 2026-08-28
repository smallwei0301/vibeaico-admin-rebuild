import { describe, expect, it } from 'vitest';
import { hashBindCode, hashBindCodeBytea, isValidBindCode, verifyTelegramWebhookSecret } from '@/server/notifications/telegram-binding';

describe('Telegram binding security (#40, 17 §4)', () => {
  it('uses constant-time webhook secret verification and rejects missing / different lengths', () => {
    expect(verifyTelegramWebhookSecret('secret-1234567890', 'secret-1234567890')).toBe(true);
    expect(verifyTelegramWebhookSecret('secret-1234567890', 'secret-1234567891')).toBe(false);
    expect(verifyTelegramWebhookSecret('secret-1234567890', null)).toBe(false);
    expect(verifyTelegramWebhookSecret('secret-1234567890', 'short')).toBe(false);
  });

  it('accepts only opaque one-time start codes and stores their SHA-256 hash', () => {
    expect(isValidBindCode('YTXZ0S6_Pp6EJqmdJ7jvLw')).toBe(true);
    expect(isValidBindCode('/start YTXZ0S6_Pp6EJqmdJ7jvLw')).toBe(false);
    expect(isValidBindCode('too short')).toBe(false);
    expect(hashBindCode('YTXZ0S6_Pp6EJqmdJ7jvLw')).toEqual(expect.any(Buffer));
    expect(hashBindCode('YTXZ0S6_Pp6EJqmdJ7jvLw')).not.toEqual(Buffer.from('YTXZ0S6_Pp6EJqmdJ7jvLw'));
    expect(hashBindCodeBytea('YTXZ0S6_Pp6EJqmdJ7jvLw')).toMatch(/^\\x[0-9a-f]{64}$/);
  });
});
