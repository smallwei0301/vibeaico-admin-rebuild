/**
 * Issue #50 — 關鍵字回覆圖片整合驗收（04 §B-5、06 §6.1）。
 *
 * 此檔刻意不 import route：所有寫入都走公開 HTTP seam，再以 TEST service role
 * 驗證 Storage 副作用。它會改動共享 TEST，故只可由串行 integration lane 執行。
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { drainWebhook } from '../../helpers/line-webhook';
import { encryptSecret } from '@/server/crypto';

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';
const BUCKET = 'keyword-reply-images';
const CHANNEL_SECRET = 'itest-keyword-image-channel-secret-50';
const CHANNEL_TOKEN = 'itest-keyword-image-access-token-50';
const LINE_USER = 'Ukeywordimage50itest000000000000001';
const PREFIX = `itest-image-50-${Date.now().toString(36)}`;

type ImageRef = {
  bucket: 'keyword-reply-images';
  path: string;
  url: string;
  previewPath: string;
  previewUrl: string;
};

let admin: SupabaseClient;
let ownerA: AuthedApi;
let ownerB: AuthedApi;
const mock = new LineMockServer();
const pathsToRemove = new Set<string>();
const replyIdsToRemove = new Set<string>();
let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

function sign(raw: string): string {
  return createHmac('sha256', CHANNEL_SECRET).update(raw).digest('base64');
}

async function imageFile(type: 'image/jpeg' | 'image/png'): Promise<File> {
  const bytes = type === 'image/jpeg'
    ? await sharp({ create: { width: 8, height: 8, channels: 3, background: '#0ea5e9' } }).jpeg().toBuffer()
    : await sharp({ create: { width: 8, height: 8, channels: 4, background: '#22c55e' } }).png().toBuffer();
  return new File([bytes], `keyword-image.${type === 'image/jpeg' ? 'jpg' : 'png'}`, { type });
}

async function upload(type: 'image/jpeg' | 'image/png' = 'image/png'): Promise<ImageRef> {
  const form = new FormData();
  form.append('bucket', BUCKET);
  form.append('file', await imageFile(type));
  const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form });
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  const ref = body.data.storageRef as ImageRef;
  expect(ref.bucket).toBe(BUCKET);
  expect(ref.path).toMatch(new RegExp(`^${SHOP_A.id}/.+\\.${type === 'image/jpeg' ? 'jpg' : 'png'}$`));
  expect(ref.previewPath).toBe(`${ref.path.slice(0, ref.path.lastIndexOf('.'))}.preview.${ref.path.split('.').pop()}`);
  pathsToRemove.add(ref.path);
  pathsToRemove.add(ref.previewPath);
  return ref;
}

async function expectObjectExists(path: string): Promise<void> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  expect(error).toBeNull();
  expect(data).toBeTruthy();
  expect(data!.size).toBeGreaterThan(0);
}

async function expectObjectMissing(path: string): Promise<void> {
  const { data, error } = await admin.storage.from(BUCKET).download(path);
  expect(data).toBeNull();
  expect(error).not.toBeNull();
}

function imagePayload(keyword: string, ref: ImageRef, active = true) {
  return {
    keywords: [keyword],
    replyType: 'IMAGE',
    active,
    content: {
      imageUrl: ref.url,
      previewImageUrl: ref.previewUrl,
      imageStorageRef: ref,
      matchType: 'EXACT',
      actionType: 'REPLY_CONTENT',
    },
  };
}

async function createImageReply(ref: ImageRef, suffix: string): Promise<string> {
  const res = await ownerA.post('/api/settings/line/keyword-replies', imagePayload(`${PREFIX}-${suffix}`, ref));
  const body = await res.json();
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  replyIdsToRemove.add(body.data.id);
  return body.data.id as string;
}

async function webhookFor(keyword: string): Promise<void> {
  mock.reset();
  const raw = JSON.stringify({
    destination: 'Umockbot',
    events: [{
      type: 'message', replyToken: `rt-${keyword}`,
      source: { type: 'user', userId: LINE_USER },
      message: { id: `m-${keyword}`, type: 'text', text: keyword },
    }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-line-signature': sign(raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
  await drainWebhook(SHOP_A.shopCode, BASE_URL);
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.TEST_CRON_SECRET).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();
  const { data, error } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(error).toBeNull();
  settingsSnapshot = data as typeof settingsSnapshot;
  const { error: setLineError } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
      line: { ...((data?.line ?? {}) as object), autoReplyEnabled: false },
    })
    .eq('tenant_id', SHOP_A.id);
  expect(setLineError).toBeNull();
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  // 先解除本檔留下的 DB 引用，再用 service role 收物件；任一案例失敗仍保持可重跑。
  if (replyIdsToRemove.size) {
    await admin.from('keyword_replies').delete().in('id', [...replyIdsToRemove]);
  }
  if (pathsToRemove.size) await admin.storage.from(BUCKET).remove([...pathsToRemove]);
  await admin.from('keyword_reply_image_cleanup').delete().eq('tenant_id', SHOP_A.id).in('path', [...pathsToRemove]);
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', LINE_USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', LINE_USER);
  if (settingsSnapshot) {
    await admin.from('tenant_settings').update(settingsSnapshot).eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

describe('Issue #50 keyword reply image lifecycle (04 §B-5, 06 §6.1)', () => {
  it('uploads valid JPEG and PNG originals plus previews, and the TEST service role can read all four objects', async () => {
    for (const type of ['image/jpeg', 'image/png'] as const) {
      const ref = await upload(type);
      await expectObjectExists(ref.path);
      await expectObjectExists(ref.previewPath);
    }
  });

  it('creates an IMAGE reply, GET returns the exact storage ref, and webhook sends exactly that original/preview URL pair', async () => {
    const ref = await upload();
    const id = await createImageReply(ref, 'roundtrip');
    const get = await ownerA.get('/api/settings/line/keyword-replies');
    const body = await get.json();
    expect(get.status).toBe(200);
    const saved = body.data.find((row: { id: string }) => row.id === id);
    expect(saved.replyType).toBe('IMAGE');
    expect(saved.content.imageStorageRef).toEqual(ref);
    expect(saved.content.imageUrl).toBe(ref.url);
    expect(saved.content.previewImageUrl).toBe(ref.previewUrl);

    const keyword = `${PREFIX}-roundtrip`;
    await webhookFor(keyword);
    const replies = mock.requestsFor('/v2/bot/message/reply');
    expect(replies).toHaveLength(1);
    expect(replies[0].body.messages).toEqual([{
      type: 'image', originalContentUrl: ref.url, previewImageUrl: ref.previewUrl,
    }]);
  });

  it('a disabled IMAGE reply sends no stale image, and replacing it with TEXT removes both old objects after DB unlink', async () => {
    const ref = await upload();
    const id = await createImageReply(ref, 'disable-remove');
    const keyword = `${PREFIX}-disable-remove`;
    expect((await ownerA.put(`/api/settings/line/keyword-replies/${id}`, { active: false })).status).toBe(200);
    await webhookFor(keyword);
    expect(mock.requestsFor('/v2/bot/message/reply')).toEqual([]);

    const replace = await ownerA.put(`/api/settings/line/keyword-replies/${id}`, {
      replyType: 'TEXT', active: false,
      content: { text: '圖片已移除', matchType: 'EXACT', actionType: 'REPLY_CONTENT' },
    });
    expect(replace.status).toBe(200);
    await expectObjectMissing(ref.path);
    await expectObjectMissing(ref.previewPath);
    pathsToRemove.delete(ref.path);
    pathsToRemove.delete(ref.previewPath);
  });

  it('rejects another tenant from referencing or discarding A tenant image objects', async () => {
    const ref = await upload();
    const create = await ownerB.post('/api/settings/line/keyword-replies', imagePayload(`${PREFIX}-cross-tenant`, ref));
    expect(create.status).toBe(400);
    expect((await create.json()).code).toBe('REQ_001');
    const discard = await ownerB.fetch('/api/settings/line/keyword-replies/image', {
      method: 'DELETE', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ storageRef: ref }),
    });
    expect(discard.status).toBe(400);
    expect((await discard.json()).code).toBe('REQ_001');
    await expectObjectExists(ref.path);
    await expectObjectExists(ref.previewPath);
  });

  it('cleanup retry rechecks a newly live reference before deletion and removes the queued jobs instead', async () => {
    const ref = await upload();
    const { error } = await admin.from('keyword_reply_image_cleanup').insert([
      { tenant_id: SHOP_A.id, bucket: BUCKET, path: ref.path, last_error: 'forced retry fixture' },
      { tenant_id: SHOP_A.id, bucket: BUCKET, path: ref.previewPath, last_error: 'forced retry fixture' },
    ]);
    expect(error).toBeNull();
    await createImageReply(ref, 'retry-reference');

    const cron = await fetch(`${BASE_URL}/api/cron/keyword-reply-image-cleanup`, {
      headers: { authorization: `Bearer ${process.env.TEST_CRON_SECRET}` },
    });
    expect(cron.status).toBe(200);
    expect((await cron.json()).success).toBe(true);
    const { count, error: queueError } = await admin
      .from('keyword_reply_image_cleanup').select('path', { count: 'exact', head: true })
      .eq('tenant_id', SHOP_A.id).in('path', [ref.path, ref.previewPath]);
    expect(queueError).toBeNull();
    expect(count).toBe(0);
    await expectObjectExists(ref.path);
    await expectObjectExists(ref.previewPath);
  });
});
