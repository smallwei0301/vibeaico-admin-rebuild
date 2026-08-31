/**
 * #40 notification delivery HTTP contract. These exercise the running Next
 * server and TEST ledger only: Telegram/Resend credentials are deterministic
 * local test values and no real provider endpoint is called.
 */
import { createHmac, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { hashBindCodeBytea } from '@/server/notifications/telegram-binding';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const TELEGRAM_SECRET = process.env.TEST_TELEGRAM_WEBHOOK_SECRET ?? 'test-telegram-webhook-secret';
const TELEGRAM_BOT_ID = process.env.TEST_TELEGRAM_BOT_ID ?? 'test-platform-bot';
const RESEND_SECRET = process.env.TEST_RESEND_WEBHOOK_SECRET
  ?? `whsec_${Buffer.from('test-resend-webhook-secret').toString('base64')}`;

let admin: SupabaseClient;
let owner: AuthedApi;
let bindCode = '';
let bindChatId = 0;
let bindUpdateId = 0;
let resendOutboxId = '';
let resendDeliveryId = '';
let resendEventId = '';
const healthOutboxIds: string[] = [];
const healthReportIds: string[] = [];

function resendSignature(id: string, timestamp: string, body: string): string {
  const key = Buffer.from(RESEND_SECRET.slice('whsec_'.length), 'base64');
  return `v1,${createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64')}`;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.TEST_CRON_SECRET).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  owner = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
});

afterAll(async () => {
  if (bindChatId) await admin.from('telegram_bindings').delete().eq('tenant_id', SHOP_A.id).eq('chat_id', bindChatId);
  if (bindCode) await admin.from('telegram_bind_codes').delete().eq('code_hash', hashBindCodeBytea(bindCode));
  if (bindUpdateId) await admin.from('telegram_webhook_updates').delete().eq('bot_id', TELEGRAM_BOT_ID).eq('update_id', bindUpdateId);
  if (resendEventId) await admin.from('notification_provider_webhook_events').delete().eq('provider', 'RESEND').eq('event_id', resendEventId);
  if (resendOutboxId) await admin.from('notification_outbox').delete().eq('id', resendOutboxId);
  if (healthOutboxIds.length) await admin.from('notification_outbox').delete().in('id', healthOutboxIds);
  if (healthReportIds.length) await admin.from('notification_health_reports').delete().in('id', healthReportIds);
});

describe('Telegram binding over HTTP (#40, 17 §4)', () => {
  it('issues an authenticated deep link and consumes it once through the secret-protected webhook', async () => {
    const bind = await owner.post('/api/telegram/bind');
    expect(bind.status).toBe(200);
    const bindBody = await bind.json() as { success: boolean; data: { deepLink: string } };
    expect(bindBody.success).toBe(true);
    bindCode = new URL(bindBody.data.deepLink).searchParams.get('start') ?? '';
    expect(bindCode).toMatch(/^[A-Za-z0-9_-]{20,128}$/);

    bindChatId = 8_000_000_000 + Math.floor(Math.random() * 100_000);
    bindUpdateId = Date.now();
    const webhook = await fetch(`${BASE_URL}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': TELEGRAM_SECRET },
      body: JSON.stringify({
        update_id: bindUpdateId,
        message: { text: `/start ${bindCode}`, chat: { id: bindChatId } },
      }),
    });
    expect(webhook.status).toBe(200);
    expect(await webhook.json()).toEqual({ accepted: true, bound: true });

    const { data, error } = await admin.from('telegram_bindings').select('active, subject_type')
      .eq('tenant_id', SHOP_A.id).eq('chat_id', bindChatId).single();
    expect(error).toBeNull();
    expect(data).toMatchObject({ active: true, subject_type: 'TENANT_USER' });
  });

  it('rejects a Telegram webhook with an invalid secret before consuming a bind code', async () => {
    const response = await fetch(`${BASE_URL}/api/telegram/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': 'incorrect-secret' },
      body: JSON.stringify({ update_id: Date.now(), message: { text: '/start invalid', chat: { id: 1 } } }),
    });
    expect(response.status).toBe(401);
  });
});

describe('Resend delivery webhook over HTTP (#40, 17 §3)', () => {
  it('verifies a signed delivered event and writes final delivery evidence exactly once', async () => {
    const outboxId = randomUUID();
    const deliveryId = randomUUID();
    const providerMessageId = `resend-itest-${randomUUID()}`;
    resendEventId = `evt-itest-${randomUUID()}`;
    const { error: outboxError } = await admin.from('notification_outbox').insert({
      id: outboxId, tenant_id: null, event_name: 'PLATFORM_NOTIFICATION_HEALTH',
      aggregate_type: 'NOTIFICATION_HEALTH_REPORT', aggregate_id: randomUUID(),
      idempotency_key: `resend-http:${randomUUID()}`, payload: {},
    });
    expect(outboxError).toBeNull();
    resendOutboxId = outboxId;
    const { error: deliveryError } = await admin.from('notification_deliveries').insert({
      id: deliveryId, outbox_id: outboxId, tenant_id: null,
      recipient_type: 'PLATFORM_OWNER', recipient_ref: 'platform-owner', channel: 'EMAIL',
      destination_ref: 'PLATFORM_OWNER_EMAIL', status: 'ACCEPTED', provider_message_id: providerMessageId,
    });
    expect(deliveryError).toBeNull();
    resendDeliveryId = deliveryId;

    const body = JSON.stringify({ type: 'email.delivered', data: { email_id: providerMessageId } });
    const timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(`${BASE_URL}/api/webhooks/resend`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json', 'svix-id': resendEventId, 'svix-timestamp': timestamp,
        'svix-signature': resendSignature(resendEventId, timestamp, body),
      },
      body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { accepted: true, applied: true } });

    const { data, error } = await admin.from('notification_deliveries').select('status, delivered_at')
      .eq('id', resendDeliveryId).single();
    expect(error).toBeNull();
    expect(data?.status).toBe('DELIVERED');
    expect(data?.delivered_at).not.toBeNull();
  });
});

describe('notification-health cron over HTTP (#40, 07 §2, 17 §6)', () => {
  it('rejects missing Bearer credentials and creates a daily health report for a valid cron request', async () => {
    const unauthorized = await fetch(`${BASE_URL}/api/cron/notification-health`);
    expect(unauthorized.status).toBe(401);

    const startedAt = new Date().toISOString();
    const response = await fetch(`${BASE_URL}/api/cron/notification-health`, {
      headers: { authorization: `Bearer ${process.env.TEST_CRON_SECRET}` },
    });
    expect(response.status).toBe(200);
    const body = await response.json() as { created: boolean; periodEnd: string };
    expect(body.created).toBe(true);
    expect(body.periodEnd).toMatch(/Z$/);

    const [{ data: reports, error: reportError }, { data: outboxes, error: outboxError }] = await Promise.all([
      admin.from('notification_health_reports').select('id').gte('created_at', startedAt),
      admin.from('notification_outbox').select('id').in('event_name', ['PLATFORM_NOTIFICATION_HEALTH', 'PLATFORM_NOTIFICATION_ALERT']).gte('created_at', startedAt),
    ]);
    expect(reportError).toBeNull();
    expect(outboxError).toBeNull();
    healthReportIds.push(...(reports ?? []).map((row) => row.id));
    healthOutboxIds.push(...(outboxes ?? []).map((row) => row.id));
    expect(healthReportIds.length).toBeGreaterThan(0);
    expect(healthOutboxIds.length).toBeGreaterThan(0);
  });
});
