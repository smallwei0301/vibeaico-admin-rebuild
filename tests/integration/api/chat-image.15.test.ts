/**
 * 顧客訊息「傳送圖片」整合測試 — GitHub issue #15（修復-7）第 ① 項。
 *
 * 修改前：/tenant/chat 的 sendImage() 只 URL.createObjectURL(file) 貼一顆本地
 * 泡泡就顯示已送出，**沒有上傳、沒有推播**。店家會以為作品照／報價單傳出去了。
 *
 * 本檔驗證補齊後的真實鏈路：
 *   1. POST /api/upload（bucket=chat-images，0017 migration 新增）→ public URL
 *   2. POST /api/chat/messages { lineUserId, imageUrl }
 *        → 扣推播額度 → mock LINE 收到 type=image 的 push
 *        → chat_messages 多一列 direction=OUT / message_type=image
 *   3. 額度用完 → 409、**mock LINE 零請求**、DB 無新 OUT 列
 *
 * 手法沿用 chat-link.06.test.ts：mock LINE 綁 LINE_API_BASE 的固定 port 4123；
 * SHOP_A 的 LINE 憑證由 beforeAll 以 encryptSecret 寫入、afterAll 還原快照；
 * 額度上限依 EXTRA_PUSH 訂閱現算（seed 給 SHOP_A 全部付費碼 → 700 而非 200）。
 *
 * 清理紀律：afterAll 刪掉本檔建立的 line_users / chat_messages、還原
 * push_quota_usage 當月列（原本不存在就整列刪掉）、還原 tenant_settings 快照。
 * 上傳到 Storage 的測試圖片也在 afterAll 以 service role 刪除。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createHmac } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { SHOP_A } from '../../fixtures';
import { loginAs, type AuthedApi } from '../../helpers/auth';
import { LineMockServer } from '../../helpers/line-mock';
import { encryptSecret } from '@/server/crypto';

type Envelope<T = unknown> = { success: boolean; data?: T; message?: string; code?: string };

const BASE_URL = process.env.INTEGRATION_BASE_URL ?? 'http://localhost:3100';

const CHANNEL_SECRET = 'itest-line-channel-secret-15-image';
const CHANNEL_TOKEN = 'itest-line-access-token-15-image';

/** 本檔專用 LINE user id（與其他 chat 測試檔分開，避免互踩） */
const USER_IMAGE = 'Uchatimage15itest000000000000000001';

/** 1x1 透明 PNG（最小合法 image/png，用來實際打 /api/upload） */
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

function sign(secret: string, rawBody: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('base64');
}

