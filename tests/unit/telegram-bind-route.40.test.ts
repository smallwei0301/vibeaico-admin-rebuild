import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const requireTenant = vi.fn();
const hashBindCodeBytea = vi.fn();
const rpc = vi.fn();

vi.mock('@/server/tenant', () => ({ requireTenant }));
vi.mock('@/server/notifications/telegram-binding', () => ({ hashBindCodeBytea }));

const route = readFileSync('src/app/api/telegram/bind/route.ts', 'utf8');
const envExample = readFileSync('.env.example', 'utf8');
const { POST } = await import('@/app/api/telegram/bind/route');

describe('Telegram binding entry point (#40, 17 §4)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    rpc.mockResolvedValue({ error: null });
    hashBindCodeBytea.mockReturnValue('\\xbind-code-hash');
    requireTenant.mockResolvedValue({ tenantId: 'tenant-a', user: { id: 'user-a' }, supabase: { rpc } });
  });

  it('requires a tenant manager and uses that session client to issue a one-time code', () => {
    expect(route).toMatch(/requireTenant\('MANAGER'\)/);
    expect(route).toMatch(/t\.supabase\.rpc\('issue_tenant_telegram_bind_code'/);
    expect(route).toMatch(/https:\/\/t\.me\/\$\{username\}\?start=\$\{code\}/);
    expect(route).not.toMatch(/\.insert\(/);
    expect(route).not.toContain('createAdminSupabase');
    expect(route).not.toContain('subjectRef');
  });

  it('does not issue a dead deep link when the platform Bot token is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'vibeai_bot');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', '');

    const response = await POST(new Request('http://localhost/api/telegram/bind', { method: 'POST' }), {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'REQ_003' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('does not issue a deep link when the inbound webhook secret is not configured', async () => {
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'vibeai_bot');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');

    const response = await POST(new Request('http://localhost/api/telegram/bind', { method: 'POST' }), {});

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ success: false, code: 'REQ_003' });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes only the active tenant and a hash to the authenticated RPC', async () => {
    vi.stubEnv('TELEGRAM_BOT_USERNAME', 'vibeai_bot');
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'bot-token');
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'webhook-secret');

    const response = await POST(new Request('http://localhost/api/telegram/bind', { method: 'POST' }), {});

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith('issue_tenant_telegram_bind_code', {
      p_tenant_id: 'tenant-a', p_code_hash: '\\xbind-code-hash',
    });
    expect(await response.json()).toMatchObject({ success: true, data: { expiresInMinutes: 15 } });
  });

  it('documents every server-only setting needed to make the binding entry usable', () => {
    for (const key of ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_BOT_ID', 'TELEGRAM_BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET']) {
      expect(envExample).toContain(`${key}=`);
    }
  });
});
