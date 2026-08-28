import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { createAdminSupabase } from '@/server/supabase';

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

/** Generates a one-time code; callers show the plaintext once and persist only its hash. */
export async function issueTelegramBindCode(
  input: { tenantId: string | null; subjectType: 'TENANT_USER' | 'STAFF' | 'PLATFORM_OWNER'; subjectRef: string; expiresInMinutes?: number },
  admin = createAdminSupabase(),
): Promise<string> {
  const code = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + (input.expiresInMinutes ?? 15) * 60_000).toISOString();
  const { error } = await admin.from('telegram_bind_codes').insert({
    tenant_id: input.tenantId, subject_type: input.subjectType, subject_ref: input.subjectRef,
    code_hash: hashBindCodeBytea(code), expires_at: expiresAt,
  });
  if (error) throw error;
  return code;
}