/** 與 src/server/tz.ts taipeiCurrentMonthKey 同規則（固定 +08:00）的月份鍵 */
function taipeiMonthKey(): string {
  const t = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, '0')}`;
}

let admin: SupabaseClient;
let ownerA: AuthedApi;
const mock = new LineMockServer();

let settingsSnapshot: {
  line: unknown;
  line_channel_secret_enc: string;
  line_channel_access_token_enc: string;
} | null = null;

let quotaRowExistedAtStart = false;
let quotaUsedAtStart = 0;

/** 本檔上傳到 chat-images 的物件路徑，afterAll 清掉 */
const uploadedPaths: string[] = [];

async function quotaUsed(): Promise<number> {
  const { data, error } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(error).toBeNull();
  return (data as { used: number } | null)?.used ?? 0;
}

async function setQuotaUsed(used: number): Promise<void> {
  const { error } = await admin
    .from('push_quota_usage')
    .upsert({ tenant_id: SHOP_A.id, month: taipeiMonthKey(), used }, { onConflict: 'tenant_id,month' });
  expect(error).toBeNull();
}

/** 與 src/server/features.ts isFeatureActive 同一條規則，現算 SHOP_A 的推播上限 */
async function currentPushQuotaLimit(): Promise<number> {
  const { data, error } = await admin
    .from('feature_subscriptions')
    .select('active, expires_at')
    .eq('tenant_id', SHOP_A.id)
    .eq('code', 'EXTRA_PUSH')
    .maybeSingle();
  expect(error).toBeNull();
  const row = data as { active: boolean; expires_at: string | null } | null;
  const active = !!row?.active && (!row.expires_at || new Date(row.expires_at) > new Date());
  return active ? 700 : 200;
}

async function outMessages() {
  const { data, error } = await admin
    .from('chat_messages')
    .select('id, direction, message_type, content, created_at')
    .eq('tenant_id', SHOP_A.id)
    .eq('line_user_id', USER_IMAGE)
    .eq('direction', 'OUT')
    .order('created_at', { ascending: true });
  expect(error).toBeNull();
  return (data ?? []) as { id: string; message_type: string; content: any }[];
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

  await mock.start();

  const { data: snap, error: e0 } = await admin
    .from('tenant_settings')
    .select('line, line_channel_secret_enc, line_channel_access_token_enc')
    .eq('tenant_id', SHOP_A.id)
    .single();
  expect(e0).toBeNull();
  settingsSnapshot = snap as typeof settingsSnapshot;
  const { error: e1 } = await admin
    .from('tenant_settings')
    .update({
      line_channel_secret_enc: encryptSecret(CHANNEL_SECRET),
      line_channel_access_token_enc: encryptSecret(CHANNEL_TOKEN),
    })
    .eq('tenant_id', SHOP_A.id);
  expect(e1).toBeNull();

  const { data: q, error: e2 } = await admin
    .from('push_quota_usage')
    .select('used')
    .eq('tenant_id', SHOP_A.id)
    .eq('month', taipeiMonthKey())
    .maybeSingle();
  expect(e2).toBeNull();
  quotaRowExistedAtStart = q != null;
  quotaUsedAtStart = (q as { used: number } | null)?.used ?? 0;

  // 顧客加好友（webhook follow）→ line_users followed=true，鏈路從真入口建立
  const raw = JSON.stringify({
    events: [{ type: 'follow', replyToken: 'rt-15-img-follow', source: { type: 'user', userId: USER_IMAGE } }],
  });
  const res = await fetch(`${BASE_URL}/api/line/webhook/${SHOP_A.shopCode}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-line-signature': sign(CHANNEL_SECRET, raw) },
    body: raw,
  });
  expect(res.status).toBe(200);
});

afterAll(async () => {
  await admin.from('chat_messages').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_IMAGE);
  await admin.from('line_users').delete().eq('tenant_id', SHOP_A.id).eq('line_user_id', USER_IMAGE);

  if (uploadedPaths.length) {
    await admin.storage.from('chat-images').remove(uploadedPaths);
  }

  if (quotaRowExistedAtStart) {
    await setQuotaUsed(quotaUsedAtStart);
  } else {
    await admin
      .from('push_quota_usage')
      .delete()
      .eq('tenant_id', SHOP_A.id)
      .eq('month', taipeiMonthKey());
  }

  if (settingsSnapshot) {
    await admin
      .from('tenant_settings')
      .update({
        line: settingsSnapshot.line ?? {},
        line_channel_secret_enc: settingsSnapshot.line_channel_secret_enc,
        line_channel_access_token_enc: settingsSnapshot.line_channel_access_token_enc,
      })
      .eq('tenant_id', SHOP_A.id);
  }
  await mock.stop();
});

describe('POST /api/upload — chat-images bucket（0017 migration）', () => {
  it('上傳 PNG 到 chat-images → 200 且回 https public URL', async () => {
    const form = new FormData();
    form.append(
      'file',
      new File([Buffer.from(PNG_1X1_BASE64, 'base64')], 'chat.png', { type: 'image/png' }),
      'chat.png',
    );
    form.append('bucket', 'chat-images');

    const res = await ownerA.fetch('/api/upload', { method: 'POST', body: form });
    const body = (await res.json()) as Envelope<{ url: string }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.url).toMatch(/^https:\/\//);
    expect(body.data!.url).toContain('/chat-images/');
    // 路徑第一段資料夾＝租戶 id（0008/0017 的 RLS 規則）
    expect(body.data!.url).toContain(`/chat-images/${SHOP_A.id}/`);

    const path = body.data!.url.split(`/chat-images/`)[1];
    uploadedPaths.push(path);
    // issue #28 ⑬ 起，chat-images 的上傳會**多產一個** ≤1 MB 的縮圖物件
    // （`{uuid}.preview.{ext}`）。清理沒跟上就會在 TEST 專案的 Storage 一路累積
    // ——reset-db.mjs 只清資料表，不碰 Storage。縮圖內容本身由
    // tests/integration/api/line-preview-image.28.test.ts 驗證，這裡只負責收拾。
    const previewPath = (body.data as { previewPath?: string }).previewPath;
    if (previewPath) uploadedPaths.push(previewPath);
  });
});

