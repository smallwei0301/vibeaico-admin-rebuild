import { createHmac, timingSafeEqual } from 'node:crypto';

type CapsulePayload = {
  v: 1;
  tenantId: string;
  shopCode: string;
  channelSecretEncrypted: string;
};

const key = () => Buffer.from(process.env.SETTINGS_ENCRYPTION_KEY!, 'hex');
const encode = (value: string) => Buffer.from(value, 'utf8').toString('base64url');
const mac = (payload: string) => createHmac('sha256', key())
  .update(`line-webhook-capsule.v1.${payload}`)
  .digest('base64url');

/**
 * Stable, opaque webhook credential built from the already-encrypted settings
 * value. It contains no plaintext LINE secret and is bound to one tenant and
 * shop code by a platform HMAC.
 */
export function createLineWebhookCapsule(input: Omit<CapsulePayload, 'v'>): string {
  if (!input.tenantId || !input.shopCode || !input.channelSecretEncrypted) {
    throw new Error('LINE webhook capsule requires tenant, shop and channel secret');
  }
  const payload = encode(JSON.stringify({ v: 1, ...input } satisfies CapsulePayload));
  return `${payload}.${mac(payload)}`;
}

/** Verify platform authenticity and path binding before returning any data. */
export function openLineWebhookCapsule(capsule: string, expectedShopCode: string): CapsulePayload {
  const [payload, signature, ...extra] = capsule.split('.');
  if (!payload || !signature || extra.length) throw new Error('invalid LINE webhook capsule');
  const expected = Buffer.from(mac(payload));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw new Error('invalid LINE webhook capsule');
  }
  const decoded = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Partial<CapsulePayload>;
  if (decoded.v !== 1 || !decoded.tenantId || decoded.shopCode !== expectedShopCode
      || !decoded.channelSecretEncrypted) {
    throw new Error('invalid LINE webhook capsule');
  }
  return decoded as CapsulePayload;
}
