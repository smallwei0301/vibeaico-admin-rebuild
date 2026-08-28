import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.fn();
const dispatchPendingNotifications = vi.fn();
const createDailyHealthReport = vi.fn();

vi.mock('@/server/supabase', () => ({
  createAdminSupabase: () => ({ rpc }),
}));
vi.mock('@/server/notifications/outbox', () => ({ dispatchPendingNotifications }));
vi.mock('@/server/notifications/health-report', () => ({ createDailyHealthReport }));

const { POST: telegramWebhook } = await import('@/app/api/telegram/webhook/route');
const { GET: notificationHealth } = await import('@/app/api/cron/notification-health/route');

describe('notification runtime routes (#40, 17 §2, §4, §6)', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    rpc.mockReset();
    dispatchPendingNotifications.mockReset();
    createDailyHealthReport.mockReset();
  });

  it('returns 5xx when an authenticated Telegram binding update cannot persist', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-webhook-secret');
    rpc.mockResolvedValue({ data: null, error: { message: 'database unavailable' } });

    const response = await telegramWebhook(new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret', 'content-type': 'application/json' },
      body: JSON.stringify({ update_id: 7, message: { text: `/start ${'A'.repeat(24)}`, chat: { id: 99 } } }),
    }));

    expect(response.status).toBe(500);
  });

  it('acknowledges a malformed but authentic Telegram update without trying an RPC', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'test-webhook-secret');

    const response = await telegramWebhook(new Request('http://localhost/api/telegram/webhook', {
      method: 'POST',
      headers: { 'x-telegram-bot-api-secret-token': 'test-webhook-secret', 'content-type': 'application/json' },
      body: '{malformed-json',
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ accepted: true, bound: false });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('fails closed when CRON_SECRET is absent instead of accepting Bearer undefined', async () => {
    vi.stubEnv('CRON_SECRET', undefined);
    createDailyHealthReport.mockResolvedValue({ periodEnd: '2030-06-05T00:00:00.000Z' });
    dispatchPendingNotifications.mockResolvedValue(0);

    const response = await notificationHealth(new Request('http://localhost/api/cron/notification-health', {
      headers: { authorization: 'Bearer undefined' },
    }));

    expect(response.status).toBe(401);
    expect(createDailyHealthReport).not.toHaveBeenCalled();
    expect(dispatchPendingNotifications).not.toHaveBeenCalled();
  });
});
