/**
 * Issue #50 integration proof. This file owns the shared TEST integration lane:
 * it must run only after migration 0039 is authorized/applied to TEST.
 * Local source checks deliberately do not invoke this file or mutate TEST.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import { SHOP_A, SHOP_B } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
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
type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

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
  form.append('file', await imageFile(type));
  const res = await ownerA.fetch('/api/settings/line/keyword-replies/image', { method: 'POST', body: form });
  const body = (await res.json()) as Envelope<{ storageRef: ImageRef }>;
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  const ref = body.data!.storageRef;
  expect(ref.bucket).toBe(BUCKET);
  expect(ref.path).toMatch(new RegExp(`^${SHOP_A.id}/[0-9a-f-]{36}\\.${type === 'image/jpeg' ? 'jpg' : 'png'}$`));
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
    keywords: [keyword], replyType: 'IMAGE', active,
    content: {
      imageUrl: ref.url, previewImageUrl: ref.previewUrl, imageStorageRef: ref,
      matchType: 'EXACT', actionType: 'REPLY_CONTENT',
    },
  };
}

async function createImageReply(ref: ImageRef, suffix: string): Promise<string> {
  const res = await ownerA.post('/api/settings/line/keyword-replies', imagePayload(`${PREFIX}-${suffix}`, ref));
  const body = (await res.json()) as Envelope<{ id: string }>;
  expect(res.status).toBe(200);
  expect(body.success).toBe(true);
  replyIdsToRemove.add(body.data!.id);
  return body.data!.id;
}

async function removeKeywordReplyFeature(): Promise<void> {
  const { error } = await admin.from('feature_subscriptions').delete()
    .eq('tenant_id', SHOP_A.id).eq('code', 'KEYWORD_REPLY');
  expect(error).toBeNull();
}

async function restoreKeywordReplyFeature(): Promise<void> {
  const { error } = await admin.from('feature_subscriptions').upsert({
    tenant_id: SHOP_A.id,
    code: 'KEYWORD_REPLY',
    active: true,
    expires_at: null,
    source: 'GRANTED',
    cancelled_at: null,
  }, { onConflict: 'tenant_id,code' });
  expect(error).toBeNull();
}

async function webhookFor(keyword: string): Promise<void> {
  mock.reset();
  const raw = JSON.stringify({
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
}

beforeAll(async () => {
  expect(process.env.TEST_SUPABASE_URL).toBeTruthy();
  expect(process.env.TEST_SUPABASE_SERVICE_ROLE_KEY).toBeTruthy();
  expect(process.env.LINE_API_BASE).toBeTruthy();
  expect(process.env.SETTINGS_ENCRYPTION_KEY).toBeTruthy();
  admin = createClient(process.env.TEST_SUPABASE_URL!, process.env.TEST_SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  await mock.start();
  const { data, error } = await admin.from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id).single();
  expect(error).toBeNull();
  settingsSnapshot = data as typeof settingsSnapshot;
  const { error: settingsError } = await admin.from('tenant_settings').update({
    line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
    line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    line: { ...((data?.line ?? {}) as object), autoReplyEnabled: false },
  }).eq('tenant_id', SHOP_A.id);
  expect(settingsError).toBeNull();
  ownerA = await loginAs(SHOP_A.owner.email, SHOP_A.owner.password);
  ownerB = await loginAs(SHOP_B.owner.email, SHOP_B.owner.password);
});

afterAll(async () => {
  if (replyIdsToRemove.size) await admin.from('keyword_replies').delete().in('id', [...replyIdsToRemove]);
  if (pathsToRemove.size) await admin.storage.from(BUCKET).remove([...pathsToRemove]);
  await admin.from('keyword_reply_image_cleanup').delete().eq('tenant_id', SHOP_A.id).in('path', [...pathsToRemove]);
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', LINE_USER);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', LINE_USER);
  if (settingsSnapshot) await admin.from('tenant_settings').update(settingsSnapshot).eq('tenant_id', SHOP_A.id);
  await mock.stop();
});

describe('Issue #50 keyword reply image lifecycle', () => {
  it('uploads JPEG and PNG originals plus ≤1MB previews', async () => {
    for (const type of ['image/jpeg', 'image/png'] as const) {
      const ref = await upload(type);
      await expectObjectExists(ref.path);
      await expectObjectExists(ref.previewPath);
    }
  });

  it('persists the exact ref and sends one IMAGE message with the original/preview pair', async () => {
    const ref = await upload();
    const id = await createImageReply(ref, 'roundtrip');
    const get = await ownerA.get('/api/settings/line/keyword-replies');
    const body = (await get.json()) as Envelope<any[]>;
    expect(get.status).toBe(200);
    const saved = body.data!.find((row) => row.id === id);
    expect(saved.content.imageStorageRef).toEqual(ref);
    expect(saved.content.imageUrl).toBe(ref.url);
    expect(saved.content.previewImageUrl).toBe(ref.previewUrl);

    await webhookFor(`${PREFIX}-roundtrip`);
    const replies = mock.requestsFor('/v2/bot/message/reply');
    expect(replies).toHaveLength(1);
    expect(replies[0].body.messages).toEqual([{
      type: 'image', originalContentUrl: ref.url, previewImageUrl: ref.previewUrl,
    }]);
  });

  it('does not send an inactive reply and removes both objects after DB unlink', async () => {
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

  it('keeps disable/delete available after KEYWORD_REPLY ends, but gates active mutations', async () => {
    const ref = await upload();
    const id = await createImageReply(ref, 'direction-gate');
    await removeKeywordReplyFeature();
    try {
      const disabled = await ownerA.put(`/api/settings/line/keyword-replies/${id}`, { active: false });
      expect(disabled.status).toBe(200);

      const reenabled = await ownerA.put(`/api/settings/line/keyword-replies/${id}`, { active: true });
      expect(reenabled.status).toBe(403);
      expect((await reenabled.json()).code).toBe('FEAT_001');

      const contentChange = await ownerA.put(`/api/settings/line/keyword-replies/${id}`, {
        active: false,
        content: { text: '不應在退訂後改寫', matchType: 'EXACT', actionType: 'REPLY_CONTENT' },
      });
      expect(contentChange.status).toBe(403);
      expect((await contentChange.json()).code).toBe('FEAT_001');

      const create = await ownerA.post('/api/settings/line/keyword-replies', {
        keywords: [`${PREFIX}-blocked-create`],
        replyType: 'TEXT',
        content: { text: 'blocked' },
        active: true,
      });
      expect(create.status).toBe(403);
      expect((await create.json()).code).toBe('FEAT_001');

      const form = new FormData();
      form.append('file', await imageFile('image/png'));
      const uploadBlocked = await ownerA.fetch('/api/settings/line/keyword-replies/image', {
        method: 'POST',
        body: form,
      });
      expect(uploadBlocked.status).toBe(403);
      expect((await uploadBlocked.json()).code).toBe('FEAT_001');

      const deleted = await ownerA.delete(`/api/settings/line/keyword-replies/${id}`);
      expect(deleted.status).toBe(200);
      expect((await deleted.json()).data).toMatchObject({ deleted: true });
      await expectObjectMissing(ref.path);
      await expectObjectMissing(ref.previewPath);
      pathsToRemove.delete(ref.path);
      pathsToRemove.delete(ref.previewPath);
    } finally {
      await restoreKeywordReplyFeature();
    }
  });


  it('keeps a fresh abandoned upload in the pre-registered cleanup ledger during its grace period', async () => {
    const ref = await upload();
    const { data: rows, error } = await admin.from('keyword_reply_image_cleanup')
      .select('path, last_error')
      .eq('tenant_id', SHOP_A.id)
      .in('path', [ref.path, ref.previewPath]);
    expect(error).toBeNull();
    expect(rows).toHaveLength(2);
    expect(rows?.every((row) => row.last_error === 'awaiting keyword reply persistence')).toBe(true);

    const cron = await fetch(`${BASE_URL}/api/cron/keyword-reply-image-cleanup`, {
      headers: { authorization: `Bearer ${process.env.TEST_CRON_SECRET}` },
    });
    expect(cron.status).toBe(200);
    await expectObjectExists(ref.path);
    await expectObjectExists(ref.previewPath);
  });

  it('does not orphan an intermediate IMAGE replacement under concurrency', async () => {
    const first = await upload();
    const second = await upload();
    const third = await upload();
    const id = await createImageReply(first, 'concurrent-replace');

    const [left, right] = await Promise.all([
      ownerA.put(`/api/settings/line/keyword-replies/${id}`, imagePayload(`${PREFIX}-replace-b`, second)),
      ownerA.put(`/api/settings/line/keyword-replies/${id}`, imagePayload(`${PREFIX}-replace-c`, third)),
    ]);
    const statuses = [left.status, right.status].sort((a, b) => a - b);
    expect(statuses.every((status) => status === 200 || status === 409)).toBe(true);
    expect(statuses.some((status) => status === 200)).toBe(true);

    const listed = await ownerA.get('/api/settings/line/keyword-replies');
    const listedBody = (await listed.json()) as Envelope<any[]>;
    const saved = listedBody.data!.find((row) => row.id === id);
    const finalRef = saved?.content?.imageStorageRef as ImageRef | undefined;
    expect(finalRef).toBeTruthy();
    expect([second.path, third.path]).toContain(finalRef!.path);
    await expectObjectMissing(first.path);
    await expectObjectMissing(first.previewPath);

    const loser = [second, third].find((ref) => ref.path !== finalRef!.path)!;
    if (statuses.every((status) => status === 200)) {
      await expectObjectMissing(loser.path);
      await expectObjectMissing(loser.previewPath);
      pathsToRemove.delete(loser.path);
      pathsToRemove.delete(loser.previewPath);
    } else {
      const discard = await ownerA.fetch('/api/settings/line/keyword-replies/image', {
        method: 'DELETE',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ storageRef: loser }),
      });
      expect(discard.status).toBe(200);
      await expectObjectMissing(loser.path);
      await expectObjectMissing(loser.previewPath);
      pathsToRemove.delete(loser.path);
      pathsToRemove.delete(loser.previewPath);
    }
    await expectObjectExists(finalRef!.path);
    await expectObjectExists(finalRef!.previewPath);
    pathsToRemove.delete(first.path);
    pathsToRemove.delete(first.previewPath);
  });

  it('rejects another tenant from referencing or discarding A tenant objects', async () => {
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

  it('cleanup retry rechecks a newly live ref before deletion', async () => {
    const ref = await upload();
    await createImageReply(ref, 'retry-reference');
    const expiredAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
    const { error } = await admin.from('keyword_reply_image_cleanup').insert([
      { tenant_id: SHOP_A.id, bucket: BUCKET, path: ref.path, last_error: 'forced retry fixture', created_at: expiredAt },
      { tenant_id: SHOP_A.id, bucket: BUCKET, path: ref.previewPath, last_error: 'forced retry fixture', created_at: expiredAt },
    ]);
    expect(error).toBeNull();
    const cron = await fetch(`${BASE_URL}/api/cron/keyword-reply-image-cleanup`, {
      headers: { authorization: `Bearer ${process.env.TEST_CRON_SECRET}` },
    });
    expect(cron.status).toBe(200);
    expect((await cron.json()).success).toBe(true);
    const { count, error: queueError } = await admin.from('keyword_reply_image_cleanup')
      .select('path', { count: 'exact', head: true }).eq('tenant_id', SHOP_A.id).in('path', [ref.path, ref.previewPath]);
    expect(queueError).toBeNull();
    expect(count).toBe(0);
    await expectObjectExists(ref.path);
    await expectObjectExists(ref.previewPath);
  });
});
