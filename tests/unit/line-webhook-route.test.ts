import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const scheduled: Array<() => Promise<void>> = [];
const from = vi.fn(() => {
  throw new Error('cold database lookup must not run before the response');
});

vi.mock('next/server', () => ({
  after: (work: () => Promise<void>) => { scheduled.push(work); },
}));

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({ from }),
}));

import { POST } from '@/app/api/line/webhook/[shopCode]/route';
import { encryptSecret } from '@/server/crypto';
import { createLineWebhookCapsule, openLineWebhookCapsule } from '@/server/line-webhook-capsule';

const KEY = 'd'.repeat(64);
const SHOP = 'cold-shop';
const SECRET = 'line-channel-secret';

function request(raw: string, capsule: string, secret = SECRET) {
  return new Request(`https://example.test/api/line/webhook/${SHOP}?credential=${capsule}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-line-signature': createHmac('sha256', secret).update(raw).digest('base64'),
    },
    body: raw,
  });
}

describe('LINE webhook cold response path (issue #31)', () => {
  beforeEach(() => {
    process.env.SETTINGS_ENCRYPTION_KEY = KEY;
    scheduled.length = 0;
    from.mockClear();
  });

  it('valid credential capsule verifies and returns 200 before any database lookup', async () => {
    const raw = JSON.stringify({ events: [] });
    const capsule = createLineWebhookCapsule({
      tenantId: 'tenant-cold', shopCode: SHOP, channelSecretEncrypted: encryptSecret(SECRET),
    });

    const response = await POST(request(raw, capsule), {
      params: Promise.resolve({ shopCode: SHOP }),
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toBe('ok');
    expect(from).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(1);
  });

  it('bad LINE signature is rejected before scheduling background work', async () => {
    const raw = JSON.stringify({ events: [] });
    const capsule = createLineWebhookCapsule({
      tenantId: 'tenant-cold', shopCode: SHOP, channelSecretEncrypted: encryptSecret(SECRET),
    });

    const response = await POST(request(raw, capsule, 'wrong-secret'), {
      params: Promise.resolve({ shopCode: SHOP }),
    });

    expect(response.status).toBe(401);
    expect(from).not.toHaveBeenCalled();
    expect(scheduled).toHaveLength(0);
  });
});

describe('LINE webhook credential capsule isolation and rotation', () => {
  beforeEach(() => { process.env.SETTINGS_ENCRYPTION_KEY = KEY; });

  it('same stored encrypted secret produces the same URL credential', () => {
    const encrypted = encryptSecret(SECRET);
    const input = { tenantId: 'tenant-cold', shopCode: SHOP, channelSecretEncrypted: encrypted };
    expect(createLineWebhookCapsule(input)).toBe(createLineWebhookCapsule(input));
  });

  it('capsule cannot be moved to another shop or modified', () => {
    const capsule = createLineWebhookCapsule({
      tenantId: 'tenant-cold', shopCode: SHOP, channelSecretEncrypted: encryptSecret(SECRET),
    });
    expect(() => openLineWebhookCapsule(capsule, 'other-shop')).toThrow('invalid LINE webhook capsule');
    expect(() => openLineWebhookCapsule(`${capsule.slice(0, -1)}x`, SHOP))
      .toThrow('invalid LINE webhook capsule');
  });

  it('rotating the stored secret produces a different credential', () => {
    const common = { tenantId: 'tenant-cold', shopCode: SHOP };
    const oldCapsule = createLineWebhookCapsule({
      ...common, channelSecretEncrypted: encryptSecret('old-secret'),
    });
    const newCapsule = createLineWebhookCapsule({
      ...common, channelSecretEncrypted: encryptSecret('new-secret'),
    });
    expect(newCapsule).not.toBe(oldCapsule);
  });
});
