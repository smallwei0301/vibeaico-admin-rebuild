import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/server/supabase', () => ({ createAdminSupabase: vi.fn() }));
vi.mock('@/server/keyword-reply-images', () => ({
  drainKeywordReplyImageCleanup: vi.fn(),
}));

import { GET } from '@/app/api/cron/keyword-reply-image-cleanup/route';

describe('Issue #50 keyword image cleanup cron auth', () => {
  const previousSecret = process.env.CRON_SECRET;

  afterEach(() => {
    vi.restoreAllMocks();
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it('fails closed when CRON_SECRET is absent, including Bearer undefined', async () => {
    delete process.env.CRON_SECRET;
    const response = await GET(new Request('https://example.test/api/cron/keyword-reply-image-cleanup', {
      headers: { authorization: 'Bearer undefined' },
    }));
    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ success: false, code: 'AUTH_001' });
  });

  it('accepts only the configured secret', async () => {
    process.env.CRON_SECRET = 'unit-secret';
    const response = await GET(new Request('https://example.test/api/cron/keyword-reply-image-cleanup', {
      headers: { authorization: 'Bearer wrong' },
    }));
    expect(response.status).toBe(401);
  });
});