describe('POST /api/chat/messages { imageUrl } — 圖片推播（issue #15 ①）', () => {
  it('送圖 → mock LINE 收到 type=image 的 push、DB 有 OUT image 列、額度 +1', async () => {
    mock.reset();
    const before = await quotaUsed();
    const imageUrl = 'https://example.test/itest-15/photo.png';

    const res = await ownerA.post('/api/chat/messages', { lineUserId: USER_IMAGE, imageUrl });
    const body = (await res.json()) as Envelope<{ id: string; messageType: string; imageUrl: string }>;
    expect(res.status, JSON.stringify(body)).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data!.messageType).toBe('image');
    expect(body.data!.imageUrl).toBe(imageUrl);

    const pushes = mock.requestsFor('/v2/bot/message/push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body.to).toBe(USER_IMAGE);
    expect(pushes[0].body.messages).toEqual([
      { type: 'image', originalContentUrl: imageUrl, previewImageUrl: imageUrl },
    ]);

    const outs = await outMessages();
    expect(outs).toHaveLength(1);
    expect(outs[0].message_type).toBe('image');
    expect(outs[0].content.imageUrl).toBe(imageUrl);

    expect(await quotaUsed()).toBe(before + 1);
  });

  it('額度用完 → 409、mock LINE 零請求、DB 無新 OUT 列；測後還原 quota', async () => {
    mock.reset();
    const restore = await quotaUsed();
    const limit = await currentPushQuotaLimit();
    const outsBefore = (await outMessages()).length;
    await setQuotaUsed(limit);

    try {
      const res = await ownerA.post('/api/chat/messages', {
        lineUserId: USER_IMAGE,
        imageUrl: 'https://example.test/itest-15/blocked.png',
      });
      const body = (await res.json()) as Envelope;
      expect(res.status).toBe(409);
      expect(body.success).toBe(false);
      expect(body.message).toBe('本月推播額度已用完');

      expect(mock.requests).toHaveLength(0);
      expect((await outMessages()).length).toBe(outsBefore);
    } finally {
      await setQuotaUsed(restore);
    }
  });

  it('imageUrl 非 https（LINE 不收）→ 400，且沒有打 LINE', async () => {
    mock.reset();
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_IMAGE,
      imageUrl: 'http://example.test/itest-15/insecure.png',
    });
    expect(res.status).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('text 與 imageUrl 同時給 → 400（一次只能一種），且沒有打 LINE', async () => {
    mock.reset();
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_IMAGE,
      text: '兩種一起送',
      imageUrl: 'https://example.test/itest-15/both.png',
    });
    expect(res.status).toBe(400);
    expect(mock.requests).toHaveLength(0);
  });

  it('純文字訊息不受影響（既有行為回歸）：push 是 type=text、DB 記 message_type=text', async () => {
    mock.reset();
    const before = await quotaUsed();
    const res = await ownerA.post('/api/chat/messages', {
      lineUserId: USER_IMAGE,
      text: 'issue #15 文字回歸',
    });
    expect(res.status).toBe(200);

    const pushes = mock.requestsFor('/v2/bot/message/push');
    expect(pushes).toHaveLength(1);
    expect(pushes[0].body.messages).toEqual([{ type: 'text', text: 'issue #15 文字回歸' }]);

    const outs = await outMessages();
    expect(outs.at(-1)!.message_type).toBe('text');
    expect(await quotaUsed()).toBe(before + 1);
  });
});
