import { createHash, timingSafeEqual } from 'node:crypto';

const CODE_PATTERN = /^[A-Za-z0-9_-]{20,128}$/;

export function isValidBindCode(code: string): boolean {
  return CODE_PATTERN.test(code);
}

export function hashBindCode(code: string): Buffer {
  return createHash('sha256').update(code).digest();
}

/** PostgREST's portable bytea input form; never expose the original code. */
export function hashBindCodeBytea(code: string): string {
  return `\\x${hashBindCode(code).toString('hex')}`;
}

export function verifyTelegramWebhookSecret(expected: string | undefined, received: string | null): boolean {
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return expectedBytes.length === receivedBytes.length && timingSafeEqual(expectedBytes, receivedBytes);
}
