import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenant = vi.fn();
const issueTelegramBindCode = vi.fn();

vi.mock('@/server/tenant', () => ({ requireTenant }));
vi.mock('@/server/notifications/telegram-binding', () => ({ issueTelegramBindCode }));

const route = readFileSync('src/app/api/telegram/bind/route.ts', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const { POST } = await import('@/app/api/telegram/bind/route');

describe('Telegram binding entry point (#40, 17 §4)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    requireTenant.mockResolvedValue({ tenantId: 'tenant-a', user: { id: 'user-a' } });
    issueTelegramBindCode.mockResolvedValue('one-time-code');
  });

  it('requires a tenant manager and issues a one-time code rather than storing it in the route', () => {
    expect(route).toMatch(/requireTenant\('MANAGER'\)/);
    expect(route).toMatch(/issueTelegramBindCode\(/);
    expect(route).toMatch(/https:\/\/t\.me\/\$\{username\}\?start=\$\{code\}/);
    expect(route).not.toMatch(/\.insert\(/);
  });

  it('does not issue a dead deep link when the platform Bot token is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'vibeai_bot');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');

    const response = await POST(new Request('http://localhost/api/telegram/bind', { method: 'POST' }), {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'REQ_003' });
    expect(issueTelegramBindCode).not.toHaveBeenCalled();
  });

  it('does not issue a deep link when the inbound webhook secret is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'vibeai_bot');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');

    const response = await POST(new Request('http://localhost/api/telegram/bind', { method: 'POST' }), {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'REQ_003' });
    expect(issueTelegramBindCode).not.toHaveBeenCalled();
  });

  it('documents every server-only setting needed to make the binding entry usable', () => {
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_ID', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET']) {
      expect(envExample).toContain(`${key}=`);
    }
  });
});
