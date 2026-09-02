/**
 * Issue #15：聊天圖片必須真的上傳、推播並落庫；不能只貼 object URL。
 * 使用固定本地 LINE mock，測試結束還原租戶設定、額度與測試資料。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };
type UploadedChatImage = {
  url: string;
  path: string;
  bucket: 'chat-images';
  previewPath: string;
  previewUrl: string;
  storageRef: { bucket: 'chat-images'; path: string; previewPath: string };
};
const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const USER_ID = 'Uissue15chatimage00000000000000001';
const CHANNEL_SECRET = 'issue-15-image-channel-secret';
const CHANNEL_TOKEN = 'issue-15-image-channel-token';
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

let admin: SupabaseClient;
let ownerA: AuthedApi;
const lineMock = new LineMockServer();
let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;
let quotaExisted = false;
let quotaBefore = 0;
const uploadedPaths: string[] = [];
let uploadedImage: UploadedChatImage;

function monthKey() {
  const d = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function sign(raw: string) {
  return createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
}

async function quotaUsed() {
  const { data, error } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', monthKey()).maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuota(used: number) {
  const { error } = await admin.from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: monthKey(), used }, { onConflict: 'tenant_id,month' });
  expect(error).toBeNull();
}

async function pushLimit() {
  const { data, error } = await admin.from('feature_subscriptions')
    .select('active, expires_at').eq('tenant_id', SHOP_A.id).eq('code', 'EXTRA_PUSH').maybeSingle();
  expect(error).toBeNull();
  const row = data as { active: boolean; expires_at: string | null } | null;
  return row?.active && (!row.expires_at || new Date(row.expires_at) > new Date()) ? 700 : 200;
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  await lineMock.start();

  const { data: settings, error: settingsError } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(settingsError).toBeNull();
  settingsSnapshot = settings as typeof settingsSnapshot;
  const { error: updateError } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
  }).eq('tenant_id', SHOP_A.id);
  expect(updateError).toBeNull();

  const { data: quota, error: quotaError } = await admin.from('push_quota_usage').select('used')
    .eq('tenant_id', SHOP_A.id).eq('month', monthKey()).maybeSingle();
  expect(quotaError).toBeNull();
  quotaExisted = quota !== null;
  quotaBefore = (quota as { used: number } | null)?.used ?? 0;
  await setQuota(0);

  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID);
  const { error: userError } = await admin.from('line_users').insert({
    tenant_id: SHOP_A.id, line_user_id: USER_ID, display_name: 'Issue 15 圖片測試', followed: true,
  });
  expect(userError).toBeNull();

  const form = new FormData();
  form.append('file', new File([PNG], 'chat.png', { type: 'image/png' }), 'chat.png');
  form.append('bucket', 'chat-images');
  const upload = await ownerA.fetch('/api/upload', { method: 'POST', body: form });
  const uploadBody = await upload.json() as Envelope<UploadedChatImage>;
  expect(upload.status, JSON.stringify(uploadBody)).toBe(200);
  expect(uploadBody.data?.url).toMatch(/^https:\/\/.*\/chat-images\//);
  expect(uploadBody.data?.previewUrl).toMatch(/^https:\/\/.*\/chat-images\//);
  expect(uploadBody.data?.url).not.toBe(uploadBody.data?.previewUrl);
  expect(uploadBody.data?.previewPath).toContain('.preview.');
  expect(uploadBody.data?.storageRef).toEqual({
    bucket: 'chat-images', path: uploadBody.data?.path, previewPath: uploadBody.data?.previewPath,
  });
  uploadedImage = uploadBody.data!;
  uploadedPaths.push(uploadedImage.path, uploadedImage.previewPath);

  const previewDir = uploadedImage.previewPath.slice(0, uploadedImage.previewPath.lastIndexOf('/'));
  const previewName = uploadedImage.previewPath.slice(uploadedImage.previewPath.lastIndexOf('/') + 1);
  const { data: storedPreview, error: previewError } = await admin.storage
    .from('chat-images')
    .list(previewDir, { search: previewName, limit: 10 });
  expect(previewError).toBeNull();
  const previewSize = storedPreview?.find((row) => row.name === previewName)?.metadata?.size;
  expect(Number(previewSize)).toBeLessThanOrEqual(1_000_000);
});

afterAll(async () => {
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID);
  if (uploadedPaths.length) await admin.storage.from('chat-images').remove(uploadedPaths);
  if (quotaExisted) await setQuota(quotaBefore);
  else await admin.from('push_quota_usage').delete().eq('tenant_id', SHOP_A.id).eq('month', monthKey());
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update({
      line: settingsSnapshot.line ?? {},
      line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
      line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
    }).eq('tenant_id', SHOP_A.id);
  }
  await lineMock.stop();
});

describe('Issue #15 chat image chain', () => {
  it('upload → chat image POST → LINE push + OUT image row', async () => {
    lineMock.reset();
    const before = await quotaUsed();
    const sent = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      type: 'image',
      storageRef: uploadedImage.storageRef,
    });
    const body = await sent.json() as Envelope<{ id: string; messageType: string; imageUrl: string }>;
    expect(sent.status, JSON.stringify(body)).toBe(200);
    expect(body.data).toMatchObject({ messageType: 'image', imageUrl: uploadedImage.url });
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
    expect(lineMock.requestsFor('/v2/bot/message/push')[0].body.messages).toEqual([
      { type: 'image', originalContentUrl: uploadedImage.url, previewImageUrl: uploadedImage.previewUrl },
    ]);

    const { data: rows, error } = await admin.from('chat_messages').select('message_type, content')
      .eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID).eq('direction', 'OUT');
    expect(error).toBeNull();
    expect(rows).toHaveLength(1);
    expect(rows![0]).toMatchObject({
      message_type: 'image',
      content: { imageUrl: uploadedImage.url, previewImageUrl: uploadedImage.previewUrl },
    });
    expect(await quotaUsed()).toBe(before + 1);
  });

  it('非 https、外部圖、混合文字圖片與額度用完都不打 LINE', async () => {
    lineMock.reset();
    const insecure = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      type: 'image',
      originalContentUrl: 'http://example.test/nope.png',
      previewImageUrl: 'https://example.test/nope.png',
    });
    expect(insecure.status).toBe(400);
    expect(lineMock.requests).toHaveLength(0);

    const external = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      type: 'image',
      originalContentUrl: 'https://example.test/external.png',
      previewImageUrl: 'https://example.test/external-preview.png',
    });
    expect(external.status).toBe(400);
    expect(lineMock.requests).toHaveLength(0);

    const sameObject = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      type: 'image',
      storageRef: {
        bucket: 'chat-images',
        path: uploadedImage.path,
        previewPath: uploadedImage.path,
      },
    });
    expect(sameObject.status).toBe(400);
    expect(lineMock.requests).toHaveLength(0);

    const wrongTenant = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      type: 'image',
      storageRef: {
        bucket: 'chat-images',
        path: `22222222-3333-4444-5555-666666666666/${uploadedImage.path.split('/').pop()}`,
        previewPath: uploadedImage.previewPath,
      },
    });
    expect(wrongTenant.status).toBe(400);
    expect(lineMock.requests).toHaveLength(0);

    const mixed = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID,
      text: '兩種一起送',
      type: 'image',
      originalContentUrl: 'https://example.test/both.png',
      previewImageUrl: 'https://example.test/both.png',
    });
    expect(mixed.status).toBe(400);
    expect(lineMock.requests).toHaveLength(0);

    const restore = await quotaUsed();
    await setQuota(await pushLimit());
    try {
      const blocked = await ownerA.post('/api/chat/messages', {
        lineUserId: USER_ID,
        type: 'image',
        storageRef: uploadedImage.storageRef,
      });
      expect(blocked.status).toBe(409);
      expect(lineMock.requests).toHaveLength(0);
    } finally {
      await setQuota(restore);
    }
  });

  it('檔名偽裝成 JPEG 但實際是 PNG 時不上傳任何物件', async () => {
    const form = new FormData();
    form.append('file', new File([PNG], 'fake.jpg', { type: 'image/jpeg' }), 'fake.jpg');
    form.append('bucket', 'chat-images');
    const result = await ownerA.fetch('/api/upload', { method: 'POST', body: form });
    expect(result.status).toBe(400);
    const { data: objects } = await admin.storage.from('chat-images').list(SHOP_A.id, {
      search: 'fake',
      limit: 10,
    });
    expect(objects ?? []).toHaveLength(0);
  });

  it('同一 idempotency key 重試只送一次並在 LINE 失敗時還原額度', async () => {
    lineMock.reset();
    const key = '11111111-1111-4111-8111-111111111111';
    const before = await quotaUsed();
    const first = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'retry-safe text', idempotencyKey: key,
    });
    expect(first.status).toBe(200);
    const replay = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'retry-safe text', idempotencyKey: key,
    });
    expect(replay.status).toBe(200);
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
    expect(await quotaUsed()).toBe(before + 1);

    const differentPayload = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'same key, different payload', idempotencyKey: key,
    });
    expect(differentPayload.status).toBe(409);
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);

    const failedKey = '22222222-2222-4222-8222-222222222222';
    const failureBefore = await quotaUsed();
    lineMock.reset();
    lineMock.failNext(400);
    const failed = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'provider failure', idempotencyKey: failedKey,
    });
    expect(failed.status).toBe(502);
    expect(await quotaUsed()).toBe(failureBefore);
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);

    const failedRow = await admin.from('chat_messages').select('delivery_status')
      .eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID)
      .eq('idempotency_key', failedKey).single();
    expect(failedRow.error).toBeNull();
    expect(failedRow.data?.delivery_status).toBe('FAILED');
    const retryFailed = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'provider failure', idempotencyKey: failedKey,
    });
    expect(retryFailed.status).toBe(409);
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);

    const ambiguousKey = '33333333-3333-4333-8333-333333333333';
    const ambiguousBefore = await quotaUsed();
    lineMock.reset();
    lineMock.failNext(500);
    const ambiguous = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'provider timeout or 5xx', idempotencyKey: ambiguousKey,
    });
    expect(ambiguous.status).toBe(503);
    expect(await quotaUsed()).toBe(ambiguousBefore + 1);
    const ambiguousRow = await admin.from('chat_messages')
      .select('delivery_status, provider_attempt_status, refund_status, reservation_month, reservation_token')
      .eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_ID)
      .eq('idempotency_key', ambiguousKey).single();
    expect(ambiguousRow.error).toBeNull();
    expect(ambiguousRow.data).toMatchObject({
      delivery_status: 'RETRY',
      provider_attempt_status: 'UNKNOWN',
      refund_status: 'RESERVED',
    });
    expect(ambiguousRow.data?.reservation_month).toMatch(/^\d{4}-\d{2}$/);
    expect(ambiguousRow.data?.reservation_token).toEqual(expect.any(String));
    const retryAmbiguous = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_ID, text: 'provider timeout or 5xx', idempotencyKey: ambiguousKey,
    });
    expect(retryAmbiguous.status).toBe(409);
    expect(lineMock.requestsFor('/v2/bot/message/push')).toHaveLength(1);
  });
});
