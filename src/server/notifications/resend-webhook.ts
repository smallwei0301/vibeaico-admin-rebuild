import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

export type ResendDeliveryEvidence = {
  status: 'DELIVERED' | 'DEAD';
  errorCode: 'EMAIL_BOUNCED' | 'EMAIL_COMPLAINED' | null;
  unhealthy: boolean;
};

export function hashRecipientEmail(email: string, key: string): string {
  return `\\x${createHmac('sha256', key).update(email.trim().toLowerCase()).digest('hex')}`;
}

/** A known bounce/complaint must not silently skip recipient-health recording. */
export function recipientHealthKeyRequired(
  evidence: ResendDeliveryEvidence,
  recipient: string | undefined,
  key: string | undefined,
): boolean {
  return evidence.unhealthy && Boolean(recipient) && !key;
}

/** Map only events that prove a final delivery outcome. Opens/clicks are not delivery evidence. */
export function mapResendDeliveryEvent(type: string): ResendDeliveryEvidence | null {
  if (type === 'email.delivered') return { status: 'DELIVERED', errorCode: null, unhealthy: false };
  if (type === 'email.bounced') return { status: 'DEAD', errorCode: 'EMAIL_BOUNCED', unhealthy: true };
  if (type === 'email.complained') return { status: 'DEAD', errorCode: 'EMAIL_COMPLAINED', unhealthy: true };
  return null;
}

/** Verify Resend's Svix-compatible signature over the untouched request body. */
export function verifyResendWebhook(
  body: string,
  headers: { id: string | null; timestamp: string | null; signature: string | null },
  secret: string | undefined,
  nowMs = Date.now(),
): boolean {
  if (!secret?.startsWith('whsec_') || !headers.id || !headers.timestamp || !headers.signature) return false;
  const timestamp = Number(headers.timestamp);
  if (!Number.isSafeInteger(timestamp) || Math.abs(Math.floor(nowMs / 1000) - timestamp) > SIGNATURE_TOLERANCE_SECONDS)
    return false;
  let key: Buffer;
  try {
    key = Buffer.from(secret.slice('whsec_'.length), 'base64');
  } catch {
    return false;
  }
  if (!key.length) return false;
  const expected = createHmac('sha256', key).update(`${headers.id}.${headers.timestamp}.${body}`).digest();
  return headers.signature.split(/\s+/).some((entry) => {
    const [version, encoded] = entry.split(',', 2);
    if (version !== 'v1' || !encoded) return false;
    let received: Buffer;
    try {
      received = Buffer.from(encoded, 'base64');
    } catch {
      return false;
    }
    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
